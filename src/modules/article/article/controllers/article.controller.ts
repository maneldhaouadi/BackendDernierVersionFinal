import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  ParseIntPipe,
  InternalServerErrorException,
  HttpException,
  HttpCode,
  HttpStatus,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiTags, ApiParam, ApiConsumes, ApiBody, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { ArticleService } from '../services/article.service';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import { ArticleCompareResponseDto } from '../dtos/article-compare.dto';
import { PdfExtractionService } from 'src/modules/pdf-extraction/services/pdf-extraction.service';
import { multerOptions } from 'src/configs/multer.config';
import { ArticleEntity } from '../repositories/entities/article.entity';
import { ArticleData, ArticleStatus } from '../interfaces/article-data.interface';
import { ArticleStatsResponseDto } from '../dtos/article-stats.response.dto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ArticlePermissionService } from '../services/article-permission.service';
import { ArticleOcrService } from 'src/modules/ocr/ocr/services/articleOcrService';
///test test test 


@ApiTags('article')
@Controller({
  version: '1',
  path: '/article',
})
export class ArticleController {
  constructor(
    private readonly articleService: ArticleService,
    private readonly articleOcrService: ArticleOcrService,
    private readonly pdfExtractionService: PdfExtractionService,
    private readonly permissionService: ArticlePermissionService

  ) {}


  @Get('active')
  @ApiOperation({ summary: 'Get all active (non-archived) articles' })
  @ApiResponse({ 
    status: 200, 
    description: 'List of active articles',
    type: ResponseArticleDto,
    isArray: true 
  })
  async getActiveArticles(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10
  ): Promise<ResponseArticleDto[]> {
    const articles = await this.articleService.getActiveArticles(page, limit);
    return articles.map(article => this.mapToResponseDto(article));
  }

  
  
  @Get('/archives')
  @ApiOperation({ summary: 'Get all archived articles' })
  @ApiResponse({
    status: 200,
    description: 'List of all archived articles',
    type: ResponseArticleDto,
    isArray: true
  })
  async getArchivedArticles(): Promise<ResponseArticleDto[]> {
    return this.articleService.findAllArchived();
  }

  @Post(':id/restore')
@ApiOperation({ summary: 'Restore an archived article' })
@ApiParam({ name: 'id', description: 'Article ID to restore' })
@ApiResponse({ 
  status: 200, 
  description: 'Article successfully restored',
  type: ResponseArticleDto
})
async restoreArticle(
  @Param('id', ParseIntPipe) id: number
): Promise<ResponseArticleDto> {
  return this.articleService.restoreArticle(id);
}

 @Get(':id/check-availability')
@ApiOperation({ summary: 'Vérifier la disponibilité d\'un article' })
@ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
async checkAvailability(
  @Param('id', ParseIntPipe) id: number,
  @Query('quantity', ParseIntPipe) quantity: number
) {
  if (quantity <= 0) {
    throw new BadRequestException('La quantité doit être un nombre positif');
  }

  return this.articleService.checkArticleAvailability(id, quantity);
}


  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive an article' })
  @ApiParam({ name: 'id', description: 'Article ID to archive', type: Number })
  @ApiResponse({ 
    status: 200, 
    description: 'Article successfully archived',
    type: ResponseArticleDto
  })
  async archiveArticle(@Param('id') id: string): Promise<ResponseArticleDto> {
    const article = await this.articleService.archiveArticle(+id);
    return this.mapToResponseDto(article);
  }
  
  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Unarchive an article' })
  @ApiParam({ name: 'id', description: 'Article ID to unarchive', type: Number })
  @ApiResponse({ 
    status: 200, 
    description: 'Article successfully unarchived',
    type: ResponseArticleDto
  })
  async unarchiveArticle(@Param('id') id: string): Promise<ResponseArticleDto> {
    const article = await this.articleService.unarchiveArticle(+id);
    return this.mapToResponseDto(article);
  }

  private mapToResponseDto(entity: ArticleEntity): ResponseArticleDto {
    return {
      id: entity.id,
      title: entity.title,
      description: entity.description,
      reference: entity.reference,
      quantityInStock: entity.quantityInStock,
      unitPrice: entity.unitPrice,
      status: entity.status,
      version: entity.version,
      notes: entity.notes,
      justificatifFile: entity.justificatifFile,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
      history: entity.history?.map(history => ({
        version: history.version,
        changes: history.changes,
        date: history.date
      }))
    };
  }
///////////////



@Post(':id/use-in-quote')
  async useInQuote(@Param('id') id: number): Promise<void> {
    return this.articleService.useInQuote(id);
  }

  @Post(':id/use-in-order')
  async useInOrder(@Param('id') id: number): Promise<void> {
    return this.articleService.useInOrder(id);
  }

  @Post(':id/restore-version/:version')
  async restoreVersion(
    @Param('id') id: number,
    @Param('version') version: number
  ): Promise<ResponseArticleDto> {
    return this.articleService.restoreArticleVersion(id, version);
  }

  @Put(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: number,
    @Body('status') newStatus: ArticleStatus
  ): Promise<ResponseArticleDto> {
    const updatedArticle = await this.articleService.updateStatus(id, newStatus);
    
    // Transformation directe de l'entité en DTO
    return {
      id: updatedArticle.id,
      title: updatedArticle.title,
      description: updatedArticle.description,
      reference: updatedArticle.reference,
      quantityInStock: updatedArticle.quantityInStock,
      status: updatedArticle.status,
      unitPrice: updatedArticle.unitPrice,
      version: updatedArticle.version,
      createdAt: updatedArticle.createdAt,
      updatedAt: updatedArticle.updatedAt
    };
  }

  








///////////////////

  //new stats 
// Dans ArticleController
@Get('/stats/simple-stock')
async getSimpleStockStatus() {
  return this.articleService.getSimplifiedStockStatus();
}

@Get('/stats/top-valued')
async getTopValued() {
  return this.articleService.getTopValuedArticles();
}

@Get('/stats/avg-price-status')
async getAvgPriceByStatus() {
  return this.articleService.getAveragePriceByStatus();
}

  //

/////////////status



@Post('bulk-status-update')
@ApiOperation({ summary: 'Mettre à jour le statut de plusieurs articles' })
async bulkUpdateStatus(
  @Body() body: { ids: number[], status: ArticleStatus }
) {
  const results = await Promise.all(
    body.ids.map(id => 
      this.articleService.updateStatus(id, body.status)
        .then(article => ({ id, success: true, article }))
        .catch(error => ({ id, success: false, error: error.message }))
  ));

  return {
    total: results.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    details: results
  };
}

/////////////////

//////////////////////////// debut stats 


  @Get('/stats/simple')
  @ApiOperation({ summary: 'Obtenir des statistiques simplifiées sur les articles' })
  async getSimpleStats() {
    return this.articleService.getSimpleStats();
  }

  @Get('/stats/stock-alerts')
  @ApiOperation({ summary: 'Obtenir les alertes de stock' })
  async getStockAlerts() {
    return this.articleService.getStockAlerts();
  }

  @Get('/stats/status-overview')
  @ApiOperation({ summary: 'Aperçu des statuts des articles' })
  async getStatusOverview() {
    return this.articleService.getStatusOverview();
  }



  //fin stats 



  //prediction 
// Dans ArticleController

@Get('stats/quality-scores')
@ApiOperation({ summary: 'Obtenir les scores de qualité des articles' })
async getQualityScores() {
  return this.articleService.getArticleQualityScores();
}

@Get('stats/suspicious-articles')
@ApiOperation({ summary: 'Détecter les articles suspects' })
async getSuspiciousArticles() {
  return this.articleService.detectSuspiciousArticles();
}

@Get('stats/price-trends')
@ApiOperation({ summary: 'Comparaison des prix anciens vs nouveaux' })
async comparePriceTrends() {
  return this.articleService.comparePriceTrends();
}

@Get('stats/stock-health')
@ApiOperation({ summary: 'État de santé global du stock' })
async getStockHealth() {
  return this.articleService.getStockHealth();
}








  ///

  @Post('/save')
  @UseInterceptors(FileInterceptor('justificatifFile'))
  @ApiOperation({ summary: 'Créer un nouvel article' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Données de l\'article à créer',
    type: CreateArticleDto,
  })
  async save(
    @UploadedFile() file: Express.Multer.File,
    @Body() createArticleDto: CreateArticleDto | CreateArticleDto[]
  ): Promise<ResponseArticleDto | ResponseArticleDto[]> {
    if (Array.isArray(createArticleDto)) {
      const articles = await this.articleService.saveMany(createArticleDto);
      return articles.map(article => this.mapToResponseDto(article));
    } else {
      const article = await this.articleService.save({
        ...createArticleDto,
        justificatifFile: file
      });
      return this.mapToResponseDto(article);
    }
  }
  
  @Post('/save-many')
  @ApiOperation({ summary: 'Créer plusieurs articles' })
  async saveMany(@Body() createArticleDtos: CreateArticleDto[]): Promise<ResponseArticleDto[]> {
    const articles = await this.articleService.saveMany(createArticleDtos);
    return articles.map(article => this.mapToResponseDto(article));
  }

  @Get('/all')
  @ApiOperation({ summary: 'Obtenir le nombre total d\'articles' })
  async findAll(@Query() options: IQueryObject): Promise<{ total: number }> {
    return await this.articleService.findAll(options);
  }

  @Get('/list')
  @ApiOperation({ summary: 'Lister les articles avec pagination' })
  async findAllPaginated(@Query() query: IQueryObject): Promise<PageDto<ResponseArticleDto>> {
    return await this.articleService.findAllPaginated(query);
  }
  
// article.controller.ts
@Get('/list/active')
@ApiOperation({ summary: 'Get active (non-archived) articles' })
@ApiResponse({ 
  status: 200, 
  description: 'Array of active articles',
  type: ResponseArticleDto,
  isArray: true // Important pour Swagger
})
async findActiveArticles(): Promise<ResponseArticleDto[]> {
  try {
    return await this.articleService.findNonArchivedPaginated();
  } catch (error) {
    throw new HttpException(
      `Failed to retrieve active articles: ${error.message}`,
      HttpStatus.BAD_REQUEST
    );
  }
}

  // Dans ArticleController

@Get('/search')
@ApiOperation({ summary: 'Rechercher des articles par titre' })
async searchByTitle(
  @Query('title') title: string,
  @Query() query: IQueryObject
): Promise<PageDto<ResponseArticleDto>> {
  if (title) {
    query.filter = query.filter 
      ? `${query.filter},title||$cont||${title}`
      : `title||$cont||${title}`;
  }
  
  return this.articleService.findAllPaginated(query);
}

@Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateArticleDto: UpdateArticleDto
  ) {
    // Conversion explicite des nombres
    const updateData = {
      ...updateArticleDto,
      quantityInStock: updateArticleDto.quantityInStock ? Number(updateArticleDto.quantityInStock) : undefined,
      unitPrice: updateArticleDto.unitPrice ? Number(updateArticleDto.unitPrice) : undefined,
      version: updateArticleDto.version ? Number(updateArticleDto.version) : undefined
    };

    return this.articleService.update(id, updateData);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Obtenir un article par son ID' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  async findOneById(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: IQueryObject
  ): Promise<ResponseArticleDto> {
    query.filter = query.filter 
      ? `${query.filter},id||$eq||${id}` 
      : `id||$eq||${id}`;
    
    return this.articleService.findOneByCondition(query);
  }


  @Get('/stats/stock-value-evolution')
@ApiOperation({ summary: 'Obtenir l\'évolution de la valeur totale du stock' })
async getStockValueEvolution(
  @Query('days') days: number = 30 // Par défaut sur 30 jours
): Promise<{ dates: string[]; values: number[] }> {
  return this.articleService.getStockValueEvolution(days);
}


  @Get('/article-details/:id')
  @ApiOperation({ summary: 'Obtenir les détails complets d\'un article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  async getArticleDetails(
    @Param('id', ParseIntPipe) id: number
  ): Promise<ResponseArticleDto> {
    const article = await this.articleService.getArticleDetails(id);
    return this.mapToResponseDto(article);
  }


  @Post('/:id/restore-version/:version')
  @ApiOperation({ summary: 'Restaurer une version antérieure de l\'article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  @ApiParam({ name: 'version', description: 'Numéro de version à restaurer', type: Number })
  async restoreArticleVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number
  ): Promise<ResponseArticleDto> {
    const article = await this.articleService.restoreArticleVersion(id, version);
    return this.mapToResponseDto(article);
  }

  @Get('/:id/versions')
  @ApiOperation({ summary: 'Obtenir toutes les versions disponibles d\'un article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  async getAvailableVersions(
    @Param('id', ParseIntPipe) id: number
  ): Promise<{ versions: Array<{ version: number; date?: Date }> }> {
    const versions = await this.articleService.getAvailableVersions(id);
    return { versions };
  }

  
  @Get('/stats/top-out-of-stock-risk')
  @ApiOperation({ 
    summary: 'Obtenir les 5 articles avec le plus grand risque de rupture de stock',
    description: 'Retourne les 5 articles actifs avec les quantités les plus basses'
  })
  @ApiResponse({
    status: 200,
    description: 'Statistiques avec les articles à risque',
    type: ArticleStatsResponseDto
  })
  async getTopOutOfStockRisk(): Promise<ArticleStatsResponseDto> {
    return this.articleService.getTopOutOfStockRisk();
  }

  
 @Put(':id/update-stock')
  @ApiOperation({ summary: 'Mettre à jour le stock d\'un article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  @ApiBody({
    description: 'Changement de quantité (positif pour ajouter, négatif pour retirer)',
    schema: {
      type: 'object',
      properties: {
        quantityChange: { type: 'number', description: 'Changement de quantité' }
      }
    }
  })
  async updateArticleStock(
    @Param('id', ParseIntPipe) id: number,
    @Body('quantityChange', ParseIntPipe) quantityChange: number
  ): Promise<ResponseArticleDto> {
    const updatedArticle = await this.articleService.updateArticleStock(id, quantityChange);
    return this.mapToResponseDto(updatedArticle);
  }

  @Delete('/delete/:id')
@ApiOperation({ summary: 'Soft delete an article (mark as deleted)' })
@ApiParam({ name: 'id', description: 'Article ID to delete', type: Number })
@ApiResponse({ 
    status: 200, 
    description: 'Article successfully marked as deleted',
    type: ResponseArticleDto
})
async delete(
    @Param('id', ParseIntPipe) id: number
): Promise<{ success: boolean; deletedArticle: ResponseArticleDto; message: string }> {
    const deletedArticle = await this.articleService.delete(id);
    return {
      success: true,
      deletedArticle: this.mapToResponseDto(deletedArticle),
      message: 'Article marqué comme supprimé avec succès'
    };
}
 /* @Post('create-from-image')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/tmp',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
      }
    }),
    limits: { 
      fileSize: 5 * 1024 * 1024, // 5MB max
      files: 1 
    },
    fileFilter: (req, file, cb) => {
      const allowedMimeTypes = [
        'image/jpeg', 
        'image/png',
        'application/pdf'
      ];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new BadRequestException('Type de fichier non supporté'), false);
      }
      cb(null, true);
    }
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Créer un article à partir d\'une image' })
  @ApiResponse({ status: 201, type: ResponseArticleDto })
  @ApiResponse({ status: 400, description: 'Données invalides' })
  @ApiResponse({ status: 409, description: 'Article déjà existant' })
  @ApiResponse({ status: 500, description: 'Erreur serveur' })
  async createFromImage(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier valide n\'a été fourni');
    }
  
    // Vérification que le fichier existe physiquement
    if (!fs.existsSync(file.path)) {
      throw new InternalServerErrorException('Erreur lors du traitement du fichier');
    }
  
    try {
      // Extraction des données
      const { data, confidence } = await this.articleOcrService.extractArticleData(file.path);
      
      // Validation du score de confiance
      if (confidence < 75) {
        throw new BadRequestException(
          'La qualité de l\'image est trop faible pour une extraction fiable (score: ' + confidence + ')'
        );
      }
  
      // Validation des données obligatoires
      if (!data?.reference) {
        throw new BadRequestException('La référence est obligatoire et n\'a pas pu être extraite');
      }
  
      // Construction de l'objet ArticleData avec typage strict
      const articleData: ArticleData = {
        reference: String(data.reference),
        title: data.title ? String(data.title) : undefined,
        description: data.description ? String(data.description) : undefined,
        quantityInStock: Number(data.quantityInStock) || 0,
        unitPrice: Number(data.unitPrice) || 0,
        status: data.status ,
        notes: data.notes ? String(data.notes) : undefined
      };
  
      // Création de l'article
      const createdArticle = await this.articleService.createFromOcrData(articleData);
      return this.mapToResponseDto(createdArticle);
  
    } catch (error) {
      // Gestion centralisée des erreurs
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Une erreur est survenue lors du traitement');
    } finally {
      // Nettoyage garantie du fichier temporaire
      await this.cleanupFile(file.path);
    }
  }
  
  private async cleanupFile(path: string): Promise<void> {
    try {
      if (path && fs.existsSync(path)) {
        await fs.promises.unlink(path);
      }
    } catch (err) {
      console.error('Nettoyage fichier temporaire échoué:', err.message);
    }
  }*/

  ////////////////////////////////////////correction en haut 
/*
  // PDF Related Endpoints
  @Post('extract-from-pdf')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  async extractFromPdf(
    @UploadedFile() file: Express.Multer.File
  ): Promise<CreateArticleDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier PDF fourni');
    }

    try {
      const result = await this.pdfExtractionService.extractArticleDataFromPdf(file.path);
      return {
        title: result.title || '',
        description: result.description || '',
        reference: result.reference || '',
        quantityInStock: result.quantityInStock || 0,
        status: result.status || 'draft'
      };
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post('create-from-pdf')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Créer un article à partir des données extraites d\'un PDF' })
  async createFromPdf(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier PDF n\'a été envoyé');
    }

    try {
      const pdfData = await this.pdfExtractionService.extractArticleDataFromPdf(file.path);
      const createdArticle = await this.articleService.createFromPdfData(pdfData);
      return this.mapToResponseDto(createdArticle);
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post(':id/compare-with-pdf')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  async compareWithPdf(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier PDF fourni');
    }

    try {
      return await this.articleService.comparePdfWithArticle(id, file.path);
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  // OCR Related Endpoints
  @Post('create-from-image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async createFromImage(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé');
    }

    try {
      const text = await this.articleOcrService.extractTextFromImage(file.path);
      const articleData = await this.articleOcrService.extractArticleData(text);
      const createdArticle = await this.articleService.createFromOcrData(articleData);
      return this.mapToResponseDto(createdArticle);
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post('search-by-ocr')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async searchByOcrData(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto[]> {
    if (!file) {
      throw new BadRequestException('Aucun fichier image fourni');
    }

    try {
      const text = await this.articleOcrService.extractTextFromImage(file.path);
      const ocrData = await this.articleOcrService.extractArticleData(text);
      const articles = await this.articleService.searchByOcrData(ocrData);
      return articles.map(article => this.mapToResponseDto(article));
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post(':id/compare-with-image')
  @UseInterceptors(FileInterceptor('file'))
  async compareArticleWithImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ): Promise<ArticleCompareResponseDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier image fourni');
    }

    const existingArticle = await this.articleService.findOneById(id);
    const comparisonResult = await this.articleService.compareWithImage(existingArticle, file);
    
    return {
      ...comparisonResult,
      article: this.mapToResponseDto(existingArticle)
    };
  }

  // Text Similarity Endpoints
  @Get('/categories/suggest')
  async suggestCategories(
    @Query('query') query: string
  ): Promise<string[]> {
    if (!query || query.length < 2) {
      return [];
    }
    return this.articleService.findSimilarCategories(query);
  }

  @Get('/subcategories/suggest')
  async suggestSubCategories(
    @Query('query') query: string
  ): Promise<string[]> {
    if (!query || query.length < 2) {
      return [];
    }
    return this.articleService.findSimilarSubCategories(query);
  }

  @Post('/validate-category')
  async validateCategory(
    @Body() body: { category: string }
  ): Promise<{ valid: boolean; matches?: string[] }> {
    return this.articleService.validateCategoryUniqueness(body.category);
  }

  @Post('/validate-subcategory')
  async validateSubCategory(
    @Body() body: { subCategory: string }
  ): Promise<{ valid: boolean; matches?: string[] }> {
    return this.articleService.validateSubCategoryUniqueness(body.subCategory);
  }

  @Get('/categories/all')
  async getAllCategories(): Promise<string[]> {
    return await this.articleService.getAllCategories();
  }

  @Get('/subcategories/all')
  async getAllSubCategories(): Promise<string[]> {
    return await this.articleService.getAllSubCategories();
  }

  // Basic CRUD Endpoints


 
 */


/*


  

 

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé.');
    }

    if (!file.mimetype.includes('excel') && !file.mimetype.includes('spreadsheet')) {
      throw new BadRequestException('Seuls les fichiers Excel sont autorisés.');
    }

    return await this.articleService.importExcel(file);
  }

  @Get(':id/history')
  async getArticleHistory(@Param('id', ParseIntPipe) id: number): Promise<any[]> {
    return await this.articleService.getArticleHistory(id);
  }

  @Get(':id/sales-performance')
  async getSalesPerformance(@Param('id', ParseIntPipe) id: number) {
    return await this.articleService.getSalesPerformance(id);
  }

  

  private mapToResponseDto(article: ArticleEntity): ResponseArticleDto {
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      reference: article.reference,
      quantityInStock: article.quantityInStock,
      status: article.status,
      version: article.version,
      notes: article.notes,
      justificatifFile: article.justificatifFile
        ? {
            data: article.justificatifFile,
            filename: article.justificatifFileName,
            mimeType: article.justificatifMimeType,
            size: article.justificatifFileSize,
          }
        : undefined,
      unitPrice: article.unitPrice,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      deletedAt: article.deletedAt,
      history: article.history?.map(entry => ({
        version: entry.version,
        changes: entry.changes,
        date: entry.date,
      })) || [],
    };
  }
  */
}
