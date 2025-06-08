/* eslint-disable prettier/prettier */
import { BadRequestException, HttpException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException, StreamableFile } from '@nestjs/common';
import { ExpensQuotationEntity } from '../repositories/entities/expensquotation.entity';
import { QuotationNotFoundException } from '../errors/quotation.notfound.error';
import { ResponseExpensQuotationDto } from '../dtos/expensquotation.response.dto';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { CreateExpensQuotationDto } from '../dtos/expensquotation.create.dto';
import { UpdateExpensQuotationDto } from '../dtos/expensquotation.update.dto';
import { CurrencyService } from 'src/modules/currency/services/currency.service';
import { FirmService } from 'src/modules/firm/services/firm.service';
import { InterlocutorService } from 'src/modules/interlocutor/services/interlocutor.service';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { EntityManager, FindManyOptions, FindOneOptions, IsNull, Not } from 'typeorm';
import { ArticleExpensQuotationEntryService } from './article-expensquotation-entry.service';
import { ArticleExpensQuotationEntryEntity } from '../repositories/entities/article-expensquotation-entry.entity';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { format, isAfter } from 'date-fns';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { ExpensQuotationMetaDataService } from './expensquotation-meta-data.service';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { BankAccountService } from 'src/modules/bank-account/services/bank-account.service';
import { ExpensQuotationUploadService } from './expensquotation-upload.service';
import { ExpensequotationRepository } from '../repositories/repository/expensquotation.repository';
import { EXPENSQUOTATION_STATUS } from '../enums/expensquotation-status.enum';
import { Transactional } from '@nestjs-cls/transactional';
import { DuplicateExpensQuotationDto } from '../dtos/expensquotation.duplicate.dto';
import { StorageService } from 'src/common/storage/services/storage.service';
import { ExpensQuotationUploadEntity } from '../repositories/entities/expensquotation-file.entity';
import { TemplateService } from 'src/modules/template/services/template.service';
import { TemplateType } from 'src/modules/template/enums/TemplateType';
import ejs from "ejs";
import { ArticleService } from 'src/modules/article/article/services/article.service';



@Injectable()
export class ExpensQuotationService {
  constructor(
    //repositories
    private readonly expensequotationRepository: ExpensequotationRepository,
    //entity services
    private readonly expensearticleQuotationEntryService: ArticleExpensQuotationEntryService,
    private readonly expensequotationUploadService: ExpensQuotationUploadService,
    private readonly bankAccountService: BankAccountService,
    private readonly currencyService: CurrencyService,
    private readonly firmService: FirmService,
    private readonly interlocutorService: InterlocutorService,
    private readonly expensequotationMetaDataService: ExpensQuotationMetaDataService,
    private readonly taxService: TaxService,
    private readonly storageService: StorageService,
    private readonly templateService:TemplateService,
    private readonly entityManager:EntityManager,
    private articleService:ArticleService,
    

    //abstract services
    private readonly calculationsService: InvoicingCalculationsService,
    private readonly pdfService: PdfService,
  ) {}


  async getAvailableStatuses(): Promise<{ value: string; label: string }[]> {
    return Object.entries(EXPENSQUOTATION_STATUS).map(([key, value]) => ({
      value: key, // La clé de l'enum (ex: 'Draft')
      label: value // La valeur de traduction (ex: 'expense_quotation.status.draft')
    }));
  }

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpensQuotationEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    
    // Ajoutez ceci pour forcer les relations
    queryOptions.relations = [
      ...(queryOptions.relations || []),
      'expensearticleQuotationEntries',
      'expensearticleQuotationEntries.article',
      'expensearticleQuotationEntries.articleExpensQuotationEntryTaxes',
      'expensearticleQuotationEntries.articleExpensQuotationEntryTaxes.tax'
    ];
  
    const quotation = await this.expensequotationRepository.findOne(
      queryOptions as FindOneOptions<ExpensQuotationEntity>,
    );
    
    if (!quotation) return null;
    
    // Solution de secours si les articles ne sont pas chargés
    if (!quotation.expensearticleQuotationEntries) {
    }
    
    return quotation;
  }

  async findAll(query: IQueryObject = {}): Promise<ExpensQuotationEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    
    return await this.expensequotationRepository.findAll(
      queryOptions as FindManyOptions<ExpensQuotationEntity>,
    );
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ResponseExpensQuotationDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.expensequotationRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.expensequotationRepository.findAll(
      queryOptions as FindManyOptions<ExpensQuotationEntity>,
    );

    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page),
        take: parseInt(query.limit),
      },
      itemCount: count,
    });

    return new PageDto(entities, pageMetaDto);
  }

  
  @Transactional()
async save(createQuotationDto: CreateExpensQuotationDto): Promise<ExpensQuotationEntity> {
    try {
        console.log('Received DTO:', createQuotationDto);

        // 1. Validation du numéro séquentiel
        if (!createQuotationDto.sequentialNumbr) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: 'Le numéro de devis est requis',
                    error: 'Bad Request'
                },
                HttpStatus.BAD_REQUEST
            );
        }

        if (!/^QUO-\d+$/.test(createQuotationDto.sequentialNumbr)) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: 'Format de numéro de devis invalide. Format attendu: QUO-XXXX',
                    error: 'Bad Request'
                },
                HttpStatus.BAD_REQUEST
            );
        }

        // 2. Vérification de l'unicité du numéro séquentiel
        const existingQuotation = await this.expensequotationRepository.findOne({
            where: { sequential: createQuotationDto.sequentialNumbr }
        });

        if (existingQuotation) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.CONFLICT,
                    message: `Le numéro séquentiel ${createQuotationDto.sequentialNumbr} existe déjà`,
                    error: 'Conflict'
                },
                HttpStatus.CONFLICT
            );
        }

        // 3. Récupération des entités associées
        const [firm, bankAccount, currency, interlocutor] = await Promise.all([
            this.firmService.findOneByCondition({
                filter: `id||$eq||${createQuotationDto.firmId}`,
            }),
            createQuotationDto.bankAccountId
                ? this.bankAccountService.findOneById(createQuotationDto.bankAccountId)
                : Promise.resolve(null),
            createQuotationDto.currencyId
                ? this.currencyService.findOneById(createQuotationDto.currencyId)
                : Promise.resolve(null),
            this.interlocutorService.findOneById(createQuotationDto.interlocutorId)
        ]);

        if (!firm) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.NOT_FOUND,
                    message: 'Société non trouvée',
                    error: 'Not Found'
                },
                HttpStatus.NOT_FOUND
            );
        }

        if (!interlocutor) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.NOT_FOUND,
                    message: 'Interlocuteur non trouvé',
                    error: 'Not Found'
                },
                HttpStatus.NOT_FOUND
            );
        }

        console.log('Articles received:', createQuotationDto.articleQuotationEntries);

        // 4. Validation des articles
        if (!createQuotationDto.articleQuotationEntries?.length) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: 'Aucun article fourni',
                    error: 'Bad Request'
                },
                HttpStatus.BAD_REQUEST
            );
        }

        // Vérification des doublons et validation des articles
        const articleTitles = new Set<string>();
        for (const [index, entry] of createQuotationDto.articleQuotationEntries.entries()) {
            if (!entry.article?.title) {
                throw new HttpException(
                    {
                        statusCode: HttpStatus.BAD_REQUEST,
                        message: `Article à l'index ${index}: Le titre est requis`,
                        error: 'Bad Request'
                    },
                    HttpStatus.BAD_REQUEST
                );
            }

            // Vérification des doublons
            const lowerCaseTitle = entry.article.title.toLowerCase();
            if (articleTitles.has(lowerCaseTitle)) {
                throw new HttpException(
                    {
                        statusCode: HttpStatus.CONFLICT,
                        message: `L'article "${entry.article.title}" existe déjà dans ce devis`,
                        error: 'Conflict'
                    },
                    HttpStatus.CONFLICT
                );
            }
            articleTitles.add(lowerCaseTitle);

            // Validation des quantités et prix
            if (entry.quantity === undefined || entry.quantity <= 0) {
                throw new HttpException(
                    {
                        statusCode: HttpStatus.BAD_REQUEST,
                        message: `Article "${entry.article.title}": La quantité doit être supérieure à 0`,
                        error: 'Bad Request'
                    },
                    HttpStatus.BAD_REQUEST
                );
            }

            if (entry.unit_price === undefined || entry.unit_price < 0) {
                throw new HttpException(
                    {
                        statusCode: HttpStatus.BAD_REQUEST,
                        message: `Article "${entry.article.title}": Le prix unitaire doit être positif`,
                        error: 'Bad Request'
                    },
                    HttpStatus.BAD_REQUEST
                );
            }
        }

        // 5. Sauvegarde des articles
        const articleEntries = await this.expensearticleQuotationEntryService.saveMany(
            createQuotationDto.articleQuotationEntries
        );
        console.log('Saved article entries:', articleEntries);

        if (!articleEntries?.length) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                    message: 'Erreur lors de la sauvegarde des articles',
                    error: 'Internal Server Error'
                },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }

        // 6. Calcul des totaux
        const { subTotal, total } = this.calculationsService.calculateLineItemsTotal(
            articleEntries.map(entry => entry.total),
            articleEntries.map(entry => entry.subTotal),
        );

        const totalAfterGeneralDiscount = this.calculationsService.calculateTotalDiscount(
            total,
            createQuotationDto.discount,
            createQuotationDto.discount_type,
        );

        // 7. Récupération des line items
        const lineItems = await this.expensearticleQuotationEntryService.findManyAsLineItem(
            articleEntries.map(entry => entry.id),
        );

        // 8. Calcul du résumé des taxes
        const taxSummary = await Promise.all(
            this.calculationsService.calculateTaxSummary(lineItems).map(async item => {
                const tax = await this.taxService.findOneById(item.taxId);
                return {
                    ...item,
                    label: tax.label,
                    value: tax.isRate ? tax.value * 100 : tax.value,
                    isRate: tax.isRate,
                };
            }),
        );

        // 9. Récupération du fichier PDF
        let uploadPdfField = null;
        if (createQuotationDto.pdfFileId) {
            uploadPdfField = await this.storageService.findOneById(createQuotationDto.pdfFileId);
            if (!uploadPdfField) {
                throw new HttpException(
                    {
                        statusCode: HttpStatus.NOT_FOUND,
                        message: 'Fichier PDF uploadé non trouvé',
                        error: 'Not Found'
                    },
                    HttpStatus.NOT_FOUND
                );
            }
        }

        // 10. Sauvegarde des métadonnées
        const expensequotationMetaData = await this.expensequotationMetaDataService.save({
            ...createQuotationDto.expensequotationMetaData,
            taxSummary,
        });

        console.log('Quotation metadata saved:', expensequotationMetaData);

        // 11. Sauvegarde du devis
        const quotation = await this.expensequotationRepository.save({
            ...createQuotationDto,
            sequential: createQuotationDto.sequentialNumbr,
            bankAccountId: bankAccount?.id ?? null,
            currencyId: currency?.id ?? firm.currencyId,
            expensearticleQuotationEntries: articleEntries,
            expensequotationMetaData,
            subTotal,
            total: totalAfterGeneralDiscount,
            uploadPdfField: uploadPdfField ? uploadPdfField.id : null,
            pdfFileId: uploadPdfField ? uploadPdfField.id : null,
        });

        console.log('Final saved quotation:', quotation);

        // 12. Gestion des uploads
        if (createQuotationDto.uploads?.length) {
            await this.expensequotationUploadService.saveMany(
                quotation.id,
                createQuotationDto.uploads.map(upload => upload.uploadId)
            );
        }

        return quotation;
    } catch (error) {
        console.error('Error saving quotation:', error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            throw new HttpException(
                {
                    statusCode: HttpStatus.CONFLICT,
                    message: error.message,
                    error: 'Duplicate Entry'
                },
                HttpStatus.CONFLICT
            );
        }
        
        if (error instanceof HttpException) {
            throw error;
        }
        
        throw new HttpException(
            {
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: 'Erreur lors de la création du devis',
                error: 'Internal Server Error',
                details: error.message
            },
            HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
}

  
  async findOneById(id: number): Promise<ExpensQuotationEntity> {
    const expensequotation = await this.expensequotationRepository.findOne({
      where: { id },
      withDeleted: true, // Permet de retrouver les éléments soft-deleted
    });
  
    if (!expensequotation) {
      throw new QuotationNotFoundException();
    }
    
    return expensequotation;
  }

  async saveMany(
    createQuotationDtos: CreateExpensQuotationDto[],
  ): Promise<ExpensQuotationEntity[]> {
    const quotations = [];
    for (const createQuotationDto of createQuotationDtos) {
      const quotation = await this.save(createQuotationDto);
      quotations.push(quotation);
    }
    return quotations;
  }


  async softDelete(id: number): Promise<ExpensQuotationEntity> {
    await this.findOneById(id);
    return this.expensequotationRepository.softDelete(id);
  }

  async deleteAll() {
    return this.expensequotationRepository.deleteAll();
  }

 

  async updateStatus(
    id: number,
    status: EXPENSQUOTATION_STATUS,
  ): Promise<ExpensQuotationEntity> {
    const quotation = await this.expensequotationRepository.findOneById(id);
    return this.expensequotationRepository.save({
      id: quotation.id,
      status,
    });
  }
@Transactional()
async update(
  id: number,
  updateQuotationDto: UpdateExpensQuotationDto
): Promise<ExpensQuotationEntity> {
  return this.entityManager.transaction(async (transactionalEntityManager) => {
    try {
      // 1. Charger le devis existant avec toutes ses relations
      const quotation = await transactionalEntityManager.findOne(ExpensQuotationEntity, {
        where: { id },
        relations: ['uploads', 'uploads.upload']
      });

      if (!quotation) {
        throw new QuotationNotFoundException();
      }

      // 2. Cloner les uploads existants pour référence
      const existingUploads = [...(quotation.uploads || [])];
      const existingUploadIds = new Set(existingUploads.map(u => u.uploadId));

      // 3. Traitement des fichiers
      if (updateQuotationDto.uploads) {
        const currentUploadIds = new Set(updateQuotationDto.uploads.map(u => u.uploadId));

        // a. Désassocier les fichiers supprimés
        const uploadsToDisassociate = existingUploads.filter(
          u => !currentUploadIds.has(u.uploadId)
        );

        if (uploadsToDisassociate.length > 0) {
          await transactionalEntityManager.remove(
            ExpensQuotationUploadEntity, 
            uploadsToDisassociate
          );
        }

        // b. Associer les nouveaux fichiers
        const uploadsToAssociate = updateQuotationDto.uploads.filter(uploadDto => {
          return !('id' in uploadDto) || !existingUploadIds.has(uploadDto.uploadId);
        });

        if (uploadsToAssociate.length > 0) {
          const newAssociations = uploadsToAssociate.map(uploadDto =>
            transactionalEntityManager.create(ExpensQuotationUploadEntity, {
              expensequotationId: id,
              uploadId: uploadDto.uploadId
            })
          );
          await transactionalEntityManager.save(newAssociations);
        }
      }

      // 4. Mise à jour des autres champs (sans les uploads)
      const { uploads, ...updateDataWithoutUploads } = updateQuotationDto;
      const updatedQuotation = await transactionalEntityManager.save(ExpensQuotationEntity, {
        ...quotation,
        ...updateDataWithoutUploads,
        id: quotation.id,
      });

      // 5. Recharger le devis avec les relations fraîches
      return await transactionalEntityManager.findOne(ExpensQuotationEntity, {
        where: { id },
        relations: ['uploads', 'uploads.upload']
      });

    } catch (error) {
      console.error('Update failed:', error);
      throw new Error('Failed to update quotation while preserving files');
    }
  });
}

async updateExpenseQuotationUpload(
  id: number,
  updateQuotationDto: UpdateExpensQuotationDto,
  existingUploads: { id?: number; uploadId: number }[]
) {
  const newUploads = [];
  const keptUploads = [...existingUploads];
  const eliminatedUploads = [];

  if (!updateQuotationDto.uploads) {
    return { keptUploads, newUploads, eliminatedUploads };
  }

  // 1. Identifier tous les uploadIds dans la requête
  const requestUploadIds = new Set(updateQuotationDto.uploads.map(u => u.uploadId));

  // 2. Pour chaque upload dans la requête
  for (const upload of updateQuotationDto.uploads) {
    // Vérifier si l'upload existe déjà dans le devis
    const existingUpload = existingUploads.find(u => u.uploadId === upload.uploadId);
    
    if (!existingUpload) {
      try {
        // Si l'upload n'existe pas, l'ajouter
        const newUpload = await this.expensequotationUploadService.create({
          expensequotationId: id,
          uploadId: upload.uploadId
        });
        newUploads.push({
          id: newUpload.id,
          uploadId: newUpload.uploadId,
        });
      } catch (error) {
        console.error(`Échec de l'ajout du fichier ${upload.uploadId}:`, error);
        throw error;
      }
    } else {
      // Si l'upload existe mais n'est pas encore associé (expensequotationId = NULL)
      // On doit le mettre à jour
      if (!existingUpload.id) {
        const updatedUpload = await this.expensequotationUploadService.create({
          expensequotationId: id,
          uploadId: upload.uploadId
        });
        keptUploads.push({
          id: updatedUpload.id,
          uploadId: updatedUpload.uploadId,
        });
      }
    }
  }

  // 3. Identifier les uploads à supprimer (ceux qui ne sont plus dans la requête)
  const keptUploadIds = new Set([...keptUploads, ...newUploads].map(u => u.uploadId));
  for (const existingUpload of existingUploads) {
    if (!requestUploadIds.has(existingUpload.uploadId)) {
      eliminatedUploads.push(existingUpload);
      if (existingUpload.id) {
        await this.expensequotationUploadService.softDelete(existingUpload.id);
      }
    }
  }

  return { 
    keptUploads: [...keptUploads.filter(u => !eliminatedUploads.some(eu => eu.uploadId === u.uploadId)), 
    newUploads,
    eliminatedUploads
  ]};
}

  async duplicate(
    duplicateQuotationDto: DuplicateExpensQuotationDto,
  ): Promise<ResponseExpensQuotationDto> {
    try {
      // 1. Récupération stricte du devis original
      const original = await this.expensequotationRepository.findOne({
        where: { id: duplicateQuotationDto.id },
        relations: [
          'expensequotationMetaData',
          'expensearticleQuotationEntries',
          'uploads',
          'uploadPdfField'
        ],
      });

      if (!original) throw new Error("Original quotation not found");

      console.log(`[DUPLICATION] IncludeFiles: ${duplicateQuotationDto.includeFiles}, Original PDF: ${original.uploadPdfField?.id || 'none'}`);

      // 2. Nettoyage COMPLET des références fichiers
      const baseData = {
        ...original,
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        sequential: null,
        sequentialNumbr: null,
        status: EXPENSQUOTATION_STATUS.Draft,
        // Métadonnées toujours dupliquées
        expensequotationMetaData: await this.expensequotationMetaDataService.duplicate(
          original.expensequotationMetaData.id
        ),
        // Articles toujours dupliqués
        expensearticleQuotationEntries: [],
        // Fichiers TOUJOURS initialisés à vide/null
        uploads: [], // <-- Important
        uploadPdfField: null, // <-- Critique
        pdfFileId: null // <-- Essentiel
      };

      // 3. Création du nouveau devis (sans fichiers)
      const newQuotation = await this.expensequotationRepository.save(baseData);

      // 4. Duplication conditionnelle STRICTE
      let finalUploads = [];
      let finalPdf = null;

      if (duplicateQuotationDto.includeFiles) {
        console.log("[DUPLICATION] Processing files...");
        
        // a. Uploads réguliers
        if (original.uploads?.length > 0) {
          finalUploads = await this.expensequotationUploadService.duplicateMany(
            original.uploads.map(u => u.id),
            newQuotation.id
          );
        }

        // b. PDF - UNIQUEMENT si includeFiles=true ET PDF existant
        if (original.uploadPdfField) {
          console.log(`[DUPLICATION] Attempting PDF duplication from ${original.uploadPdfField.id}`);
          finalPdf = await this.storageService.duplicate(original.uploadPdfField.id);
        }
      }

      // 5. Mise à jour FINALE avec vérification
      const result = await this.expensequotationRepository.save({
        ...newQuotation,
        expensearticleQuotationEntries: await this.expensearticleQuotationEntryService.duplicateMany(
          original.expensearticleQuotationEntries.map(e => e.id),
          newQuotation.id
        ),
        uploads: finalUploads,
        uploadPdfField: finalPdf, // Reste null si includeFiles=false
        pdfFileId: finalPdf?.id || null // Garanti null si includeFiles=false
      });

      // Vérification de cohérence
      if (!duplicateQuotationDto.includeFiles && result.pdfFileId) {
        console.error("[ERROR] PDF was duplicated despite includeFiles=false!");
        // Correction automatique si nécessaire
        await this.expensequotationRepository.update(result.id, {
          uploadPdfField: null,
          pdfFileId: null
        });
        result.uploadPdfField = null;
        result.pdfFileId = null;
      }

      console.log("[DUPLICATION] Completed:", {
        newId: result.id,
        hasPdf: !!result.pdfFileId,
        expectedPdf: duplicateQuotationDto.includeFiles
      });

      return result;

    } catch (error) {
      console.error("[DUPLICATION FAILED]", {
        error: error.message,
        dto: duplicateQuotationDto,
        stack: error.stack
      });
      throw error;
    }
  }

  async deletePdfFile(quotationId: number): Promise<void> {
    const quotation = await this.expensequotationRepository.findOneById(quotationId);
    if (!quotation) {
      throw new Error("Quotation not found");
    }

    if (quotation.pdfFileId) {
      // Supprimer le fichier PDF de la base de données
      await this.storageService.delete(quotation.pdfFileId);

      // Mettre à jour le devis pour retirer l'ID du fichier PDF
      await this.expensequotationRepository.save({
        ...quotation,
        pdfFileId: null,
        uploadPdfField: null,
      });
    }
  }

  async updateQuotationStatusIfExpired(quotationId: number): Promise<ExpensQuotationEntity> {
    const quotation = await this.findOneById(quotationId);
    const currentDate = new Date();
    const dueDate = new Date(quotation.dueDate);
  
    if (dueDate < currentDate && quotation.status !== EXPENSQUOTATION_STATUS.Expired) {
      quotation.status = EXPENSQUOTATION_STATUS.Expired;
      return this.expensequotationRepository.save(quotation);
    }
  
    return quotation;
  }


  async checkSequentialNumberExists(sequentialNumber: string): Promise<boolean> {
    // Vérification du format
    if (!/^QUO-\d+$/.test(sequentialNumber)) {
        throw new BadRequestException('Format de numéro séquentiel invalide. Format attendu: QUO-XXXX');
    }

    // Recherche dans la base de données
    const existingQuotation = await this.expensequotationRepository.findOne({
        where: { sequential: sequentialNumber }
    });

    return !!existingQuotation;
  }

 

  async generateQuotationPdf(quotationId: number, templateId?: number): Promise<Buffer> {
    // 1. Récupérer le devis avec toutes les relations nécessaires
    const quotation = await this.expensequotationRepository.findOne({
        where: { id: quotationId },
        relations: [
            'firm', 
            'interlocutor', 
            'expensearticleQuotationEntries', 
            'expensearticleQuotationEntries.article',
            'expensearticleQuotationEntries.articleExpensQuotationEntryTaxes',
            'expensearticleQuotationEntries.articleExpensQuotationEntryTaxes.tax',
            'currency',
            'cabinet',
            'cabinet.address',
            'bankAccount',
            'template' // Ajout de la relation template
        ]
    });

    if (!quotation) {
        throw new NotFoundException(`Devis avec ID ${quotationId} non trouvé`);
    }

    // 2. Récupérer le template
    const template = templateId 
        ? await this.templateService.getTemplateById(templateId)
        : await this.templateService.getDefaultTemplate(TemplateType.QUOTATION);
    
    if (!template) {
        throw new NotFoundException('Aucun template de devis trouvé');
    }

    // 3. Enregistrer l'ID du template utilisé (corrigé)
    if (template.id !== quotation.templateId) {
        quotation.template = template; // Utilisez la relation entière
        await this.expensequotationRepository.save(quotation);
    }


    // 3. Calculer les totaux

    // 4. Préparer les données pour le template
    const templateData = {
        quotation: {
            ...quotation,
            // Formatage des dates
            date: format(quotation.date, 'dd/MM/yyyy'),
            dueDate: quotation.dueDate ? format(quotation.dueDate, 'dd/MM/yyyy') : 'Non spécifié',
            
            // Articles avec formatage spécifique
            articles: quotation.expensearticleQuotationEntries?.map(entry => ({
                reference: entry.article?.reference,
                title: entry.article?.title,
                description: entry.article?.description || '',
                quantity: entry.quantity,
                unit_price: entry.unit_price,
                discount: entry.discount,
                discount_type: entry.discount_type,
                subTotal: entry.subTotal,
                total: entry.total,
                taxes: entry.articleExpensQuotationEntryTaxes?.map(taxEntry => ({
                    label: taxEntry.tax?.label,
                    rate: taxEntry.tax?.value,
                    amount: taxEntry.tax?.value * entry.subTotal / 100
                })) || []
            })) || [],
            
            // Totaux calculés
            totalHT: quotation.subTotal,
            total: quotation.total,
            
            // Gestion des valeurs nulles
            firm: {
                ...quotation.firm,
                deliveryAddress: quotation.firm.deliveryAddress || {
                    address: '',
                    zipcode: '',
                    region: '',
                    country: ''
                },
                invoicingAddress: quotation.firm.invoicingAddress || quotation.firm.deliveryAddress || {
                    address: '',
                    zipcode: '',
                    region: '',
                    country: ''
                }
            },
            cabinet: quotation.cabinet || {
                enterpriseName: '',
                taxIdentificationNumber: '',
                address: {
                    address: '',
                    zipcode: '',
                    region: '',
                    country: ''
                },
                phone: ''
            },
            currency: quotation.currency || {
                symbol: '€'
            }
        }
    };

    // 5. Nettoyer et compiler le template
    const cleanedContent = template.content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    const compiledHtml = ejs.render(cleanedContent, templateData);

    // 6. Générer le PDF
    return this.pdfService.generateFromHtml(compiledHtml, {
        format: 'A4',
        margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' },
        printBackground: true
    });
}


  
  




  
  
}
  
