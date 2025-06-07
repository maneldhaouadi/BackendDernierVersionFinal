
import { Injectable, BadRequestException, NotFoundException, ConflictException, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { ArticleEntity } from '../repositories/entities/article.entity';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { DataSource, DeepPartial, FindManyOptions, FindOneOptions, ILike, In, LessThan, LessThanOrEqual, MoreThan, MoreThanOrEqual, Not } from 'typeorm';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { Readable } from 'stream';
import * as xlsx from 'xlsx';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import { TextSimilarityService } from './TextSimilarityService';
import { PdfExtractionService } from 'src/modules/pdf-extraction/services/pdf-extraction.service';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { ArticleData, ArticleStatus } from '../interfaces/article-data.interface';
import { ArticleStatsResponseDto } from '../dtos/article-stats.response.dto';
import { ArticlePermissionService, ArticleAction } from './article-permission.service';
import { validate } from 'class-validator';
import { ArticleRepository } from '../repositories/repository/article.repository';
import { ArticleHistoryService } from 'src/modules/article-history/article-history/services/article-history.service';
import { ArticleOcrService } from 'src/modules/ocr/ocr/services/articleOcrService';
import { ArticleHistoryEntity } from 'src/modules/article-history/article-history/repositories/entities/article-history.entity';

@Injectable()
export class ArticleService {
  constructor(
    private readonly articleRepository: ArticleRepository,
    private readonly articleHistoryService: ArticleHistoryService,
    private readonly pdfService: PdfService,
    private readonly textSimilarityService: TextSimilarityService,
    private readonly articleOcrService: ArticleOcrService,
    private readonly pdfExtractionService: PdfExtractionService,
    private readonly permissionService: ArticlePermissionService,
    private dataSource: DataSource
  ) {}


//////
async getActiveArticles(page: number = 1, limit: number = 10): Promise<ArticleEntity[]> {
  return this.articleRepository.find({
    where: { 
      status: Not('archived'),
      deletedAt: null
    },
    order: { updatedAt: 'DESC' },
    skip: (page - 1) * limit,
    take: limit,
    relations: ['history']
  });
}

async getArchivedArticles(page: number = 1, limit: number = 10): Promise<ArticleEntity[]> {
  return this.articleRepository.find({
    where: { 
      status: 'archived',
      deletedAt: null 
    },
    order: { updatedAt: 'DESC' },
    skip: (page - 1) * limit,
    take: limit,
    relations: ['history']
  });
}

async archiveArticle(id: number): Promise<ArticleEntity> {
  const article = await this.findOneById(id);
  if (!article) {
    throw new NotFoundException('Article not found');
  }
  
  article.status = 'archived';
  return this.articleRepository.save(article);
}

async unarchiveArticle(id: number): Promise<ArticleEntity> {
  const article = await this.findOneById(id);
  if (!article) {
    throw new NotFoundException('Article not found');
  }
  
  article.status = 'active';
  return this.articleRepository.save(article);
}


  // Stats methods
  async getSimplifiedStockStatus(): Promise<{
    healthy: number;
    warning: number;
    danger: number;
    inactive: number;
  }> {
    const articles = await this.articleRepository.find();
    
    return {
      healthy: articles.filter(a => 
        a.status === 'active' && a.quantityInStock > 5
      ).length,
      warning: articles.filter(a => 
        a.status === 'active' && a.quantityInStock > 0 && a.quantityInStock <= 5
      ).length,
      danger: articles.filter(a => 
        a.quantityInStock <= 0
      ).length,
      inactive: articles.filter(a => 
        a.status === 'inactive'
      ).length
    };
  }

async delete(id: number): Promise<ArticleEntity> {
    // 1. Vérifier que l'article existe
    const article = await this.findOneById(id);
    
    // 2. Vérifier les permissions de suppression
    this.permissionService.validateAction(article.status, ArticleAction.DELETE);

    // 3. Effectuer un soft delete
    await this.articleRepository.softDelete(id);

    // 4. Mettre à jour le statut
    article.status = 'deleted';
    article.deletedAt = new Date();
    
    // 5. Enregistrer les modifications
    const deletedArticle = await this.articleRepository.save(article);

    // 6. Créer une entrée d'historique
    await this.articleHistoryService.createHistoryEntry({
      version: article.version + 1,
      changes: {
        status: {
          oldValue: article.status,
          newValue: 'deleted'
        },
        deletedAt: {
          oldValue: null,
          newValue: new Date()
        }
      },
      articleId: id,
      snapshot: article
    });

    return deletedArticle;
  }

  async getTopValuedArticles(): Promise<Array<{
    reference: string;
    title: string;
    totalValue: number;
  }>> {
    const articles = await this.articleRepository.find({
      where: { status: 'active' },
      order: { quantityInStock: 'DESC' },
      take: 5
    });

    return articles.map(a => ({
      reference: a.reference,
      title: a.title || 'Sans titre',
      totalValue: a.quantityInStock * a.unitPrice
    }));
  }

  async getAveragePriceByStatus(): Promise<Record<string, number>> {
    const articles = await this.articleRepository.find();
    const statusGroups: Record<string, { sum: number; count: number }> = {};

    articles.forEach(article => {
      if (!statusGroups[article.status]) {
        statusGroups[article.status] = { sum: 0, count: 0 };
      }
      statusGroups[article.status].sum += article.unitPrice;
      statusGroups[article.status].count++;
    });

    const result: Record<string, number> = {};
    for (const status in statusGroups) {
      result[status] = statusGroups[status].sum / statusGroups[status].count;
    }

    return result;
  }

  async updateStatus(id: number, newStatus: ArticleStatus): Promise<ArticleEntity> {
    const article = await this.findOneById(id);
    
    // Vérification des permissions
    this.permissionService.validateAction(article.status, ArticleAction.CHANGE_STATUS);

    // Mise à jour simple
    const updatePayload = {
      status: newStatus,
      version: article.version + 1,
      updatedAt: new Date()
    };

    try {
      return await this.articleRepository.save({
        ...article,
        ...updatePayload
      });
    } catch (error) {
      this.handleSaveError(error, article.reference);
    }
}
  
  async suggestArchiving(): Promise<ArticleEntity[]> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
    const candidates = await this.articleRepository.find({
      where: [
        { 
          status: 'inactive',
          updatedAt: LessThan(sixMonthsAgo) 
        },
        { 
          status: 'out_of_stock',
          updatedAt: LessThan(sixMonthsAgo) 
        }
      ]
    });
  
    return candidates;
  }

  private handleSaveError(error: any, reference?: string): never {
    if (error.code === 'ER_DUP_ENTRY' || error.message.includes('Duplicate entry')) {
      throw new ConflictException(
        reference 
          ? `La référence '${reference}' existe déjà`
          : 'Une ou plusieurs références existent déjà'
      );
    }
    throw error;
  }

  async save(
    createArticleDto: CreateArticleDto & { justificatifFile?: Express.Multer.File }
  ): Promise<ArticleEntity> {
    const articleData: DeepPartial<ArticleEntity> = {
      title: createArticleDto.title,
      description: createArticleDto.description,
      reference: createArticleDto.reference,
      quantityInStock: createArticleDto.quantityInStock,
      unitPrice: createArticleDto.unitPrice,
      status: createArticleDto.status as ArticleStatus || 'draft',
      notes: createArticleDto.notes,
    };

    if (createArticleDto.justificatifFile) {
      articleData.justificatifFile = {
        buffer: createArticleDto.justificatifFile.buffer,
        originalname: createArticleDto.justificatifFile.originalname,
        mimetype: createArticleDto.justificatifFile.mimetype,
        size: createArticleDto.justificatifFile.size
      };
      articleData.justificatifFileName = createArticleDto.justificatifFile.originalname;
      articleData.justificatifMimeType = createArticleDto.justificatifFile.mimetype;
      articleData.justificatifFileSize = createArticleDto.justificatifFile.size;
    }

    try {
      const article = this.articleRepository.create(articleData);
      return await this.articleRepository.save(article);
    } catch (error) {
      this.handleSaveError(error, createArticleDto.reference);
    }
  }

  async saveMany(
    createArticleDtos: (CreateArticleDto & { justificatifFile?: Express.Multer.File })[]
  ): Promise<ArticleEntity[]> {
    try {
      return await Promise.all(
        createArticleDtos.map(async dto => {
          const entityData: DeepPartial<ArticleEntity> = {
            title: dto.title,
            description: dto.description,
            reference: dto.reference,
            quantityInStock: dto.quantityInStock,
            unitPrice: dto.unitPrice,
            status: (dto.status as ArticleStatus) || 'draft',
            notes: dto.notes,
          };
  
          if (dto.justificatifFile) {
            const file: Express.Multer.File = {
              ...dto.justificatifFile,
              buffer: dto.justificatifFile.buffer,
              originalname: dto.justificatifFile.originalname,
              mimetype: dto.justificatifFile.mimetype,
              size: dto.justificatifFile.size,
              fieldname: dto.justificatifFile.fieldname || 'justificatifFile',
              encoding: dto.justificatifFile.encoding || '7bit',
              stream: null,
              destination: '',
              filename: dto.justificatifFile.originalname,
              path: ''
            };
  
            entityData.justificatifFile = file;
            entityData.justificatifFileName = file.originalname;
            entityData.justificatifMimeType = file.mimetype;
            entityData.justificatifFileSize = file.size;
          }
  
          const entity = this.articleRepository.create(entityData);
          return this.articleRepository.save(entity);
        })
      );
    } catch (error) {
      this.handleSaveError(error);
    }
  }

  async findAll(
    query: IQueryObject,
  ): Promise<{ total: number }> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const total = await this.articleRepository.getTotalCount({
      where: queryOptions.where,
    });
    return { total };
  }

// article.service.ts
async findNonArchivedPaginated(): Promise<ResponseArticleDto[]> {
  const articles = await this.articleRepository.find({
    where: {
      status: Not(In(['archived', 'deleted'])) // Filtre les articles archivés ET supprimés
    },
    relations: ['history'] // Conservez les relations nécessaires
  });

  return articles.map(article => this.mapToResponseDto(article));
}


async findAllArchived(): Promise<ResponseArticleDto[]> {
  const articles = await this.articleRepository.find({
    where: { status: 'archived' },
    relations: ['history']
  });
  return articles.map(article => this.mapToResponseDto(article));
}

async restoreArticle(id: number): Promise<ResponseArticleDto> {
  // 1. Restaurer le soft delete
  await this.articleRepository.update(id, { deletedAt: null });

  // 2. Mettre à jour le statut
  await this.articleRepository.update(id, { 
    status: 'active',
    version: () => "version + 1"
  });

  // 3. Récupérer l'article mis à jour
  const updatedArticle = await this.articleRepository.findOne({
    where: { id },
    relations: ['history']
  });

  if (!updatedArticle) {
    throw new NotFoundException('Article non trouvé après restauration');
  }

  return this.mapToResponseDto(updatedArticle);
}

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ResponseArticleDto>> {
    // Ajouter la condition pour exclure les articles archivés
    if (!query.filter) {
      query.filter = `status||$ne||archived`;
    } else {
      query.filter += `,status||$ne||archived`;
    }
  
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.articleRepository.getTotalCount({
      where: queryOptions.where,
    });
  
    const entities = await this.articleRepository.findAll(
      queryOptions as FindManyOptions<ArticleEntity>,
    );
  
    const responseDtos: ResponseArticleDto[] = entities.map(entity => {
      const dto: ResponseArticleDto = {
        id: entity.id,
        title: entity.title ?? undefined,
        description: entity.description ?? undefined,
        reference: entity.reference,
        quantityInStock: entity.quantityInStock,
        unitPrice: entity.unitPrice,
        status: entity.status,
        version: entity.version,
        notes: entity.notes ?? undefined,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt ?? undefined,
        justificatifFileName: entity.justificatifFileName ?? undefined,
        justificatifMimeType: entity.justificatifMimeType ?? undefined,
        justificatifFileSize: entity.justificatifFileSize ?? undefined
      };
  
      if (entity.justificatifFile) {
        dto.justificatifFile = {
          fieldname: 'justificatifFile',
          originalname: entity.justificatifFileName,
          encoding: '7bit',
          mimetype: entity.justificatifMimeType,
          size: entity.justificatifFileSize,
          buffer: entity.justificatifFile.buffer,
          stream: null,
          destination: '',
          filename: entity.justificatifFileName,
          path: ''
        } as Express.Multer.File;
      }
  
      if (entity.history) {
        dto.history = entity.history.map(historyItem => ({
          version: historyItem.version,
          changes: historyItem.changes,
          date: historyItem.date
        }));
      }
  
      return dto;
    });
  
    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page),
        take: parseInt(query.limit),
      },
      itemCount: count,
    });
  
    return new PageDto(responseDtos, pageMetaDto);
  }


  async getStockValueEvolution(days: number = 30): Promise<{ dates: string[]; values: number[] }> {
    try {
      const historyData = await this.articleHistoryService.getStockHistory(days);
      
      if (historyData.length === 0) {
        const currentArticles = await this.articleRepository.find({
          select: ['unitPrice', 'quantityInStock']
        });
        
        const totalValue = currentArticles.reduce((sum, article) => {
          return sum + (article.unitPrice || 0) * (article.quantityInStock || 1);
        }, 0);
        
        return {
          dates: [new Date().toISOString().split('T')[0]],
          values: [totalValue]
        };
      }
  
      const dailyValues: Record<string, number> = {};
      
      historyData.forEach(entry => {
        const dateStr = entry.date.toISOString().split('T')[0];
        const dailyValue = entry.unitPrice * (entry.quantityInStock || 1);
        
        dailyValues[dateStr] = (dailyValues[dateStr] || 0) + dailyValue;
      });
  
      const sortedDates = Object.keys(dailyValues).sort();
      const values = sortedDates.map(date => dailyValues[date]);
      
      return { dates: sortedDates, values };
    } catch (error) {
      console.error('Error in getStockValueEvolution:', error);
      return { dates: [], values: [] };
    }
  }
  
async update(id: number, updateArticleDto: UpdateArticleDto): Promise<ArticleEntity> {
    // Validation des champs numériques
    const numericFields = {
        quantityInStock: updateArticleDto.quantityInStock,
        unitPrice: updateArticleDto.unitPrice
    };
    
    for (const [field, value] of Object.entries(numericFields)) {
        if (value !== undefined && isNaN(Number(value))) {
            throw new BadRequestException(`${field} must be a valid number`);
        }
    }

    // Récupérer l'article actuel avant modification
    const currentArticle = await this.findOneById(id);

    // Conversion des types et préparation des données de mise à jour
    // avec incrémentation automatique de la version
    const updateData = {
        ...updateArticleDto,
        quantityInStock: updateArticleDto.quantityInStock !== undefined 
            ? Number(updateArticleDto.quantityInStock) 
            : undefined,
        unitPrice: updateArticleDto.unitPrice !== undefined 
            ? Number(updateArticleDto.unitPrice) 
            : undefined,
        version: currentArticle.version + 1 // Incrémentation automatique de la version
    };

    // Mettre à jour l'article
    await this.articleRepository.update(id, updateData);
    
    // Récupérer l'article mis à jour
    const updatedArticle = await this.articleRepository.findOne({ 
        where: { id },
        relations: ['history']
    });

    if (!updatedArticle) {
        throw new NotFoundException(`Article avec ID ${id} non trouvé après mise à jour`);
    }

    // Créer un snapshot de l'article avant modification
    const snapshot = {
        title: currentArticle.title,
        description: currentArticle.description,
        reference: currentArticle.reference,
        quantityInStock: currentArticle.quantityInStock,
        unitPrice: currentArticle.unitPrice,
        status: currentArticle.status,
        version: currentArticle.version,
        notes: currentArticle.notes,
        createdAt: currentArticle.createdAt,
        updatedAt: currentArticle.updatedAt
    };

    // Calculer les changements
    const changes = this.getChanges(currentArticle, updatedArticle);

    // Enregistrer dans l'historique seulement s'il y a des changements
    if (Object.keys(changes).length > 0) {
        await this.articleHistoryService.createHistoryEntry({
            version: updatedArticle.version, // Utilise la nouvelle version incrémentée
            changes,
            articleId: id,
            snapshot
        });
    }

    return updatedArticle;
}

async updateArticleStock(
    id: number,
    quantityChange: number
  ): Promise<ArticleEntity> {
    // 1. Trouver l'article existant
    const article = await this.findOneById(id);
    
    // 2. Vérifier que la quantité ne deviendra pas négative
    const newQuantity = article.quantityInStock + quantityChange;
    if (newQuantity < 0) {
      throw new BadRequestException(
        `La quantité ne peut pas devenir négative. Stock actuel: ${article.quantityInStock}, changement demandé: ${quantityChange}`
      );
    }

    // 3. Préparer les données de mise à jour
    const updatePayload: Partial<ArticleEntity> = {
      quantityInStock: newQuantity,
      version: article.version + 1,
      updatedAt: new Date()
    };

    // 4. Gérer l'historique des modifications
    const changes = this.getChanges(article, updatePayload);
    if (Object.keys(changes).length > 0) {
      await this.articleHistoryService.createHistoryEntry({
        version: updatePayload.version,
        changes,
        articleId: id,
        snapshot: article // or create a proper snapshot object if needed
      });
    }

    // 5. Appliquer la mise à jour
    await this.articleRepository.update(id, updatePayload);
    
    // 6. Retourner l'article mis à jour
    return this.articleRepository.findOne({ 
      where: { id },
      relations: ['history'] 
    });
  }
async findOneByReference(reference: string): Promise<ArticleEntity | null> {
    if (!reference) {
      return null;
    }
    
    try {
      const article = await this.articleRepository.findOne({ 
        where: { reference: ILike(reference) },
        relations: ['history']
      });
      
      return article || null;
    } catch (error) {
      console.error('Error finding article by reference:', error);
      return null;
    }
  }
   async checkArticleAvailability(articleId: number, requestedQuantity: number): Promise<{
    available: boolean;
    availableQuantity: number;
    message?: string;
  }> {
    const article = await this.findOneById(articleId);
    
    if (!article) {
      throw new NotFoundException(`Article avec ID ${articleId} non trouvé`);
    }
  
    const available = article.quantityInStock >= requestedQuantity;
    
    return {
      available,
      availableQuantity: article.quantityInStock,
      message: available 
        ? 'Quantité disponible'
        : `Quantité insuffisante. Stock disponible: ${article.quantityInStock}`
    };
  }
  private checkUpdateRestrictions(
    currentStatus: ArticleStatus,
    updateData: Partial<UpdateArticleDto>
  ): void {
    const alwaysUpdatableFields = ['status', 'notes', 'quantityInStock'];
    const restrictedFields = Object.keys(updateData).filter(
      field => !alwaysUpdatableFields.includes(field)
    );

    if (restrictedFields.length === 0) {
      return;
    }

    switch(currentStatus) {
      case 'inactive':
        throw new BadRequestException(
          'Les articles inactifs ne peuvent pas être modifiés. Activez-les d\'abord.'
        );

      case 'out_of_stock':
        throw new BadRequestException(
          'Les articles en rupture de stock ne peuvent pas être modifiés. Réapprovisionnez-les d\'abord.'
        );

      case 'archived':
      case 'deleted':
        throw new BadRequestException(
          `Les articles avec le statut "${currentStatus}" ne peuvent pas être modifiés.`
        );

      case 'draft':
      case 'pending_review':
      case 'active':
        break;

      default:
        throw new BadRequestException(
          `Statut "${currentStatus}" non reconnu.`
        );
    }
  }



  private getChanges(
    existingArticle: ArticleEntity,
    newData: Partial<ArticleEntity>,
  ): Record<string, { oldValue: any; newValue: any }> {
    const changes: Record<string, { oldValue: any; newValue: any }> = {};
  
    for (const key in newData) {
      if (newData[key] !== undefined && 
          existingArticle[key] !== newData[key] &&
          key !== 'version') {
        changes[key] = {
          oldValue: existingArticle[key],
          newValue: newData[key]
        };
      }
    }
  
    return changes;
  }

  async findOneById(id: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOne({ 
      where: { id },
      relations: ['history'] 
    });
    
    if (!article) {
      throw new NotFoundException(`Article avec ID ${id} non trouvé`);
    }
    return article;
  }
  
  
  
  async getArticleDetails(id: number): Promise<ArticleEntity> {
    return this.findOneById(id);
  }
  
  async deleteAll(): Promise<void> {
    await this.articleRepository.deleteAll();
  }

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ResponseArticleDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    
    const article = await this.articleRepository.findOne({
      ...queryOptions,
      relations: ['history']
    } as FindOneOptions<ArticleEntity>);
  
    if (!article) {
      return null;
    }
  
    return this.mapToResponseDto(article);
  }

  private mapToResponseDto(entity: ArticleEntity): ResponseArticleDto {
    const dto: ResponseArticleDto = {
      id: entity.id,
      title: entity.title ?? undefined,
      description: entity.description ?? undefined,
      reference: entity.reference,
      quantityInStock: entity.quantityInStock,
      unitPrice: entity.unitPrice,
      status: entity.status,
      version: entity.version,
      notes: entity.notes ?? undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt ?? undefined,
    };

    if (entity.justificatifFile) {
      dto.justificatifFile = {
        fieldname: 'justificatifFile',
        originalname: entity.justificatifFileName,
        encoding: '7bit',
        mimetype: entity.justificatifMimeType,
        size: entity.justificatifFileSize,
        buffer: entity.justificatifFile.buffer,
        stream: null,
        destination: '',
        filename: entity.justificatifFileName,
        path: ''
      } as Express.Multer.File;
    }

    if (entity.history) {
      dto.history = entity.history.map(historyItem => ({
        version: historyItem.version,
        changes: historyItem.changes,
        date: historyItem.date
      }));
    }

    return dto;
  }

  async restoreArticleVersion(articleId: number, targetVersion: number): Promise<ArticleEntity> {
    const article = await this.findOneById(articleId);
    this.permissionService.validateAction(article.status, ArticleAction.RESTORE_VERSION);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const currentArticle = await queryRunner.manager.findOne(ArticleEntity, {
        where: { id: articleId }
      });
      
      if (!currentArticle) {
        throw new NotFoundException('Article non trouvé');
      }

      const targetVersionEntry = await queryRunner.manager.findOne(ArticleHistoryEntity, {
        where: {
          article: { id: articleId },
          version: targetVersion
        }
      });

      if (!targetVersionEntry) {
        throw new NotFoundException(`Version ${targetVersion} non trouvée`);
      }

      const restoredArticle = this.articleRepository.create({
        ...currentArticle,
        version: currentArticle.version + 1,
        updatedAt: new Date()
      });

      const changes = targetVersionEntry.changes as Record<string, { oldValue: any; newValue: any }>;
      for (const [field, change] of Object.entries(changes)) {
        if (field in restoredArticle && field !== 'id') {
          restoredArticle[field] = this.convertFieldValue(field, change.oldValue);
        }
      }

      const newChanges = this.getChanges(currentArticle, restoredArticle);
      const newHistoryEntry = queryRunner.manager.create(ArticleHistoryEntity, {
        version: restoredArticle.version,
        changes: newChanges,
        article: { id: articleId }
      });

      await queryRunner.manager.save(restoredArticle);
      await queryRunner.manager.save(newHistoryEntry);

      await queryRunner.commitTransaction();

      return this.articleRepository.findOne({
        where: { id: articleId },
        relations: ['history']
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private convertFieldValue(field: string, value: any): any {
    switch(field) {
      case 'quantityInStock':
        return parseInt(value, 10);
      case 'unitPrice':
        return parseFloat(value);
      case 'status':
        return String(value);
      default:
        return value;
    }
  }
  
  async getAvailableVersions(articleId: number): Promise<Array<{ version: number; date?: Date }>> {
    const article = await this.articleRepository.findOne({ 
      where: { id: articleId }
    });
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }
  
    const history = await this.articleHistoryService.getArticleHistory(articleId);
    const versions = history.map(entry => ({
      version: entry.version,
      date: entry.date
    }));
  
    if (!versions.some(v => v.version === article.version)) {
      versions.push({
        version: article.version,
        date: article.updatedAt || article.createdAt
      });
    }
  
    return versions.sort((a, b) => b.version - a.version);
  }

  async useInQuote(articleId: number): Promise<void> {
    const article = await this.findOneById(articleId);
    this.permissionService.validateAction(article.status, ArticleAction.USE_IN_QUOTE);
    // Logique métier pour l'utilisation dans un devis
  }

  async useInOrder(articleId: number): Promise<void> {
    const article = await this.findOneById(articleId);
    this.permissionService.validateAction(article.status, ArticleAction.USE_IN_ORDER);
    // Logique métier pour l'utilisation dans une commande
  }

  async getSimpleStats() {
    const allArticles = await this.articleRepository.find();
    
    const stats = {
      totalArticles: allArticles.length,
      statusCounts: {},
      statusPercentages: {},
      outOfStockCount: allArticles.filter(a => 
        a.status === 'out_of_stock' || a.quantityInStock <= 0
      ).length,
      totalStockValue: allArticles.reduce((sum, a) => sum + (a.quantityInStock * Number(a.unitPrice)), 0),
      averageStockPerArticle: 0,
      lowStockCount: allArticles.filter(a => 
        a.quantityInStock > 0 && a.quantityInStock <= 5
      ).length,
      topStockValueArticles: [] as Array<{
        reference: string;
        title: string;
        value: number;
        status: string;
      }>,
      toArchiveSuggestions: [] as string[],
      stockHealth: {
        activeWithStock: allArticles.filter(a => 
          a.status === 'active' && a.quantityInStock > 0
        ).length,
        inactiveWithStock: allArticles.filter(a => 
          a.status !== 'active' && a.quantityInStock > 0
        ).length
      }
    };

    allArticles.forEach(article => {
      stats.statusCounts[article.status] = (stats.statusCounts[article.status] || 0) + 1;
    });

    for (const status in stats.statusCounts) {
      stats.statusPercentages[status] = 
        ((stats.statusCounts[status] / stats.totalArticles) * 100).toFixed(2) + '%';
    }

    stats.averageStockPerArticle = stats.totalArticles > 0 
      ? stats.totalStockValue / stats.totalArticles 
      : 0;

    stats.topStockValueArticles = allArticles
      .filter(a => a.quantityInStock > 0)
      .map(a => ({
        reference: a.reference,
        title: a.title || 'Sans titre',
        value: a.quantityInStock * Number(a.unitPrice),
        status: a.status
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    stats.toArchiveSuggestions = allArticles
      .filter(a => a.status === 'inactive' && a.updatedAt < sixMonthsAgo)
      .map(a => a.reference);

    return stats;
  }

  async getStockAlerts() {
    const allArticles = await this.articleRepository.find();
    
    return {
      outOfStock: allArticles
        .filter(a => a.quantityInStock === 0)
        .map(a => ({
          reference: a.reference,
          title: a.title,
          daysOutOfStock: Math.floor((new Date().getTime() - a.updatedAt.getTime()) / (1000 * 3600 * 24))
        })),
      
      lowStock: allArticles
        .filter(a => a.quantityInStock > 0 && a.quantityInStock <= 5)
        .map(a => ({
          reference: a.reference,
          title: a.title,
          remainingStock: a.quantityInStock
        }))
    };
  }

  async getStatusOverview() {
    const allArticles = await this.articleRepository.find();
    
    const counts = {
      draft: 0,
      active: 0,
      inactive: 0,
      archived: 0,
      out_of_stock: 0,
      pending_review: 0,
      deleted: 0
    };
  
    const examples = {};
  
    allArticles.forEach(article => {
      counts[article.status]++;
      
      if (!examples[article.status]) {
        examples[article.status] = [];
      }
      
      if (examples[article.status].length < 2) {
        examples[article.status].push({
          reference: article.reference,
          title: article.title
        });
      }
    });
  
    const filteredCounts = Object.fromEntries(
      Object.entries(counts).filter(([_, count]) => count > 0)
    );
  
    return {
      counts: filteredCounts,
      examples,
      total: allArticles.length
    };
  }

  async getArticleQualityScores(): Promise<{
    scores: Array<{
      id: number;
      reference: string;
      title?: string;
      score: number;
      missingFields: string[];
    }>;
    incompleteArticles: Array<{
      id: number;
      reference: string;
      title?: string;
      score: number;
    }>;
  }> {
    const allArticles = await this.articleRepository.find();
    
    const results = allArticles.map(article => {
      const missingFields = [];
      let score = 0;

      if (article.description) score += 25; else missingFields.push('description');
      if (article.justificatifFile) score += 25; else missingFields.push('justificatif');
      if (article.notes) score += 25; else missingFields.push('notes');
      if (article.quantityInStock > 0) score += 25; else missingFields.push('stock');

      return {
        id: article.id,
        reference: article.reference,
        title: article.title,
        score,
        missingFields
      };
    });

    return {
      scores: results,
      incompleteArticles: results
        .filter(item => item.score < 100)
        .sort((a, b) => a.score - b.score)
    };
  }

  async detectSuspiciousArticles(): Promise<{
    zeroPrice: Array<{ id: number; reference: string; title?: string }>;
    highStock: Array<{ id: number; reference: string; title?: string; quantity: number }>;
    invalidReference: Array<{ id: number; reference: string; title?: string }>;
  }> {
    const allArticles = await this.articleRepository.find();
    const referenceRegex = /^[A-Z0-9]{3,}-[0-9]{3,}$/;

    return {
      zeroPrice: allArticles
        .filter(a => a.unitPrice === 0)
        .map(a => ({ id: a.id, reference: a.reference, title: a.title })),

      highStock: allArticles
        .filter(a => a.quantityInStock > 10000)
        .map(a => ({ 
          id: a.id, 
          reference: a.reference, 
          title: a.title, 
          quantity: a.quantityInStock 
        })),

      invalidReference: allArticles
        .filter(a => !referenceRegex.test(a.reference))
        .map(a => ({ id: a.id, reference: a.reference, title: a.title }))
    };
  }

  async comparePriceTrends(): Promise<{
    oldArticles: {
      count: number;
      averagePrice: number;
    };
    newArticles: {
      count: number;
      averagePrice: number;
    };
    priceEvolution: {
      amount: number;
      percentage: number;
      trend: 'up' | 'down' | 'stable';
    };
  }> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const allArticles = await this.articleRepository.find();
    
    const oldArticles = allArticles.filter(a => a.createdAt < oneYearAgo);
    const newArticles = allArticles.filter(a => a.createdAt >= oneYearAgo);

    const avgOld = oldArticles.reduce((sum, a) => sum + a.unitPrice, 0) / (oldArticles.length || 1);
    const avgNew = newArticles.reduce((sum, a) => sum + a.unitPrice, 0) / (newArticles.length || 1);

    const amountDiff = avgNew - avgOld;
    const percentDiff = (amountDiff / avgOld) * 100;

    return {
      oldArticles: {
        count: oldArticles.length,
        averagePrice: parseFloat(avgOld.toFixed(2))
      },
      newArticles: {
        count: newArticles.length,
        averagePrice: parseFloat(avgNew.toFixed(2))
      },
      priceEvolution: {
        amount: parseFloat(amountDiff.toFixed(2)),
        percentage: parseFloat(percentDiff.toFixed(2)),
        trend: amountDiff > 0 ? 'up' : amountDiff < 0 ? 'down' : 'stable'
      }
    };
  }

  async getStockHealth(): Promise<{
    activePercentage: number;
    status: 'poor' | 'medium' | 'good';
    details: Record<string, number>;
  }> {
    const allArticles = await this.articleRepository.find();
    const statusCounts = {};

    allArticles.forEach(a => {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    });

    const activePercentage = (statusCounts['active'] || 0) / allArticles.length * 100;

    return {
      activePercentage: parseFloat(activePercentage.toFixed(2)),
      status: activePercentage < 30 ? 'poor' : 
              activePercentage < 70 ? 'medium' : 'good',
      details: statusCounts
    };
  }

  async getTopOutOfStockRisk(): Promise<ArticleStatsResponseDto> {
    const allArticles = await this.articleRepository.find();
    const riskArticles = await this.articleRepository.find({
      where: {
        status: 'active',
        quantityInStock: MoreThan(0)
      },
      order: {
        quantityInStock: 'ASC'
      },
      take: 5,
      relations: ['history']
    });

    const totalArticles = allArticles.length;
    const outOfStockCount = allArticles.filter(a => a.quantityInStock <= 0).length;
    const totalStockAvailable = allArticles.reduce((sum, a) => sum + a.quantityInStock, 0);
    
    const statusDistribution = {};
    const statusPercentages = {};
    allArticles.forEach(article => {
      statusDistribution[article.status] = (statusDistribution[article.status] || 0) + 1;
    });
    for (const status in statusDistribution) {
      statusPercentages[status] = ((statusDistribution[status] / totalArticles) * 100).toFixed(2) + '%';
    }

    const riskArticlesDto = riskArticles.map(article => this.mapToResponseDto(article));

    return {
      totalArticles,
      statusDistribution,
      statusPercentages,
      outOfStockCount,
      totalStockAvailable,
      averageStockPerArticle: totalArticles > 0 ? totalStockAvailable / totalArticles : 0,
      lowStockCount: allArticles.filter(a => a.quantityInStock > 0 && a.quantityInStock <= 5).length,
      outOfStockSinceDays: {},
      topStockValueArticles: riskArticlesDto.map(a => ({
        reference: a.reference,
        value: a.quantityInStock * a.unitPrice
      })),
      stockRiskPredictions: riskArticlesDto.map(a => ({
        reference: a.reference,
        daysToOutOfStock: this.calculateDaysToOutOfStock(a)
      })),
      toArchiveSuggestions: []
    };
  }

  private calculateDaysToOutOfStock(article: ResponseArticleDto): number {
    if (article.history) {
      const lastMonthConsumption = this.calculateConsumption(article.history);
      if (lastMonthConsumption > 0) {
        return Math.floor(article.quantityInStock / (lastMonthConsumption / 30));
      }
    }
    return 0;
  }

  private calculateConsumption(history: any[]): number {
    return 10;
  }

  async createFromOcrData(ocrData: ArticleData): Promise<ArticleEntity> {
    if (!ocrData?.reference) {
      throw new BadRequestException('La référence est obligatoire');
    }

    const normalizedData = {
      title: ocrData.title?.trim() || 'Sans titre',
      description: ocrData.description?.trim() || '',
      reference: ocrData.reference.trim(),
      quantityInStock: Number(ocrData.quantityInStock) || 0,
      unitPrice: Number(ocrData.unitPrice) || 0,
      status: this.normalizeStatus(ocrData.status),
      notes: ocrData.notes?.trim() || ''
    };

    const existingArticle = await this.articleRepository.findOne({
      where: { reference: normalizedData.reference },
      select: ['id']
    });

    if (existingArticle) {
      throw new ConflictException(`Un article avec la référence "${normalizedData.reference}" existe déjà`);
    }

    if (normalizedData.quantityInStock < 0) {
      throw new BadRequestException('La quantité ne peut pas être négative');
    }

    return this.save(normalizedData);
  }

  private normalizeStatus(status?: string): ArticleStatus {
    const validStatuses: ArticleStatus[] = ['draft', 'active', 'inactive'];
    return validStatuses.includes(status?.toLowerCase() as ArticleStatus) 
      ? status.toLowerCase() as ArticleStatus 
      : 'draft';
  }

  async getTotal(): Promise<number> {
    return this.articleRepository.getTotalCount();
  }

  async findAllByReference(reference: string): Promise<ArticleEntity[]> {
  if (!reference) {
    return [];
  }
  
  try {
    return await this.articleRepository.find({ 
      where: { reference: ILike(`%${reference}%`) },
      relations: ['history']
    });
  } catch (error) {
    console.error('Error finding articles by reference:', error);
    return [];
  }
}
}
