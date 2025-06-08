import { Injectable } from '@nestjs/common';
import { UploadRepository } from '../repositories/repository/upload.repository';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { UploadEntity } from '../repositories/entities/upload.entity';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindManyOptions } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as mime from 'mime-types';
import { join } from 'path';
import { createReadStream, promises as fs } from 'fs';
import { constants } from 'fs';
import { StorageBadRequestException } from '../errors/storage.bad-request.error';
import { UploadNotFoundException } from '../errors/upload.not-found.error';
import { FileNotFoundException } from '../errors/file.not-found.error';
import { ReadStream } from 'typeorm/platform/PlatformTools';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService {
  constructor(
    private readonly uploadRepository: UploadRepository,
    private configService: ConfigService,
  ) {}

  rootLocation = this.configService.get('app.uploadPath', { infer: '/upload' });

  async findBySlug(slug: string): Promise<UploadEntity> {
    const upload = await this.uploadRepository.findOne({ where: { slug } });
    if (!upload) {
      throw new UploadNotFoundException();
    }
    return upload;
  }
  async findOneById(id: number): Promise<UploadEntity> {
    const upload = await this.uploadRepository.findOneById(id);
    if (!upload) {
      throw new UploadNotFoundException();
    }
    return upload;
  }

  async findAll(query: IQueryObject): Promise<UploadEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return await this.uploadRepository.findAll(
      queryOptions as FindManyOptions<UploadEntity>,
    );
  }

  async store(file: Express.Multer.File): Promise<UploadEntity> {
    try {
      console.log('Starting file storage process:', {
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      });

      if (!file || !file.buffer || file.buffer.length === 0) {
        console.error('Invalid file received:', file);
        throw new StorageBadRequestException('Invalid or empty file received');
      }

      const slug = uuidv4();
      const filename = file.originalname;
      const mimetype = file.mimetype;
      const size = file.size;

      const extension = mime.extension(mimetype) || '';
      let relativePath = slug;

      if (extension) {
        relativePath = `${slug}.${extension}`;
      }

      console.log('Creating upload record:', {
        slug,
        filename,
        mimetype,
        size,
        relativePath
      });

      const upload = await this.uploadRepository.save({
        slug,
        filename,
        mimetype,
        size,
        relativePath,
      });

      const destinationFile = join(this.rootLocation, relativePath);
      
      console.log('Writing file to disk:', {
        destination: destinationFile,
        bufferSize: file.buffer.length
      });

      await fs.mkdir(this.rootLocation, { recursive: true });
      await fs.writeFile(destinationFile, file.buffer);

      console.log('File stored successfully:', {
        id: upload.id,
        slug: upload.slug,
        path: destinationFile
      });

      return upload;
    } catch (error) {
      console.error('Error storing file:', {
        error: error.message,
        stack: error.stack
      });
      throw new StorageBadRequestException(
        'Failed to store file: ' + error.message
      );
    }
  }

  async storeMultipleFiles(files: Express.Multer.File[]) {
    const uploads = await Promise.all(
      files.map(async (file) => {
        return this.store(file);
      }),
    );
    return uploads;
  }

  async loadResource(slug: string): Promise<ReadStream> {
    const upload = await this.findBySlug(slug);
    const filePath = join(this.rootLocation, upload.relativePath);

    try {
      await fs.access(filePath, constants.F_OK);
      return createReadStream(filePath);
    } catch (error) {
      throw new FileNotFoundException();
    }
  }

  async duplicate(id: number): Promise<UploadEntity> {
    //Find the original upload entity
    const originalUpload = await this.findOneById(id);

    //Generate a new slug and file path for the duplicate
    const newSlug = uuidv4();
    const originalFilePath = join(
      this.rootLocation,
      originalUpload.relativePath,
    );
    const fileExtension = mime.extension(originalUpload.mimetype) || '';
    let newRelativePath = newSlug;

    if (fileExtension) {
      newRelativePath = `${newSlug}.${fileExtension}`;
    }

    const newFilePath = join(this.rootLocation, newRelativePath);

    //Copy the file on the filesystem
    try {
      await fs.copyFile(originalFilePath, newFilePath);
    } catch (error) {
      throw new StorageBadRequestException(
        `Failed to duplicate file: ${error.message}`,
      );
    }

    //Save the duplicated upload entity in the database
    const duplicatedUpload = await this.uploadRepository.save({
      slug: newSlug,
      filename: originalUpload.filename,
      mimetype: originalUpload.mimetype,
      size: originalUpload.size,
      relativePath: newRelativePath,
    });

    return duplicatedUpload;
  }

  async duplicateMany(ids: number[]): Promise<UploadEntity[]> {
    const duplicatedUploads = await Promise.all(
      ids.map((id) => this.duplicate(id)),
    );
    return duplicatedUploads;
  }

  async delete(id: number): Promise<UploadEntity> {
    const upload = await this.findOneById(id);
    const filePath = join(this.rootLocation, upload.relativePath);

    try {
      await fs.unlink(filePath);
      await this.uploadRepository.softDelete(upload.id);
      return upload;
    } catch (error) {
      throw new StorageBadRequestException(
        `Failed to delete file: ${upload.slug}` + error.message,
      );
    }
  }

  async deleteMany(ids: number[]): Promise<void> {
    for (const id in ids) {
      await this.delete(ids[id]);
    }
  }

  async getTotal(): Promise<number> {
    return this.uploadRepository.getTotalCount();
  }
  // Dans storage.service.ts
async getFile(slug: string): Promise<Buffer> {
  const upload = await this.findBySlug(slug);
  const filePath = join(this.rootLocation, upload.relativePath);

  try {
    await fs.access(filePath, constants.F_OK);
    return await fs.readFile(filePath);
  } catch (error) {
    throw new FileNotFoundException();
  }
}
}
