import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { StorageService } from '../services/storage.service';
import { UploadEntity } from '../repositories/entities/upload.entity';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

@ApiTags('storage')
@Controller({
  version: '1',
  path: '/storage',
})
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get(':id')
  async getFileByIdOrSlug(@Param('id') id: number): Promise<UploadEntity> {
    return this.storageService.findOneById(id);
  }
  @Get('/all')
  async findAll(@Query() options: IQueryObject): Promise<UploadEntity[]> {
    return await this.storageService.findAll(options);
  }
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @Post('upload/multiple')
  @UseInterceptors(FilesInterceptor('files'))
  async uploadMultipleFiles(
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<UploadEntity[]> {
    return this.storageService.storeMultipleFiles(files);
  }

  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max file size
    },
  }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadEntity> {
    try {
      console.log('Received file upload request:', {
        filename: file?.originalname,
        size: file?.size,
        mimetype: file?.mimetype
      });

      if (!file) {
        console.error('No file received in request');
        throw new Error('No file received');
      }

      const result = await this.storageService.store(file);
      console.log('File stored successfully:', {
        id: result.id,
        filename: result.filename,
        slug: result.slug
      });

      return result;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  @Get('/file/slug/:slug')
  async downloadFileBySlug(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const upload = await this.storageService.findBySlug(slug);
    const fileStream = await this.storageService.loadResource(slug);
    res.setHeader('Content-Type', upload.mimetype);
    res.setHeader('Content-Length', upload.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${upload.filename}"`,
    );
    fileStream.pipe(res);
  }


  @Delete(':id')
  async deleteFile(@Param('id') id: number): Promise<UploadEntity> {
    try {
      return await this.storageService.delete(id);
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw new Error('Failed to delete file');
    }
  }



  @Get('file/id/:id')
  async downloadFileById(
    @Param('id') id: number,
    @Res() res: Response,
  ): Promise<void> {
    const upload = await this.storageService.findOneById(id);
    const fileStream = await this.storageService.loadResource(upload.slug);
    res.setHeader('Content-Type', upload.mimetype);
    res.setHeader('Content-Length', upload.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${upload.filename}"`,
    );
    fileStream.pipe(res);
  }
}
