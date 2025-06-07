import { BadRequestException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { ExpenseInvoiceRepository } from "../repositories/repository/expense-invoice.repository";
import { ExpenseArticleInvoiceEntryService } from "./expense-article-invoice-entry.service";
import { ExpenseInvoiceUploadService } from "./expense-invoice-upload.service";
import { BankAccountService } from "src/modules/bank-account/services/bank-account.service";
import { CurrencyService } from "src/modules/currency/services/currency.service";
import { FirmService } from "src/modules/firm/services/firm.service";
import { InterlocutorService } from "src/modules/interlocutor/services/interlocutor.service";
import { ExpenseInvoiceMetaDataService } from "./expense-invoice-meta-data.service";
import { TaxService } from "src/modules/tax/services/tax.service";
import { TaxWithholdingService } from "src/modules/tax-withholding/services/tax-withholding.service";
import { InvoicingCalculationsService } from "src/common/calculations/services/invoicing.calculations.service";
import { PdfService } from "src/common/pdf/services/pdf.service";
import { format } from "date-fns";
import { ExpenseInvoiceNotFoundException } from "../errors/expense-invoice.notfound.error";
import { ExpenseInvoiceEntity } from "../repositories/entities/expense-invoice.entity";
import { IQueryObject } from "src/common/database/interfaces/database-query-options.interface";
import { QueryBuilder } from "src/common/database/utils/database-query-builder";
import { EntityManager, FindManyOptions, FindOneOptions, UpdateResult } from "typeorm";
import { PageDto } from "src/common/database/dtos/database.page.dto";
import { ExpenseResponseInvoiceDto } from "../dtos/expense-invoice.response.dto";
import { PageMetaDto } from "src/common/database/dtos/database.page-meta.dto";
import { Transactional } from "@nestjs-cls/transactional";
import { ExpenseCreateInvoiceDto } from "../dtos/expense-invoice-create.dto";
import { EXPENSE_INVOICE_STATUS } from "../enums/expense-invoice-status.enum";
import { ExpenseUpdateInvoiceDto } from "../dtos/expense-invoice.update.dto";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { ExpenseDuplicateInvoiceDto } from "../dtos/expense-invoice.duplicate.dto";
import { StorageService } from "src/common/storage/services/storage.service";
import { ExpenseResponseInvoiceUploadDto } from "../dtos/expense-invoice-upload.response.dto";
import { TemplateService } from "src/modules/template/services/template.service";
import { TemplateType } from "src/modules/template/enums/TemplateType";
import ejs from "ejs";
import { ExpenseArticleInvoiceEntryEntity } from "../repositories/entities/expense-article-invoice-entry.entity";
import { ArticleEntity } from "src/modules/article/article/repositories/entities/article.entity";
import { ExpenseUpdateInvoiceUploadDto } from "../dtos/expense-invoice-upload.update.dto";
import { ExpenseInvoiceUploadEntity } from "../repositories/entities/expense-invoice-file.entity";
import { ExpenseInvoiceUploadRepository } from "../repositories/repository/expense-invoice-upload.repository";

@Injectable()
export class ExpenseInvoiceService {
  constructor(
    //repositories
    private readonly invoiceRepository: ExpenseInvoiceRepository,
    private readonly invoiceUploadRepository:ExpenseInvoiceUploadRepository,
    //entity services
    private readonly articleInvoiceEntryService: ExpenseArticleInvoiceEntryService,
    private readonly invoiceUploadService: ExpenseInvoiceUploadService,
    private readonly bankAccountService: BankAccountService,
    private readonly currencyService: CurrencyService,
    private readonly firmService: FirmService,
    private readonly interlocutorService: InterlocutorService,
    private readonly invoiceMetaDataService: ExpenseInvoiceMetaDataService,
    private readonly taxService: TaxService,
    private readonly taxWithholdingService: TaxWithholdingService,
    private readonly storageService: StorageService,
    private readonly entityManager:EntityManager,
    

    //abstract services
    private readonly calculationsService: InvoicingCalculationsService,
    private readonly pdfService: PdfService,
    private readonly templateService:TemplateService
  ) {}
 
  async findOneById(id: number): Promise<ExpenseInvoiceEntity> {
    const invoice = await this.invoiceRepository.findOneById(id);
    if (!invoice) {
      throw new ExpenseInvoiceNotFoundException();
    }
    return invoice;
  }

  async findOneByCondition(
    query: IQueryObject = {},
  ): Promise<ExpenseInvoiceEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const invoice = await this.invoiceRepository.findByCondition(
      queryOptions as FindOneOptions<ExpenseInvoiceEntity>,
    );
    if (!invoice) return null;
    return invoice;
  }

  async findAll(query: IQueryObject = {}): Promise<ExpenseInvoiceEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return await this.invoiceRepository.findAll(
      queryOptions as FindManyOptions<ExpenseInvoiceEntity>,
    );
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ExpenseResponseInvoiceDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.invoiceRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.invoiceRepository.findAll(
      queryOptions as FindManyOptions<ExpenseInvoiceEntity>,
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
async save(createInvoiceDto: ExpenseCreateInvoiceDto): Promise<ExpenseInvoiceEntity> {
  const [firm, bankAccount, currency] = await Promise.all([
    this.firmService.findOneByCondition({
      filter: `id||$eq||${createInvoiceDto.firmId}`,
    }),
    createInvoiceDto.bankAccountId
      ? this.bankAccountService.findOneById(createInvoiceDto.bankAccountId)
      : Promise.resolve(null),
    createInvoiceDto.currencyId
      ? this.currencyService.findOneById(createInvoiceDto.currencyId)
      : Promise.resolve(null),
  ]);

  if (!firm) {
    throw new Error('Firm not found');
  }

  await this.interlocutorService.findOneById(createInvoiceDto.interlocutorId);

  const articleEntries =
    createInvoiceDto.articleInvoiceEntries &&
    (await this.articleInvoiceEntryService.saveMany(
      createInvoiceDto.articleInvoiceEntries,
    ));

  if (!articleEntries) {
    throw new Error('Article entries are missing');
  }

  const { subTotal, total } =
    this.calculationsService.calculateLineItemsTotal(
      articleEntries.map((entry) => entry.total),
      articleEntries.map((entry) => entry.subTotal),
    );

  const taxStamp = createInvoiceDto.taxStampId
    ? await this.taxService.findOneById(createInvoiceDto.taxStampId)
    : null;

  const totalAfterGeneralDiscount =
    this.calculationsService.calculateTotalDiscount(
      total,
      createInvoiceDto.discount,
      createInvoiceDto.discount_type,
      taxStamp?.value || 0,
    );

  const lineItems = await this.articleInvoiceEntryService.findManyAsLineItem(
    articleEntries.map((entry) => entry.id),
  );

  const taxSummary = await Promise.all(
    this.calculationsService
      .calculateTaxSummary(lineItems)
      .map(async (item) => {
        const tax = await this.taxService.findOneById(item.taxId);
        return {
          ...item,
          label: tax.label,
          value: tax.isRate ? tax.value * 100 : tax.value,
          isRate: tax.isRate,
        };
      }),
  );

  // ✅ Vérifier et générer le numéro séquentiel
  let sequentialNumbr = createInvoiceDto.sequentialNumbr || await this.generateSequentialNumber();
  console.log('Sequential Number (Backend):', sequentialNumbr);

  if (!/^INV-\d+$/.test(sequentialNumbr)) {
    throw new Error('Invalid invoice number format. Expected format: INV-XXXX');
  }

  const invoiceMetaData = await this.invoiceMetaDataService.save({
    ...createInvoiceDto.invoiceMetaData,
    taxSummary,
  });

  let taxWithholdingAmount = 0;
  if (createInvoiceDto.taxWithholdingId) {
    const taxWithholding = await this.taxWithholdingService.findOneById(
      createInvoiceDto.taxWithholdingId,
    );

    if (taxWithholding.rate !== undefined && taxWithholding.rate !== null) {
      taxWithholdingAmount =
        totalAfterGeneralDiscount * (taxWithholding.rate / 100);
    }
  }

  let uploadPdfField = null;
  if (createInvoiceDto.pdfFileId) {
    uploadPdfField = await this.storageService.findOneById(
      createInvoiceDto.pdfFileId,
    );
    if (!uploadPdfField) {
      throw new NotFoundException('Uploaded PDF file not found');
    }
  }

  const invoice = await this.invoiceRepository.save({
    ...createInvoiceDto,
    sequential: sequentialNumbr,
    bankAccountId: bankAccount ? bankAccount.id : null,
    currencyId: currency ? currency.id : firm.currencyId,
    cabinetId: 1,
    sequentialNumbr,
    articleExpenseEntries: articleEntries,
    expenseInvoiceMetaData: invoiceMetaData,
    subTotal,
    taxWithholdingAmount: taxWithholdingAmount || 0,
    total: totalAfterGeneralDiscount,
    uploadPdfField: uploadPdfField ? uploadPdfField.id : null,
  });

  if (createInvoiceDto.uploads) {
    await Promise.all(
      createInvoiceDto.uploads.map((u) =>
        this.invoiceUploadService.save(invoice.id, u.uploadId),
      ),
    );
  }
  return invoice;
}

private async generateSequentialNumber(): Promise<string> {
  const lastInvoice = await this.invoiceRepository.findOne({
    order: { id: 'DESC' },
  });

  const lastNumber = lastInvoice?.sequentialNumbr
    ? parseInt(lastInvoice.sequentialNumbr.split('-')[1], 10)
    : 0;

  return `INV-${lastNumber + 1}`;
}



  async saveMany(
    createInvoiceDtos: ExpenseCreateInvoiceDto[],
  ): Promise<ExpenseInvoiceEntity[]> {
    const invoices = [];
    for (const createInvoiceDto of createInvoiceDtos) {
      const invoice = await this.save(createInvoiceDto);
      invoices.push(invoice);
    }
    return invoices;
  }

 async update(
  id: number,
  updateInvoiceDto: ExpenseUpdateInvoiceDto,
): Promise<ExpenseInvoiceEntity> {
  return this.entityManager.transaction(async (transactionalEntityManager) => {
    const existingInvoice = await transactionalEntityManager.findOne(ExpenseInvoiceEntity, { 
      where: { id },
      relations: ['articleExpenseEntries', 'articleExpenseEntries.article'],
    });

    if (!existingInvoice) {
      throw new NotFoundException('Invoice not found');
    }

    // Gestion des uploads
    const existingUploadEntities = await this.invoiceUploadService.findByInvoiceId(id);
    const existingUploads = existingUploadEntities.map(upload => ({
      id: upload.id,
      uploadId: upload.uploadId,
    }));

    const { keptUploads, newUploads, eliminatedUploads } = await this.updateExpenseInvoiceUpload(
      id,
      updateInvoiceDto,
      existingUploads,
    );

    // Mise à jour des articles
    let articleEntries: ExpenseArticleInvoiceEntryEntity[] = [];
    if (updateInvoiceDto.articleInvoiceEntries) {
      // Supprimer les anciennes entrées
      await transactionalEntityManager.remove(
        ExpenseArticleInvoiceEntryEntity, 
        existingInvoice.articleExpenseEntries
      );

      // Créer les nouvelles entrées
      articleEntries = await Promise.all(
        updateInvoiceDto.articleInvoiceEntries.map(async (entryDto) => {
          if (entryDto.article) {
            // Vérifier si l'article existe déjà
            const existingArticle = await transactionalEntityManager.findOne(ArticleEntity, {
              where: { id: entryDto.article.id },
              lock: { mode: "pessimistic_write" }
            });

            if (!existingArticle) {
              throw new NotFoundException(`Article with ID ${entryDto.article.id} not found`);
            }

            // Vérification du stock
            const requestedQuantity = entryDto.quantity || 1;
            if (existingArticle.quantityInStock < requestedQuantity) {
              throw new BadRequestException(
                `Stock insuffisant pour l'article ${existingArticle.reference}. ` +
                `Disponible: ${existingArticle.quantityInStock}, Demandé: ${requestedQuantity}`
              );
            }

            // Calcul du nouveau stock
            const newStock = existingArticle.quantityInStock - requestedQuantity;

            // Mettre à jour l'article existant
            const updatedArticle = await transactionalEntityManager.save(ArticleEntity, {
              ...existingArticle,
              title: entryDto.article.title || existingArticle.title,
              description: entryDto.article.description || existingArticle.description,
              unitPrice: entryDto.unit_price || existingArticle.unitPrice,
              quantityInStock: newStock,
              status: entryDto.article.status || existingArticle.status,
              updatedAt: new Date(),
            });

            console.log('Article updated:', updatedArticle);
          }

          // Créer la nouvelle entrée de ligne
          const newEntry = transactionalEntityManager.create(ExpenseArticleInvoiceEntryEntity, {
            ...entryDto,
            expenseInvoiceId: id,
            reference: entryDto.reference || entryDto.article?.reference || '',
          });

          return transactionalEntityManager.save(newEntry);
        })
      );
    }

    // Reste du code inchangé...
    const lineItems = await this.articleInvoiceEntryService.findManyAsLineItem(
      articleEntries.map(entry => entry.id)
    );

    const { subTotal, total } = this.calculationsService.calculateLineItemsTotal(
      articleEntries.map(entry => entry.total),
      articleEntries.map(entry => entry.subTotal),
    );

    const taxStamp = updateInvoiceDto.taxStampId 
      ? await this.taxService.findOneById(updateInvoiceDto.taxStampId) 
      : null;

    const totalAfterGeneralDiscount = this.calculationsService.calculateTotalDiscount(
      total,
      updateInvoiceDto.discount,
      updateInvoiceDto.discount_type,
      taxStamp?.value || 0,
    );

    const taxSummary = await Promise.all(
      this.calculationsService.calculateTaxSummary(lineItems).map(async (item) => {
        const tax = await this.taxService.findOneById(item.taxId);
        return {
          ...item,
          label: tax.label,
          value: tax.isRate ? tax.value * 100 : tax.value,
          isRate: tax.isRate,
        };
      }),
    );

    const invoiceMetaData = await this.invoiceMetaDataService.save({
      ...updateInvoiceDto.invoiceMetaData,
      taxSummary,
    });

    let taxWithholdingAmount = 0;
    if (updateInvoiceDto.taxWithholdingId) {
      const taxWithholding = await this.taxWithholdingService.findOneById(updateInvoiceDto.taxWithholdingId);
      if (taxWithholding.rate !== undefined && taxWithholding.rate !== null) {
        taxWithholdingAmount = totalAfterGeneralDiscount * (taxWithholding.rate / 100);
      }
    }

    let pdfFileId = existingInvoice.pdfFileId;
    if (updateInvoiceDto.pdfFileId && updateInvoiceDto.pdfFileId !== existingInvoice.pdfFileId) {
      pdfFileId = updateInvoiceDto.pdfFileId;
    }

    const updatedInvoice = await transactionalEntityManager.save(ExpenseInvoiceEntity, {
      ...existingInvoice,
      ...updateInvoiceDto,
      sequential: updateInvoiceDto.sequentialNumbr || existingInvoice.sequentialNumbr || null,
      bankAccountId: updateInvoiceDto.bankAccountId || existingInvoice.bankAccountId,
      currencyId: updateInvoiceDto.currencyId || existingInvoice.currencyId,
      cabinetId: existingInvoice.cabinetId || 1,
      sequentialNumbr: updateInvoiceDto.sequentialNumbr || existingInvoice.sequentialNumbr,
      expenseInvoiceMetaData: invoiceMetaData,
      articleExpenseEntries: articleEntries,
      subTotal,
      taxWithholdingAmount,
      total: totalAfterGeneralDiscount,
      pdfFileId,
      updatedAt: new Date(),
    });

    console.log('Invoice updated successfully:', {
      id: updatedInvoice.id,
      articleCount: updatedInvoice.articleExpenseEntries?.length,
      total: updatedInvoice.total
    });

    return updatedInvoice;
  });
}
  
  async updateExpenseInvoiceUpload(
  id: number,
  updateInvoiceDto: ExpenseUpdateInvoiceDto,
  existingUploads: ExpenseResponseInvoiceUploadDto[],
) {
  // 1. Identifier les uploads à conserver et à supprimer
  const keptUploadIds = (updateInvoiceDto.uploads || []).map(u => u.uploadId);
  const uploadsToDelete = existingUploads.filter(u => !keptUploadIds.includes(u.uploadId));
  
  // 2. Supprimer seulement les uploads qui ne sont plus nécessaires
  if (uploadsToDelete.length > 0) {
    await this.invoiceUploadService.softDeleteMany(
      uploadsToDelete.map(u => ({ id: u.id } as ExpenseInvoiceUploadEntity))
    );
  }

  // 3. Ajouter uniquement les nouveaux uploads qui n'existent pas déjà
  const existingUploadIds = existingUploads.map(u => u.uploadId);
  const newUploads = await Promise.all(
    (updateInvoiceDto.uploads || [])
      .filter(upload => !existingUploadIds.includes(upload.uploadId))
      .map(upload => this.invoiceUploadRepository.insertUnique(id, upload.uploadId))
  );

  return {
    keptUploads: existingUploads.filter(u => keptUploadIds.includes(u.uploadId)),
    newUploads: newUploads.filter(Boolean),
    eliminatedUploads: uploadsToDelete
  };
}
  


  async updateFields(
    id: number,
    dict: QueryDeepPartialEntity<ExpenseInvoiceEntity>,
  ): Promise<UpdateResult> {
    return this.invoiceRepository.update(id, dict);
  }

  async duplicate(duplicateInvoiceDto: ExpenseDuplicateInvoiceDto): Promise<ExpenseResponseInvoiceDto> {
    try {
      const existingInvoice = await this.findOneByCondition({
        filter: `id||$eq||${duplicateInvoiceDto.id}`,
        join: 'expenseInvoiceMetaData,articleExpenseEntries,articleExpenseEntries.expenseArticleInvoiceEntryTaxes,uploads,uploadPdfField',
      });
  
      if (!existingInvoice) {
        throw new Error(`Invoice with id ${duplicateInvoiceDto.id} not found`);
      }
  
      const invoiceMetaData = await this.invoiceMetaDataService.duplicate(
        existingInvoice.expenseInvoiceMetaData.id
      );
  
      // Création de la nouvelle facture (sans fichiers)
      const baseData = {
        ...existingInvoice,
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        sequential: null,
        sequentialNumbr: null,
        status: EXPENSE_INVOICE_STATUS.Draft,
        expenseInvoiceMetaData: invoiceMetaData,
        articleExpenseEntries: [],
        uploads: [], // Initialisé à vide
        uploadPdfField: null, // Initialisé à null
        amountPaid: 0,
      };
  
      const newInvoice = await this.invoiceRepository.save(baseData);
  
      // Duplication des articles
      const duplicatedArticles = existingInvoice.articleExpenseEntries?.length
        ? await this.articleInvoiceEntryService.duplicateMany(
            existingInvoice.articleExpenseEntries.map(e => e.id),
            newInvoice.id
          )
        : [];
  
      // Gestion des fichiers
      let finalUploads = [];
      let finalPdfField = null;
  
      if (duplicateInvoiceDto.includeFiles) {
        // Duplication des uploads
        if (existingInvoice.uploads?.length > 0) {
          finalUploads = await this.invoiceUploadService.duplicateMany(
            existingInvoice.uploads.map(u => u.id),
            newInvoice.id
          );
        }
  
        // Duplication du PDF
        if (existingInvoice.uploadPdfField?.id) {
          finalPdfField = await this.storageService.duplicate(existingInvoice.uploadPdfField.id);
        }
      }
  
      // Mise à jour finale
      const result = await this.invoiceRepository.save({
        ...newInvoice,
        articleExpenseEntries: duplicatedArticles,
        uploads: finalUploads,
        uploadPdfField: finalPdfField,
      });
  
      return result;
    } catch (error) {
      console.error("[DUPLICATION FAILED]", error);
      throw error;
    }
  }
  
  

  async updateMany(
    updateInvoiceDtos: ExpenseUpdateInvoiceDto[],
  ): Promise<ExpenseInvoiceEntity[]> {
    return this.invoiceRepository.updateMany(updateInvoiceDtos);
  }
  async deletePdfFile(invoiceId: number): Promise<void> {
    const invoice = await this.invoiceRepository.findOneById(invoiceId);
    if (!invoice) {
      throw new Error("Quotation not found");
    }
  
    if (invoice.pdfFileId) {
      // Supprimer le fichier PDF de la base de données
      await this.storageService.delete(invoice.pdfFileId);
  
      // Mettre à jour le devis pour retirer l'ID du fichier PDF
      await this.invoiceRepository.save({
        ...invoice,
        pdfFileId: null,
        uploadPdfField: null,
      });
    }
  }


  async softDelete(id: number): Promise<ExpenseInvoiceEntity> {
    await this.findOneById(id);
    return this.invoiceRepository.softDelete(id);
  }
  async deleteAll() {
    return this.invoiceRepository.deleteAll();
  }
  

  async getTotal(): Promise<number> {
    return this.invoiceRepository.getTotalCount();
  }
  async updateInvoiceStatusIfExpired(invoiceId: number): Promise<ExpenseInvoiceEntity> {
    const invoice = await this.findOneById(invoiceId);
    const currentDate = new Date();
    const dueDate = new Date(invoice.dueDate);
  
    if (dueDate < currentDate && invoice.status !== EXPENSE_INVOICE_STATUS.Expired) {
      invoice.status = EXPENSE_INVOICE_STATUS.Expired;
      return this.invoiceRepository.save(invoice);
    }
  
    return invoice;
  }


  async getInvoiceForExport(id: number) {
    return this.invoiceRepository.findOne({
      where: { id },
      relations: [
        'firm',
        'interlocutor',
        'articleExpenseEntries',
        'articleExpenseEntries.article',
        'currency'
      ]
    });
 
  }
  async generateInvoicePdf(invoiceId: number, templateId?: number): Promise<Buffer> {
    const invoice = await this.invoiceRepository.findOne({
        where: { id: invoiceId },
        relations: [
            'firm', 
            'interlocutor', 
            'articleExpenseEntries', 
            'articleExpenseEntries.article',
            'articleExpenseEntries.expenseArticleInvoiceEntryTaxes',
            'articleExpenseEntries.expenseArticleInvoiceEntryTaxes.tax',
            'currency',
            'expenseInvoiceMetaData',
            'taxStamp',
            'taxWithholding',
            'cabinet',
            'cabinet.address',
            'bankAccount'
        ]
    });

    if (!invoice) {
        throw new NotFoundException(`Facture avec ID ${invoiceId} non trouvée`);
    }

    const template = templateId 
        ? await this.templateService.getTemplateById(templateId)
        : await this.templateService.getDefaultTemplate(TemplateType.INVOICE);
    
    if (!template) {
        throw new NotFoundException('Aucun template de facture trouvé');
    }

    // Enregistrer l'id du template dans la facture (expense_invoice)
    invoice.templateId = template.id;
    await this.invoiceRepository.save(invoice);

    // Calculs et préparation des données (inchangés)
    const totalTVA = this.calculationsService.calculateTotalTax(invoice);
    const totalFODEC = this.calculationsService.calculateFodec(invoice);

    const templateData = {
        invoice: {
            ...invoice,
            date: format(invoice.date, 'dd/MM/yyyy'),
            dueDate: invoice.dueDate ? format(invoice.dueDate, 'dd/MM/yyyy') : 'Non spécifié',
            articles: invoice.articleExpenseEntries?.map(entry => ({
              reference: entry.article?.reference,
              title: entry.article?.title,
              description: entry.article?.description || '',
              quantity: entry.quantity,
              unit_price: entry.unit_price,
              discount: entry.discount,
              discount_type: entry.discount_type,
              subTotal: entry.subTotal,
              total: entry.total,
              taxes: entry.expenseArticleInvoiceEntryTaxes?.map(taxEntry => ({
                  label: taxEntry.tax?.label,
                  rate: taxEntry.tax?.value,
                  amount: taxEntry.tax?.value * entry.subTotal / 100
              })) || []
            })) || [],
            totalHT: invoice.subTotal,
            totalTVA,
            totalFODEC,
            total: invoice.total,
            firm: {
                ...invoice.firm,
                deliveryAddress: invoice.firm.deliveryAddress || { address: '', zipcode: '', region: '', country: '' },
                invoicingAddress: invoice.firm.invoicingAddress || invoice.firm.deliveryAddress || { address: '', zipcode: '', region: '', country: '' }
            },
            cabinet: invoice.cabinet || { enterpriseName: '', taxIdentificationNumber: '', address: { address: '', zipcode: '', region: '', country: '' }, phone: '' },
            currency: invoice.currency || { symbol: '€' }
        }
    };

    const cleanedContent = template.content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    const compiledHtml = ejs.render(cleanedContent, templateData);

    return this.pdfService.generateFromHtml(compiledHtml, {
        format: 'A4',
        margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' },
        printBackground: true
    });
}

async findUnpaidByFirm(firmId: number): Promise<ExpenseInvoiceEntity[]> {
  return this.invoiceRepository.findAll({
    where: {
      firmId,
      status: EXPENSE_INVOICE_STATUS.Unpaid,
      // Ajoutez ici d'autres conditions si nécessaire
    },
    relations: ['currency', 'firm'] // Ajoutez les relations nécessaires
  });
}

 async checkSequentialNumberExists(sequentialNumber: string): Promise<boolean> {
    // Vérification du format
    if (!/^INV-\d+$/.test(sequentialNumber)) {
        throw new BadRequestException('Format de numéro séquentiel invalide. Format attendu: QUO-XXXX');
    }

    // Recherche dans la base de données
    const existingQuotation = await this.invoiceRepository.findOne({
        where: { sequential: sequentialNumber }
    });

    return !!existingQuotation;
}


}




