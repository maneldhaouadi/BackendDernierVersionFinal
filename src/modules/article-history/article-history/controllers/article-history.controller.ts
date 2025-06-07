import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  NotFoundException,
  Res,
  Delete,
  ParseIntPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { ArticleHistoryService } from '../services/article-history.service';
import { ApiTags, ApiParam, ApiBody, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { CreateArticleHistoryDto } from '../dtos/createArticleHistoryDto';
import { ResponseArticleHistoryDto } from '../dtos/responseArticleHistoryDto';
import { ArticleService } from 'src/modules/article/article/services/article.service';

@ApiTags('Article History')
@Controller('article-history')
export class ArticleHistoryController {
  constructor(
    private readonly articleHistoryService: ArticleHistoryService,
    private readonly articleService: ArticleService,
  ) {}

  @Post('create')
  @ApiBody({ type: CreateArticleHistoryDto })
  @ApiResponse({ status: 201, type: ResponseArticleHistoryDto })
  async createHistoryEntry(
    @Body() createArticleHistoryDto: CreateArticleHistoryDto,
  ): Promise<ResponseArticleHistoryDto> {
    return this.articleHistoryService.createHistoryEntry({
      ...createArticleHistoryDto,
      snapshot: createArticleHistoryDto.snapshot || {}
    });
  }

  @Get(':articleId/history')
  @ApiParam({ name: 'articleId', type: 'number' })
  @ApiResponse({ status: 200, type: [ResponseArticleHistoryDto] })
  async getArticleHistory(
    @Param('articleId') articleId: number,
  ): Promise<ResponseArticleHistoryDto[]> {
    const history = await this.articleHistoryService.getArticleHistory(articleId);

    if (!history || history.length === 0) {
      throw new NotFoundException('Aucun historique trouvé pour cet article.');
    }

    return history;
  }

 @Get(':articleId/version/:version/download-pdf')
@ApiParam({ name: 'articleId', type: 'number' })
@ApiParam({ name: 'version', type: 'number' })
async downloadVersionPdf(
  @Param('articleId') articleId: number,
  @Param('version') version: number,
  @Res() res: Response
) {
  try {
    const pdfBuffer = await this.articleHistoryService.generateSingleVersionPdf(articleId, version);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=article_${articleId}_v${version}.pdf`,
    );

    res.send(pdfBuffer);
  } catch (error) {
    console.error('Erreur PDF:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Échec de la génération du PDF',
      error: error.message
    });
  }
}

  @Delete(':articleId/version/:version')
  @ApiOperation({ summary: 'Supprimer une version spécifique et ajuster les versions suivantes' })
  @ApiParam({ name: 'articleId', description: 'ID de l\'article', type: Number })
  @ApiParam({ name: 'version', description: 'Numéro de version à supprimer', type: Number })
  async deleteVersion(
    @Param('articleId', ParseIntPipe) articleId: number,
    @Param('version', ParseIntPipe) version: number
  ): Promise<void> {
    return this.articleHistoryService.deleteVersion(articleId, version);
  }

  @Post(':articleId/restore/:version')
  @ApiOperation({ summary: 'Restaurer une version spécifique' })
  @ApiParam({ name: 'articleId', description: 'ID de l\'article', type: Number })
  @ApiParam({ name: 'version', description: 'Numéro de version à restaurer', type: Number })
  @ApiResponse({ status: 200, description: 'Version restaurée avec succès' })
  async restoreVersion(
    @Param('articleId', ParseIntPipe) articleId: number,
    @Param('version', ParseIntPipe) version: number
  ): Promise<{ message: string }> {
    await this.articleHistoryService.restoreVersion(articleId, version);
    return { message: `Version ${version} restaurée avec succès` };
  }

  @Get(':articleId/active-version')
  @ApiOperation({ summary: 'Obtenir la version active' })
  @ApiParam({ name: 'articleId', description: 'ID de l\'article', type: Number })
  @ApiResponse({ status: 200, type: ResponseArticleHistoryDto })
  async getActiveVersion(
    @Param('articleId', ParseIntPipe) articleId: number
  ): Promise<ResponseArticleHistoryDto> {
    const activeVersion = await this.articleHistoryService.getActiveVersion(articleId);
    if (!activeVersion) {
      throw new NotFoundException('Aucune version active trouvée');
    }
    return activeVersion;
  }

  @Get(':articleId/generate-all-pdfs')
  @ApiOperation({ summary: 'Générer tous les PDFs des versions' })
  @ApiParam({ name: 'articleId', description: 'ID de l\'article', type: Number })
  @ApiResponse({ status: 200, description: 'Chemins des fichiers PDF générés' })
  async generateAllPdfs(
    @Param('articleId', ParseIntPipe) articleId: number
  ): Promise<{ files: string[] }> {
    const files = await this.articleHistoryService.generateAllVersionPdfs(articleId);
    return { files };
  }
}