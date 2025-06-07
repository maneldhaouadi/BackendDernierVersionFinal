/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ArticleExpensQuotationEntryEntity } from '../repositories/entities/article-expensquotation-entry.entity';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { LineItem } from 'src/common/calculations/interfaces/line-item.interface';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { EntityManager, FindOneOptions, In, IsNull, Like, Not } from 'typeorm';
import { ArticleExpensQuotationEntryTaxService } from './article-expensquotation-entry-tax.service';
import { CreateArticleExpensQuotationEntryDto } from '../dtos/article-expensquotation-entry.create.dto';
import { ResponseArticleExpensQuotationEntryDto } from '../dtos/article-expensquotation-entry.response.dto';
import { ExpenseArticleQuotationEntryRepository } from '../repositories/repository/article-expensquotation-entry.repository';
import { ArticleExpensQuotationEntryTaxEntity } from '../repositories/entities/article-expensquotation-entry-tax.entity';
import { TaxEntity } from 'src/modules/tax/repositories/entities/tax.entity';
import { ArticleService } from 'src/modules/article/article/services/article.service';
import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';
import { ArticleRepository } from 'src/modules/article/article/repositories/repository/article.repository';

@Injectable()
export class ArticleExpensQuotationEntryService {
    constructor(
        private readonly expensQuotationEntryRepository: ExpenseArticleQuotationEntryRepository,
        private readonly expensQuotationEntryTaxService: ArticleExpensQuotationEntryTaxService,
        private readonly articleService: ArticleService,
        private readonly taxService: TaxService,
        private readonly calculationsService: InvoicingCalculationsService,
        private readonly entityManager:EntityManager,
        private readonly articleRepository:ArticleRepository
    ) {}

  async saveMany(
        createArticleExpensQuotationEntryDtos: CreateArticleExpensQuotationEntryDto[],
    ): Promise<ArticleExpensQuotationEntryEntity[]> {
        const savedEntries = [];
        for (const dto of createArticleExpensQuotationEntryDtos) {
            const savedEntry = await this.save(dto);
            savedEntries.push(savedEntry);
        }
        return savedEntries;
    }

   async save(
    createArticleExpensQuotationEntryDto: CreateArticleExpensQuotationEntryDto,
): Promise<ArticleExpensQuotationEntryEntity> {
    try {
        // 1. Vérification de la référence
        if (!createArticleExpensQuotationEntryDto.reference) {
            throw new Error('La référence de l\'article est obligatoire');
        }

        // 2. Vérification des doublons dans le devis actuel
        if (createArticleExpensQuotationEntryDto.expenseQuotationId) {
            const existingEntry = await this.expensQuotationEntryRepository.findOne({
                where: {
                    reference: createArticleExpensQuotationEntryDto.reference,
                    expenseQuotationId: createArticleExpensQuotationEntryDto.expenseQuotationId,
                    id: Not(createArticleExpensQuotationEntryDto.id || IsNull())
                }
            });

            if (existingEntry) {
                throw new Error(`Un article avec la référence ${createArticleExpensQuotationEntryDto.reference} existe déjà dans ce devis`);
            }
        }

        // 3. Vérification et récupération des taxes
        const taxes = createArticleExpensQuotationEntryDto.taxes
            ? await Promise.all(
                createArticleExpensQuotationEntryDto.taxes.map(async (id) => {
                    const tax = await this.taxService.findOneById(id);
                    if (!tax) {
                        throw new Error(`Taxe avec l'id ${id} non trouvée`);
                    }
                    return tax;
                }),
              )
            : [];

        // 4. Gestion de l'article
        let article: ArticleEntity | null = null;
        const articleTitle = createArticleExpensQuotationEntryDto.title || createArticleExpensQuotationEntryDto.article?.title;
        const articleDescription = createArticleExpensQuotationEntryDto.description || createArticleExpensQuotationEntryDto.article?.description;

        // Vérifier d'abord si l'article existe par référence
        article = await this.articleService.findOneByReference(
            createArticleExpensQuotationEntryDto.reference
        );

        // Si c'est un nouvel article (pas de ID d'article fourni) et qu'un article avec cette référence existe déjà
        if (!createArticleExpensQuotationEntryDto.article?.id && article) {
            throw new Error(`Un article avec la référence ${createArticleExpensQuotationEntryDto.reference} existe déjà dans la base de données`);
        }

        // Si l'article existe déjà et qu'on l'a sélectionné (ID d'article fourni)
        if (article && createArticleExpensQuotationEntryDto.article?.id) {
            const requestedQuantity = createArticleExpensQuotationEntryDto.quantity || 0;

            // Vérification du stock
            if (article.quantityInStock < requestedQuantity) {
                throw new Error(`Stock insuffisant pour ${article.reference}. Disponible: ${article.quantityInStock}, Demandé: ${requestedQuantity}`);
            }

            // Mise à jour du stock
            await this.articleRepository.update(
                article.id,
                {
                    quantityInStock: () => `quantityInStock - ${requestedQuantity}` as any,
                    version: () => "version + 1" as any,
                    ...(createArticleExpensQuotationEntryDto.unit_price !== undefined && {
                        unitPrice: createArticleExpensQuotationEntryDto.unit_price
                    })
                }
            );

            // Recharger l'article
            article = await this.articleService.findOneById(article.id);
        } 
        // Si l'article n'existe pas et qu'on veut en créer un nouveau
        else if (!article) {
            // CAS 2: Création d'un nouvel article
            if (!articleTitle) {
                throw new Error('Le titre de l\'article est obligatoire pour créer un nouvel article');
            }

            // Vérification supplémentaire au cas où findOneByReference aurait raté quelque chose
            const existingWithSameRef = await this.articleService.findAllByReference(
                createArticleExpensQuotationEntryDto.reference
            );

            if (existingWithSameRef && existingWithSameRef.length > 0) {
                throw new Error(`Un article avec la référence ${createArticleExpensQuotationEntryDto.reference} existe déjà dans la base de données`);
            }

            article = await this.articleService.save({
                title: articleTitle,
                description: articleDescription || '',
                reference: createArticleExpensQuotationEntryDto.reference,
                unitPrice: createArticleExpensQuotationEntryDto.unit_price || 0,
                quantityInStock: createArticleExpensQuotationEntryDto.quantity || 0,
                status: 'draft'
            });
        }

        // 5. Calcul des totaux
        const lineItem = {
            quantity: createArticleExpensQuotationEntryDto.quantity || 0,
            unit_price: createArticleExpensQuotationEntryDto.unit_price || article.unitPrice || 0,
            discount: createArticleExpensQuotationEntryDto.discount || 0,
            discount_type: createArticleExpensQuotationEntryDto.discount_type,
            taxes
        };

        const subTotal = this.calculationsService.calculateSubTotalForLineItem(lineItem);
        const total = this.calculationsService.calculateTotalForLineItem(lineItem);

        if (isNaN(subTotal) || isNaN(total)) {
            throw new Error('Erreur dans le calcul des totaux');
        }

        // 6. Sauvegarde de l'entrée de devis
        const entryData = {
            ...createArticleExpensQuotationEntryDto,
            reference: article.reference,
            articleId: article.id,
            article: article,
            title: articleTitle,
            description: articleDescription,
            subTotal,
            total,
            originalStock: article.quantityInStock + (createArticleExpensQuotationEntryDto.quantity || 0),
            unit_price: article.unitPrice,
            orderedQuantity: createArticleExpensQuotationEntryDto.quantity
        };

        const entry = await this.expensQuotationEntryRepository.save(entryData);

        // 7. Sauvegarde des taxes associées
        if (taxes.length > 0) {
            await this.expensQuotationEntryTaxService.saveMany(
                taxes.map((tax) => ({
                    taxId: tax.id,
                    expenseArticleEntryId: entry.id,
                })),
            );
        }

        return entry;
    } catch (error) {
        throw new Error(`Erreur lors de la sauvegarde de l'article: ${error.message}`);
    }
}

    async findManyAsLineItem(ids: number[]): Promise<LineItem[]> {
        const lineItems = await Promise.all(
            ids.map((id) => this.findOneAsLineItem(id)),
        );
        return lineItems;
    }

    async findOneAsLineItem(id: number): Promise<LineItem> {
        const entry = await this.findOneByCondition({
            filter: `id||$eq||${id}`,
            join: 'articleExpensQuotationEntryTaxes',
        });
        
        if (!entry) {
            throw new Error(`Article quotation entry with ID ${id} not found`);
        }
    
        // Ensure taxes are loaded
        const taxes = entry.articleExpensQuotationEntryTaxes
            ? await Promise.all(
                entry.articleExpensQuotationEntryTaxes.map(async (taxEntry) => {
                    try {
                        return await this.taxService.findOneById(taxEntry.taxId);
                    } catch (error) {
                        console.error(`Error loading tax with ID ${taxEntry.taxId}:`, error);
                        return null;
                    }
                }).filter(tax => tax !== null)
              )
            : [];
        
        return {
            quantity: entry.quantity,
            unit_price: entry.unit_price,
            discount: entry.discount,
            discount_type: entry.discount_type,
            taxes: taxes.filter(Boolean), // Remove any null values
        };
    }

    async findOneByCondition(
        query: IQueryObject,
    ): Promise<ArticleExpensQuotationEntryEntity | null> {  // Changed return type to Entity
        const queryBuilder = new QueryBuilder();
        const queryOptions = queryBuilder.build(query);
        return this.expensQuotationEntryRepository.findOne(
            queryOptions as FindOneOptions<ArticleExpensQuotationEntryEntity>,
        );
    }
async update(id: number, updateDto: Partial<CreateArticleExpensQuotationEntryDto>) {
  return this.entityManager.transaction(async (transactionalEntityManager) => {
    // 1. Récupérer l'entrée avec lock PESSIMISTIC_WRITE
    const existingEntry = await transactionalEntityManager.findOne(
      ArticleExpensQuotationEntryEntity,
      {
        where: { id },
        relations: ['article'],
        lock: { mode: "pessimistic_write" }
      }
    );

    if (!existingEntry) {
      throw new NotFoundException(`Article quotation entry with ID ${id} not found`);
    }

    // 2. Gestion de l'article
    if (existingEntry.article) {
      const newQuantity = updateDto.quantity ?? existingEntry.quantity;
      const quantityDifference = newQuantity - existingEntry.quantity;
      const newStock = existingEntry.article.quantityInStock - quantityDifference;

      if (newStock < 0) {
        throw new BadRequestException(
          `Stock insuffisant. Disponible: ${existingEntry.article.quantityInStock}, Demandé: ${newQuantity}`
        );
      }

      await transactionalEntityManager.update(
        ArticleEntity,
        existingEntry.article.id,
        {
          title: updateDto.article?.title ?? existingEntry.article.title,
          description: updateDto.article?.description ?? existingEntry.article.description,
          reference: updateDto.reference ?? existingEntry.article.reference,
          unitPrice: updateDto.unit_price ?? existingEntry.article.unitPrice,
          quantityInStock: newStock
        }
      );
    }

    // 3. Gestion des taxes - APPROCHE REVISITÉE
    if (updateDto.taxes !== undefined) {
      // D'abord charger les taxes existantes
      const existingTaxes = await transactionalEntityManager.find(
        ArticleExpensQuotationEntryTaxEntity,
        { where: { expenseArticleEntryId: id } }
      );

      // Supprimer les taxes qui ne sont plus dans la liste
      const taxesToRemove = existingTaxes.filter(
        tax => !updateDto.taxes?.includes(tax.taxId)
      );
      
      if (taxesToRemove.length > 0) {
        await transactionalEntityManager.remove(taxesToRemove);
      }

      // Ajouter les nouvelles taxes qui ne sont pas déjà présentes
      const existingTaxIds = existingTaxes.map(tax => tax.taxId);
      const taxesToAdd = (updateDto.taxes || [])
        .filter(taxId => !existingTaxIds.includes(taxId))
        .map(taxId => {
          const newTax = new ArticleExpensQuotationEntryTaxEntity();
          newTax.expenseArticleEntryId = id;
          newTax.taxId = taxId;
          return newTax;
        });

      if (taxesToAdd.length > 0) {
        await transactionalEntityManager.save(taxesToAdd);
      }
    }

    // 4. Calcul des totaux
    const taxes = updateDto.taxes !== undefined
      ? await transactionalEntityManager.find(TaxEntity, {
          where: { id: In(updateDto.taxes || []) }
        })
      : existingEntry.articleExpensQuotationEntryTaxes?.map(t => t.tax) || [];

    const subTotal = this.calculationsService.calculateSubTotalForLineItem({
      quantity: updateDto.quantity ?? existingEntry.quantity,
      unit_price: updateDto.unit_price ?? existingEntry.unit_price,
      discount: updateDto.discount ?? existingEntry.discount,
      discount_type: updateDto.discount_type ?? existingEntry.discount_type,
      taxes
    });

    const total = this.calculationsService.calculateTotalForLineItem({
      quantity: updateDto.quantity ?? existingEntry.quantity,
      unit_price: updateDto.unit_price ?? existingEntry.unit_price,
      discount: updateDto.discount ?? existingEntry.discount,
      discount_type: updateDto.discount_type ?? existingEntry.discount_type,
      taxes
    });

    // 5. Mise à jour finale
    const updatedEntry = await transactionalEntityManager.save(ArticleExpensQuotationEntryEntity, {
      ...existingEntry,
      ...updateDto,
      subTotal,
      total,
      originalStock: existingEntry.article 
        ? existingEntry.article.quantityInStock + (updateDto.quantity ?? existingEntry.quantity) 
        : null
    });

    return updatedEntry;
  });
}
    async duplicate(
        id: number,
        newExpensQuotationId: number, // Renommé pour plus de clarté
      ): Promise<ArticleExpensQuotationEntryEntity> {
        const existingEntry = await this.findOneByCondition({
          filter: `id||$eq||${id}`,
          join: 'articleExpensQuotationEntryTaxes',
        });
      
        if (!existingEntry) {
          throw new Error('Entry not found');
        }
      
        // Générer nouvelle référence basée sur le NOUVEAU devis
        const newReference = await this.generateSequentialReference(newExpensQuotationId);
      
        const duplicatedEntry = {
          ...existingEntry,
          reference: newReference, // Cette référence sera nouvelle
          expenseQuotationId: newExpensQuotationId,
          id: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          articleExpensQuotationEntryTaxes: existingEntry.articleExpensQuotationEntryTaxes?.map(
            tax => ({ taxId: tax.taxId })
          ) || []
        };
      
        const newEntry = await this.expensQuotationEntryRepository.save(duplicatedEntry);
      
        if (duplicatedEntry.articleExpensQuotationEntryTaxes.length > 0) {
          await this.expensQuotationEntryTaxService.saveMany(
            duplicatedEntry.articleExpensQuotationEntryTaxes.map(tax => ({
              taxId: tax.taxId,
              expenseArticleEntryId: newEntry.id
            }))
          );
        }
      
        return newEntry;
      }
    
    private async generateSequentialReference(quotationId: number): Promise<string> {
        // Get the last reference used in this quotation
        const lastEntry = await this.expensQuotationEntryRepository.findOne({
            where: { expenseQuotationId: quotationId },
            order: { id: 'DESC' },
            select: ['reference']
        });
    
        if (!lastEntry) {
            // First entry in this quotation
            return `REF-${quotationId}-001`;
        }
    
        // Extract the numeric part and increment
        const matches = lastEntry.reference.match(/(.*-)(\d+)$/);
        if (matches && matches[2]) {
            const prefix = matches[1];
            const number = parseInt(matches[2], 10) + 1;
            return `${prefix}${number.toString().padStart(3, '0')}`;
        }
    
        // Fallback if pattern doesn't match
        return `REF-${quotationId}-${Date.now()}`;
    }

    async duplicateMany(
        entryIds: number[],
        newQuotationId: number
    ): Promise<ArticleExpensQuotationEntryEntity[]> {
        const duplicatedEntries: ArticleExpensQuotationEntryEntity[] = [];
        
        for (const entryId of entryIds) {
            const duplicatedEntry = await this.duplicate(entryId, newQuotationId);
            duplicatedEntries.push(duplicatedEntry);
        }
        
        return duplicatedEntries;
    }


    async softDelete(id: number): Promise<ArticleExpensQuotationEntryEntity> {
        const entry = await this.expensQuotationEntryRepository.findByCondition({
          where: { id, deletedAt: null },
          relations: { articleExpensQuotationEntryTaxes: true },
        });
        await this.expensQuotationEntryTaxService.softDeleteMany(
          entry.articleExpensQuotationEntryTaxes.map((taxEntry) => taxEntry.id),
        );
        return this.expensQuotationEntryRepository.softDelete(id);
      }
    
      async softDeleteMany(ids: number[]): Promise<ArticleExpensQuotationEntryEntity[]> {
        const entries = await Promise.all(
          ids.map(async (id) => this.softDelete(id)),
        );
        return entries;
      }


}


