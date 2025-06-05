import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ArticleHistoryEntity } from '../repositories/entities/article-history.entity';
import { ArticleHistoryRepository } from '../repositories/repository/article-history.repository';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';
import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';

@Injectable()
export class ArticleHistoryService {
  constructor(
    private readonly articleHistoryRepository: ArticleHistoryRepository,
    private readonly pdfService: PdfService,
    @InjectRepository(ArticleEntity)
    private readonly articleRepository: Repository<ArticleEntity>,
    private readonly dataSource: DataSource // Ajoutez cette ligne

  ) {}
  
//
async restoreVersion(articleId: number, version: number): Promise<void> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // Désactiver toutes les versions de cet article
    await queryRunner.manager.update(
      ArticleHistoryEntity,
      { articleId },
      { isActive: false }
    );

    // Activer la version spécifiée
    await queryRunner.manager.update(
      ArticleHistoryEntity,
      { articleId, version },
      { isActive: true }
    );

    // Mettre à jour l'article avec les données de la version restaurée
    const versionToRestore = await queryRunner.manager.findOne(ArticleHistoryEntity, {
      where: { articleId, version }
    });

    if (!versionToRestore) {
      throw new NotFoundException(`Version ${version} non trouvée`);
    }

    const articleUpdates = {};
    for (const [field, change] of Object.entries(versionToRestore.changes)) {
      articleUpdates[field] = change.newValue;
    }

    await queryRunner.manager.update(
      ArticleEntity,
      { id: articleId },
      { ...articleUpdates, version }
    );

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
async getStockHistory(days: number): Promise<Array<{
  date: Date;
  unitPrice: number;
  quantityInStock: number;
}>> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  try {
    const results = await this.articleHistoryRepository
      .createQueryBuilder('history')
      .select('history.date', 'date')
      .addSelect('history.changes->"$.unitPrice.newValue"', 'unitPrice')
      .addSelect('history.changes->"$.quantityInStock.newValue"', 'quantityInStock')
      .where('history.date >= :startDate', { startDate })
      .andWhere('(JSON_CONTAINS_PATH(history.changes, \'one\', \'$.unitPrice\') = 1)') // Seulement si unitPrice existe
      .orderBy('history.date', 'ASC')
      .getRawMany();

    return results.filter(r => r.unitPrice !== null).map(r => ({
      date: r.date,
      unitPrice: parseFloat(r.unitPrice) || 0,
      quantityInStock: r.quantityInStock ? parseInt(r.quantityInStock) : 1 // Default à 1 si null
    }));
  } catch (error) {
    console.error('Error fetching stock history:', error);
    return [];
  }
}


async getActiveVersion(articleId: number): Promise<ArticleHistoryEntity | null> {
  return this.articleHistoryRepository.findOne({
    where: { articleId, isActive: true }
  });
}

async createHistoryEntry(historyData: {
  version: number;
  changes: Record<string, { oldValue: any; newValue: any }>;
  articleId: number; // S'assurer que c'est toujours un nombre
}): Promise<ArticleHistoryEntity> {
  // Validation de l'articleId
  if (!historyData.articleId || isNaN(historyData.articleId)) {
    throw new BadRequestException('articleId must be a valid number');
  }

  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // Vérifier que l'article existe
    const articleExists = await queryRunner.manager.findOne(ArticleEntity, {
      where: { id: historyData.articleId }
    });
    
    if (!articleExists) {
      throw new NotFoundException(`Article with ID ${historyData.articleId} not found`);
    }

    // Désactiver toutes les versions précédentes
    await queryRunner.manager.update(
      ArticleHistoryEntity,
      { articleId: historyData.articleId },
      { isActive: false }
    );

    // Créer la nouvelle entrée active
    const newEntry = await queryRunner.manager.save(ArticleHistoryEntity, {
      ...historyData,
      isActive: true
    });

    await queryRunner.commitTransaction();
    return newEntry;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}




  async getArticleHistory(articleId: number): Promise<ArticleHistoryEntity[]> {
    const history = await this.articleHistoryRepository.find({
      where: { articleId },
      order: { version: 'ASC' },
    });

    if (!history || history.length === 0) {
      throw new NotFoundException(`Aucun historique trouvé pour l'article ${articleId}`);
    }

    return history;
  }


  private async findArticleById(articleId: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOne({ 
      where: { id: articleId },
      relations: ['history']
    });
    
    if (!article) {
      throw new NotFoundException(`Article ${articleId} non trouvé`);
    }
    return article;
  }


 /* async downloadVersionPdf(articleId: number, version: number): Promise<Buffer> {
    return this.generateSingleVersionPdf(articleId, version);
  }


  async generateSingleVersionPdf(articleId: number, version: number): Promise<Buffer> {
    const article = await this.findArticleById(articleId);

    if (version === article.version) {
      return this.generateCurrentVersionPdf(article);
    }

    const history = await this.getArticleHistory(articleId);
    const versionEntry = history.find(entry => entry.version === version);
    
    if (!versionEntry) {
      throw new NotFoundException(`Version ${version} non trouvée dans l'historique`);
    }

    const articleState = this.reconstructArticleState(history, version);
    
    return this.pdfService.generatePdf({
      version: version,
      date: versionEntry.date.toISOString(),
      article: articleState,
      changes: versionEntry.changes,
    }, 'template4');
  }


  private async generateCurrentVersionPdf(article: ArticleEntity): Promise<Buffer> {
    return this.pdfService.generatePdf({
      version: article.version,
      date: new Date().toISOString(),
      article: this.extractArticleState(article),
      changes: {},
    }, 'template4');
  }*/

 /* private extractArticleState(article: ArticleEntity): Partial<ArticleEntity> {
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      reference: article.reference,
      quantityInStock: article.quantityInStock,
      status: article.status,
      version: article.version,
      notes: article.notes,
    };
  }*/

 /* private reconstructArticleState(
    history: ArticleHistoryEntity[],
    targetVersion: number,
  ): Partial<ArticleEntity> {
    let articleState: Partial<ArticleEntity> = {};

    for (const entry of history) {
      if (entry.version > targetVersion) break;
      for (const [field, change] of Object.entries(entry.changes)) {
        articleState[field] = change.newValue;
      }
    }

    return articleState;
  }
*/
  /**
   * (Optionnel) Génère tous les PDFs pour archivage
   
  async generateAllVersionPdfs(articleId: number): Promise<string[]> {
    const article = await this.findArticleById(articleId);
    const articleDir = path.join(__dirname, '..', '..', 'uploads', `article_${articleId}`);
    
    if (!fs.existsSync(articleDir)) {
      fs.mkdirSync(articleDir, { recursive: true });
    }

    const filePaths: string[] = [];
    const history = await this.getArticleHistory(articleId);

    // Générer les PDFs historiques
    for (const entry of history) {
      const pdfBuffer = await this.generateSingleVersionPdf(articleId, entry.version);
      const filePath = path.join(articleDir, `article_${articleId}_version_${entry.version}.pdf`);
      fs.writeFileSync(filePath, pdfBuffer);
      filePaths.push(filePath);
    }

    // Générer le PDF actuel
    const currentPdfBuffer = await this.generateCurrentVersionPdf(article);
    const currentFilePath = path.join(articleDir, `article_${articleId}_version_${article.version}.pdf`);
    fs.writeFileSync(currentFilePath, currentPdfBuffer);
    filePaths.push(currentFilePath);

    return filePaths;
  }
*/
  ////////////
  // article-history.service.ts


  ////////

  async downloadVersionPdf(articleId: number, version: number): Promise<Buffer> {
    return this.generateSingleVersionPdf(articleId, version);
}

async generateSingleVersionPdf(articleId: number, version: number): Promise<Buffer> {
  const article = await this.findArticleById(articleId);

  if (version === article.version) {
      return this.generateCurrentVersionPdf(article);
  }

  const history = await this.getArticleHistory(articleId);
  const versionEntry = history.find(entry => entry.version === version);
  
  if (!versionEntry) {
      throw new NotFoundException(`Version ${version} non trouvée dans l'historique`);
  }

  // Reconstruire l'état de l'article à cette version
  const articleState = this.reconstructArticleState(history, version);
  
  // Formater les données pour le template
  const pdfData = {
      version: version,
      date: versionEntry.date,
      article: {
          ...articleState,
          // Assurer que tous les champs sont présents
          reference: articleState.reference || 'Non spécifiée',
          title: articleState.title || 'Non spécifié',
          description: articleState.description || 'Aucune description',
          quantityInStock: articleState.quantityInStock ?? 0,
          status: articleState.status || 'draft',
          notes: articleState.notes || 'Aucune note',
          unitPrice: articleState.unitPrice ?? 0,
          createdAt: articleState.createdAt || article.createdAt,
          updatedAt: articleState.updatedAt || versionEntry.date,
          // Champs justificatifs
          justificatifFileName: articleState.justificatifFileName,
          justificatifMimeType: articleState.justificatifMimeType,
          justificatifFileSize: articleState.justificatifFileSize
      },
      changes: versionEntry.changes || {},
  };

  return this.pdfService.generatePdf(pdfData, 'template4');
}

private async generateCurrentVersionPdf(article: ArticleEntity): Promise<Buffer> {
    return this.pdfService.generatePdf({
        version: article.version,
        date: new Date().toISOString(),
        article: this.extractArticleState(article),
        changes: {},
    }, 'template4');
}

private extractArticleState(article: ArticleEntity): Partial<ArticleEntity> {
    return {
        id: article.id,
        title: article.title,
        description: article.description,
        reference: article.reference,
        quantityInStock: article.quantityInStock,
        status: article.status,
        version: article.version,
        notes: article.notes,
        unitPrice: article.unitPrice, // Ajouté car utilisé dans le template
        justificatifFileName: article.justificatifFileName, // Ajouté car utilisé dans le template
        justificatifMimeType: article.justificatifMimeType, // Ajouté car utilisé dans le template
        justificatifFileSize: article.justificatifFileSize // Ajouté car utilisé dans le template
    };
}

private reconstructArticleState(
  history: ArticleHistoryEntity[],
  targetVersion: number,
): Partial<ArticleEntity> {
  let articleState: Partial<ArticleEntity> = {
      // Valeurs par défaut importantes
      status: 'draft',
      description: '',
      reference: '',
      notes: ''
  };

  const sortedHistory = [...history].sort((a, b) => a.version - b.version);

  for (const entry of sortedHistory) {
      if (entry.version > targetVersion) break;
      if (entry.changes) {
          for (const [field, change] of Object.entries(entry.changes)) {
              articleState[field] = change.newValue;
          }
      }
  }

  return articleState;
}
private validateArticleState(articleState: Partial<ArticleEntity>) {
  if (!articleState.reference) {
      articleState.reference = 'Non spécifiée';
  }
  if (!articleState.description) {
      articleState.description = 'Aucune description';
  }
  if (!articleState.status) {
      articleState.status = 'inactive';
  }
  return articleState;
}
async generateAllVersionPdfs(articleId: number): Promise<string[]> {
    const article = await this.findArticleById(articleId);
    const articleDir = path.join(__dirname, '..', '..', 'uploads', `article_${articleId}`);
    
    if (!fs.existsSync(articleDir)) {
        fs.mkdirSync(articleDir, { recursive: true });
    }

    const filePaths: string[] = [];
    const history = await this.getArticleHistory(articleId);

    // Générer les PDFs historiques
    for (const entry of history) {
        const pdfBuffer = await this.generateSingleVersionPdf(articleId, entry.version);
        const filePath = path.join(articleDir, `article_${articleId}_version_${entry.version}.pdf`);
        await fs.promises.writeFile(filePath, pdfBuffer); // Utilisation de la version async
        filePaths.push(filePath);
    }

    // Générer le PDF actuel
    const currentPdfBuffer = await this.generateCurrentVersionPdf(article);
    const currentFilePath = path.join(articleDir, `article_${articleId}_version_${article.version}.pdf`);
    await fs.promises.writeFile(currentFilePath, currentPdfBuffer); // Utilisation de la version async
    filePaths.push(currentFilePath);

    return filePaths;
}


  /////////

async deleteVersion(articleId: number, versionToDelete: number): Promise<void> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
      // 1. Vérifier que l'article existe
      const article = await queryRunner.manager.findOne(ArticleEntity, {
          where: { id: articleId }
      });
      if (!article) {
          throw new NotFoundException('Article non trouvé');
      }

      // 2. Vérifier que la version à supprimer existe
      const versionEntry = await queryRunner.manager.findOne(ArticleHistoryEntity, {
          where: { articleId, version: versionToDelete }
      });
      if (!versionEntry) {
          throw new NotFoundException(`Version ${versionToDelete} non trouvée`);
      }

      // 3. Supprimer la version
      await queryRunner.manager.delete(ArticleHistoryEntity, {
          articleId,
          version: versionToDelete
      });

      // 4. Décrémenter les versions supérieures
      await queryRunner.manager
          .createQueryBuilder()
          .update(ArticleHistoryEntity)
          .set({ version: () => "version - 1" })
          .where("articleId = :articleId AND version > :version", {
              articleId,
              version: versionToDelete
          })
          .execute();

      // 5. Mettre à jour la version de l'article si nécessaire
      if (article.version > versionToDelete) {
          await queryRunner.manager.update(ArticleEntity, articleId, {
              version: article.version - 1
          });
      }

      await queryRunner.commitTransaction();
  } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
  } finally {
      await queryRunner.release();
  }
}

async getStatusChangeCount(startDate: Date, endDate: Date): Promise<number> {
  const queryBuilder = this.articleHistoryRepository.createQueryBuilder('history');
  
  const result = await queryBuilder
    .select('COUNT(history.id)', 'count')
    .where('history.date BETWEEN :startDate AND :endDate', { 
      startDate, 
      endDate 
    })
    .andWhere('JSON_CONTAINS_PATH(history.changes, \'one\', \'$.status\') = 1')
    .getRawOne();

  return result?.count || 0;
}

}