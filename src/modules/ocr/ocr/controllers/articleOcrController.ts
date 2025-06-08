import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
  Get,
  Query,
  Delete,
  Param,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { OcrProcessResponse } from '../dtos/ocr-result.dto';
import { ArticleOcrService } from '../services/articleOcrService';

@ApiTags('OCR Processing')
@Controller('ocr')
export class ArticleOcrController {
  private readonly logger = new Logger(ArticleOcrController.name);
  private readonly uploadDir = './uploads/ocr';
  
  constructor(private readonly ocrService: ArticleOcrService) {
    // Créer le dossier d'upload s'il n'existe pas
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  @Post('process')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/ocr',
        filename: (req, file, cb) => {
          const randomName = crypto.randomBytes(16).toString('hex');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/png',
          'image/jpeg',
          'image/tiff',
          'image/bmp',
          'application/pdf',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new HttpException(
              `Unsupported file type ${file.mimetype}`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File to process (image or PDF)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiQuery({
    name: 'strict',
    type: Boolean,
    required: false,
    description: 'Enable strict mode (rejects results with confidence < 85%)',
  })
  @ApiQuery({
    name: 'debug',
    type: Boolean,
    required: false,
    description: 'Enable debug mode (returns additional processing info)',
  })
  @ApiOperation({
    summary: 'Process document with OCR',
    description: 'Extracts structured data from document using OCR and AI processing',
  })
  @ApiResponse({
    status: 200,
    description: 'Document processed successfully',
    type: OcrProcessResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file or missing required fields',
  })
  @ApiResponse({
    status: 422,
    description: 'Low confidence score in strict mode',
  })
  @ApiResponse({
    status: 500,
    description: 'OCR processing error',
  })
  async processDocument(
    @UploadedFile() file: Express.Multer.File,
    @Query('strict') strictMode: boolean = false,
    @Query('debug') debugMode: boolean = false,
  ): Promise<OcrProcessResponse> {
    try {
      if (!file) {
        throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
      }

      const filePath = join(this.uploadDir, file.filename);
      if (!existsSync(filePath)) {
        throw new HttpException('File not found', HttpStatus.BAD_REQUEST);
      }

      this.logger.debug(`Processing file: ${filePath}`);
      const result = await this.ocrService.processDocument(filePath, debugMode);

      if (strictMode && result.confidence < 85) {
        throw new HttpException(
          'Low confidence score in strict mode',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // Nettoyage du fichier après traitement
      await this.cleanupFile(file.filename);

      return result;
    } catch (error) {
      this.logger.error(`OCR processing failed: ${error.message}`, error.stack);
      
      // Nettoyage en cas d'erreur
      if (file?.filename) {
        await this.cleanupFile(file.filename).catch(err => 
          this.logger.error(`Failed to cleanup file: ${err.message}`)
        );
      }

      throw new HttpException(
        {
          success: false,
          message: error.message,
          statusCode: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('supported-formats')
  @ApiOperation({
    summary: 'Get supported file formats',
    description: 'Returns list of supported formats for OCR processing',
  })
  @ApiResponse({
    status: 200,
    description: 'Supported formats list',
    schema: {
      type: 'object',
      properties: {
        formats: {
          type: 'array',
          items: { type: 'string' },
          example: ['png', 'jpg', 'jpeg', 'tiff', 'bmp', 'pdf'],
        },
        maxSize: { 
          type: 'string',
          example: '10MB',
        },
      },
    },
  })
  getSupportedFormats() {
    return {
      formats: ['png', 'jpg', 'jpeg', 'tiff', 'bmp', 'pdf'],
      maxSize: '10MB',
    };
  }

  @Delete('cleanup/:filename')
  @ApiOperation({
    summary: 'Cleanup uploaded file',
    description: 'Manually cleanup an uploaded file',
  })
  @ApiParam({
    name: 'filename',
    description: 'Name of the file to delete',
    example: 'abc123.jpg',
  })
  @ApiResponse({
    status: 200,
    description: 'File successfully deleted',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'File deleted successfully' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'File not found',
  })
  async cleanupFile(@Param('filename') filename: string) {
    const filePath = join(this.uploadDir, filename);
    
    try {
      await this.ocrService.cleanupFile(filePath);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete file ${filename}: ${error.message}`);
      throw new HttpException(
        'Failed to delete file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}