import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { LineItem } from 'src/common/calculations/interfaces/line-item.interface';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { EntityManager, FindOneOptions, In } from 'typeorm';
import { ExpenseArticleInvoiceEntryRepository } from '../repositories/repository/expense-invoice-article-entry.repository';
import { ExpenseArticleInvoiceEntryTaxService } from './expense-article-invoice-entry-tax.service';
import { ExpenseResponseArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.response.dto';
import { ExpenseArticleInvoiceEntryEntity } from '../repositories/entities/expense-article-invoice-entry.entity';
import { ExpenseCreateArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.create.dto';
import { ExpenseUpdateArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.update.dto';
import { ExpenseArticleInvoiceEntryNotFoundException } from '../errors/expense-article-invoice-entry.notfound.error';
import { ArticleService } from 'src/modules/article/article/services/article.service';
import { UpdateArticleDto } from 'src/modules/article/article/dtos/article.update.dto';
import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';
import { ExpenseArticleInvoiceEntryTaxEntity } from '../repositories/entities/expense-article-invoice-entry-tax.entity';
import { TaxEntity } from 'src/modules/tax/repositories/entities/tax.entity';
import { ArticleRepository } from 'src/modules/article/article/repositories/repository/article.repository';

@Injectable()
export class ExpenseArticleInvoiceEntryService {
  constructor(
    private readonly articleInvoiceEntryRepository: ExpenseArticleInvoiceEntryRepository,
    private readonly articleInvoiceEntryTaxService: ExpenseArticleInvoiceEntryTaxService,
    private readonly articleService: ArticleService,
    private readonly taxService: TaxService,
    private readonly calculationsService: InvoicingCalculationsService,
     private readonly entityManager:EntityManager,
     private readonly articleRepository:ArticleRepository
    
  ) {}

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpenseResponseArticleInvoiceEntryDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const entry = await this.articleInvoiceEntryRepository.findOne(
      queryOptions as FindOneOptions<ExpenseArticleInvoiceEntryEntity>,
    );
    if (!entry) return null;
    return entry;
  }

  async findOneById(id: number): Promise<ExpenseResponseArticleInvoiceEntryDto> {
    const entry = await this.articleInvoiceEntryRepository.findOneById(id);
    if (!entry) {
      throw new ExpenseArticleInvoiceEntryNotFoundException();
    }
    return entry;
  }

  async findOneAsLineItem(id: number): Promise<LineItem> {
    const entry = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'expenseArticleInvoiceEntryTaxes',
    });
    const taxes = entry.articleInvoiceEntryTaxes
      ? await Promise.all(
          entry.articleInvoiceEntryTaxes.map((taxEntry) =>
            this.taxService.findOneById(taxEntry.taxId),
          ),
        )
      : [];
    return {
      quantity: entry.quantity,
      unit_price: entry.unit_price,
      discount: entry.discount,
      discount_type: entry.discount_type,
      taxes: taxes,
    };
  }

  async findManyAsLineItem(ids: number[]): Promise<LineItem[]> {
    const lineItems = await Promise.all(
      ids.map((id) => this.findOneAsLineItem(id)),
    );
    return lineItems;
  }

 async save(
    createArticleInvoiceEntryDto: ExpenseCreateArticleInvoiceEntryDto,
): Promise<ExpenseArticleInvoiceEntryEntity> {
    // Récupérer les taxes
    const taxes = createArticleInvoiceEntryDto.taxes
        ? await Promise.all(
            createArticleInvoiceEntryDto.taxes.map(id => this.taxService.findOneById(id))
          )
        : [];

    // Trouver l'article par référence ou titre
    let article = createArticleInvoiceEntryDto.article.reference
        ? await this.articleService.findOneByCondition({
            filter: `reference||$eq||${createArticleInvoiceEntryDto.article.reference}`
          })
        : null;

    if (!article && createArticleInvoiceEntryDto.article.title) {
        article = await this.articleService.findOneByCondition({
            filter: `title||$eq||${createArticleInvoiceEntryDto.article.title}`
        });
    }

    if (!article) {
        // Créer un nouvel article sans historique
        article = await this.articleService.save({
            ...createArticleInvoiceEntryDto.article,
            reference: createArticleInvoiceEntryDto.article.reference || 
                     `REF-${Math.floor(100000000 + Math.random() * 900000000)}`,
            quantityInStock: createArticleInvoiceEntryDto.quantity || 0,
            unitPrice: createArticleInvoiceEntryDto.unit_price || 0
        });
    } else {
    const quantityToDeduct = createArticleInvoiceEntryDto.quantity || 0;
    
    if (article.quantityInStock < quantityToDeduct) {
        throw new BadRequestException(
            `Stock insuffisant. Stock actuel: ${article.quantityInStock}, quantité demandée: ${quantityToDeduct}`
        );
    }

    // Solution 1: Utilisation de update() avec syntaxe correcte pour MySQL
    await this.articleRepository.update(
        article.id,
        {
            quantityInStock: () => `quantityInStock - ${quantityToDeduct}`,
            version: () => `version + 1`,
            updatedAt: () => `CURRENT_TIMESTAMP`
        }
    );

    // Solution alternative 2: Utilisation du QueryBuilder
    /*
    await this.articleRepository
        .createQueryBuilder()
        .update(ArticleEntity)
        .set({
            quantityInStock: () => `quantityInStock - ${quantityToDeduct}`,
            version: () => `version + 1`,
            updatedAt: () => `CURRENT_TIMESTAMP`
        })
        .where('id = :id', { id: article.id })
        .execute();
    */

    // Recharger l'article pour avoir les données à jour
    article = await this.articleService.findOneById(article.id);
}
    // Créer l'entrée de facture
    const entry = await this.articleInvoiceEntryRepository.save({
        ...createArticleInvoiceEntryDto,
        reference: article.reference,
        articleId: article.id,
        article: article,
        subTotal: this.calculationsService.calculateSubTotalForLineItem({
            quantity: createArticleInvoiceEntryDto.quantity,
            unit_price: createArticleInvoiceEntryDto.unit_price,
            discount: createArticleInvoiceEntryDto.discount,
            discount_type: createArticleInvoiceEntryDto.discount_type,
            taxes: taxes
        }),
        total: this.calculationsService.calculateTotalForLineItem({
            quantity: createArticleInvoiceEntryDto.quantity,
            unit_price: createArticleInvoiceEntryDto.unit_price,
            discount: createArticleInvoiceEntryDto.discount,
            discount_type: createArticleInvoiceEntryDto.discount_type,
            taxes: taxes
        })
    });

    // Sauvegarder les taxes associées
    if (taxes.length > 0) {
        await this.articleInvoiceEntryTaxService.saveMany(
            taxes.map(tax => ({
                taxId: tax.id,
                articleInvoiceEntryId: entry.id
            }))
        );
    }

    return entry;
}

  async saveMany(
    createArticleInvoiceEntryDtos: ExpenseCreateArticleInvoiceEntryDto[],
  ): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const savedEntries = [];
    for (const dto of createArticleInvoiceEntryDtos) {
      const savedEntry = await this.save(dto);
      savedEntries.push(savedEntry);
    }
    return savedEntries;
  }

 async update(id: number, updateDto: Partial<ExpenseCreateArticleInvoiceEntryDto >){
 {
   return this.entityManager.transaction(async (transactionalEntityManager) => {
     // 1. Récupérer l'entrée avec lock PESSIMISTIC_WRITE
     const existingEntry = await transactionalEntityManager.findOne(
       ExpenseArticleInvoiceEntryEntity,
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
         ExpenseArticleInvoiceEntryTaxEntity,
         { where: { expenseArticleInvoiceEntryId: id } }
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
           const newTax = new ExpenseArticleInvoiceEntryTaxEntity();
           newTax.expenseArticleInvoiceEntryId = id;
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
       : existingEntry.expenseArticleInvoiceEntryTaxes?.map(t => t.tax) || [];
 
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
     const updatedEntry = await transactionalEntityManager.save(ExpenseArticleInvoiceEntryEntity, {
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
}

  async duplicate(
    id: number,
    newInvoiceId: number,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // 1. Récupérer l'entrée existante avec ses relations
    const existingEntry = await this.articleInvoiceEntryRepository.findOne({
      where: { id },
      relations: [
        'expenseArticleInvoiceEntryTaxes',
      ],
    });
  
    if (!existingEntry) {
      throw new Error(`Entry with id ${id} not found`);
    }
  
    // 2. Générer une nouvelle référence unique
    const generateNewReference = () => {
      const timestamp = Date.now().toString().slice(-6);
      const randomNum = Math.floor(100 + Math.random() * 900);
      return `REF-${timestamp}-${randomNum}`; // Format simplifié
    };
  
    const newReference = generateNewReference();
  
    // 3. Créer un nouvel article avec nouvelle référence
    const newArticle = existingEntry.article 
      ? {
          ...existingEntry.article,
          id: undefined, // Nouvel ID auto-généré
          reference: newReference, // Nouvelle référence unique
          createdAt: undefined,
          updatedAt: undefined,
        }
      : null;
  
    // 4. Préparer les taxes à dupliquer
    const duplicatedTaxes = existingEntry.expenseArticleInvoiceEntryTaxes?.map((taxEntry) => ({
      taxId: taxEntry.taxId,
    })) || [];
  
    // 5. Créer l'entrée dupliquée
    const duplicatedEntry = this.articleInvoiceEntryRepository.create({
      ...existingEntry,
      id: undefined, // Nouvel ID auto-généré
      reference: newReference, // Ajout de la nouvelle référence directement sur l'entrée
      expenseInvoiceId: newInvoiceId, // Assigner le nouvel ID de facture
      article: newArticle, // Utiliser le nouvel article (peut être null)
      expenseArticleInvoiceEntryTaxes: undefined, // Réinitialiser les taxes
      createdAt: undefined,
      updatedAt: undefined,
    });
  
    // 6. Sauvegarder la nouvelle entrée
    const newEntry = await this.articleInvoiceEntryRepository.save(duplicatedEntry);
  
    // 7. Sauvegarder les taxes associées si elles existent
    if (duplicatedTaxes.length > 0) {
      await this.articleInvoiceEntryTaxService.saveMany(
        duplicatedTaxes.map((tax) => ({
          taxId: tax.taxId,
          articleInvoiceEntryId: newEntry.id,
        })),
      );
    }
  
    // 8. Sauvegarder le nouvel article si nécessaire
  
  
    // 9. Retourner l'entrée complète avec ses relations
    return this.articleInvoiceEntryRepository.findOne({
      where: { id: newEntry.id },
      relations: ['expenseArticleInvoiceEntryTaxes', 'article'],
    });
  }
  async duplicateMany(
    ids: number[],
    invoiceId: number,
  ): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const duplicatedEntries = [];
    for (const id of ids) {
      const duplicatedEntry = await this.duplicate(id, invoiceId);
      duplicatedEntries.push(duplicatedEntry);
    }
    return duplicatedEntries;
  }

  async softDelete(id: number): Promise<ExpenseArticleInvoiceEntryEntity> {
    const entry = await this.articleInvoiceEntryRepository.findByCondition({
      where: { id, deletedAt: null },
      relations: { expenseArticleInvoiceEntryTaxes: true },
    });
    await this.articleInvoiceEntryTaxService.softDeleteMany(
      entry.expenseArticleInvoiceEntryTaxes.map((taxEntry) => taxEntry.id),
    );
    return this.articleInvoiceEntryRepository.softDelete(id);
  }

  async softDeleteMany(ids: number[]): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const entries = await Promise.all(
      ids.map(async (id) => this.softDelete(id)),
    );
    return entries;
  }
}
