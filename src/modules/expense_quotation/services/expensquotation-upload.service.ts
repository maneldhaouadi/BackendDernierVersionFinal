/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { ExpensQuotationUploadEntity } from '../repositories/entities/expensquotation-file.entity';
import { QuotationUploadNotFoundException } from '../errors/quotation-upload.notfound';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindManyOptions, FindOneOptions, In } from 'typeorm';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { StorageService } from 'src/common/storage/services/storage.service';
import { ExpensQuotationUploadRepository } from '../repositories/repository/expensquotation-upload.repository';

@Injectable()
export class ExpensQuotationUploadService {
  constructor(
    private readonly quotationUploadRepository: ExpensQuotationUploadRepository,
    private readonly storageService: StorageService,
  ) {}

  
  async findOneById(id: number): Promise<ExpensQuotationUploadEntity> {
    const upload = await this.quotationUploadRepository.findOne({ 
      where: { id },
      relations: ['upload']
    });
  
    if (!upload) {
      console.warn(`Quotation upload with ID ${id} not found - skipping`);
      return null; // Retourne null au lieu de throw une exception
    }
  
    return upload;
  }


  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpensQuotationUploadEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const upload = await this.quotationUploadRepository.findOne(
      queryOptions as FindOneOptions<ExpensQuotationUploadEntity>,
    );
    if (!upload) return null;
    return upload;
  }


  
  async findAll(query: IQueryObject): Promise<ExpensQuotationUploadEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return await this.quotationUploadRepository.findAll(
      queryOptions as FindManyOptions<ExpensQuotationUploadEntity>,
    );
  }

  async saveMany(expensequotationId: number, uploadIds: number[]): Promise<void> {
    await Promise.all(
      uploadIds.map(uploadId => 
        this.quotationUploadRepository.save({ expensequotationId, uploadId })
      )
    );
  }

  async findByUploadIds(uploadIds: number[]): Promise<ExpensQuotationUploadEntity[]> {
    return this.quotationUploadRepository.findAll({
      where: { uploadId: In(uploadIds) }
    });
  }


  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ExpensQuotationUploadEntity>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.quotationUploadRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.quotationUploadRepository.findAll(
      queryOptions as FindManyOptions<ExpensQuotationUploadEntity>,
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


  async save(
    expensequotationId: number,
    uploadId: number,
  ): Promise<ExpensQuotationUploadEntity> {
    return this.quotationUploadRepository.save({ expensequotationId, uploadId });
  }



  async duplicate(id: number, quotationId: number): Promise<ExpensQuotationUploadEntity> {
    const originalQuotationUpload = await this.findOneById(id);
    
    // Si l'upload n'existe pas, retourne null
    if (!originalQuotationUpload) {
      return null;
    }
  
    try {
      // Vérifie que l'upload existe dans le storage
      const uploadExists = await this.storageService.findOneById(originalQuotationUpload.uploadId);
      if (!uploadExists) {
        console.warn(`Upload file with ID ${originalQuotationUpload.uploadId} not found`);
        return null;
      }
  
      // Duplique le fichier
      const duplicatedUpload = await this.storageService.duplicate(originalQuotationUpload.uploadId);
  
      // Crée la nouvelle entrée
      return this.quotationUploadRepository.save({
        expensequotationId: quotationId,
        uploadId: duplicatedUpload.id,
      });
    } catch (error) {
      console.error(`Error duplicating upload ${id}:`, error);
      return null;
    }
  }
  
  async duplicateMany(uploadIds: number[], quotationId: number): Promise<ExpensQuotationUploadEntity[]> {
    const results = [];
    
    for (const id of uploadIds) {
      const duplicated = await this.duplicate(id, quotationId);
      if (duplicated) {
        results.push(duplicated);
      }
    }
  
    return results;
  }


  async create(createDto: {
    expensequotationId: number;
    uploadId: number;
  }): Promise<ExpensQuotationUploadEntity> {
    // Validation des données requises
    if (!createDto.expensequotationId || !createDto.uploadId) {
      console.error('Missing required fields:', createDto);
      throw new Error('expensequotationId and uploadId are required');
    }

    console.log('Creating upload association:', {
      expensequotationId: createDto.expensequotationId,
      uploadId: createDto.uploadId
    });

    const newUpload = this.quotationUploadRepository.create({
      expensequotationId: createDto.expensequotationId,
      uploadId: createDto.uploadId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    const savedUpload = await this.quotationUploadRepository.save(newUpload);
    
    // Vérification que l'enregistrement a bien été créé
    if (!savedUpload.id) {
      console.error('Failed to create upload record:', savedUpload);
      throw new Error('Failed to create upload record');
    }

    console.log('Upload association created successfully:', {
      id: savedUpload.id,
      expensequotationId: savedUpload.expensequotationId,
      uploadId: savedUpload.uploadId
    });
    
    return savedUpload;
  }

  async softDelete(id: number): Promise<ExpensQuotationUploadEntity> {
    const upload = await this.findOneById(id);
    this.storageService.delete(upload.uploadId);
    this.quotationUploadRepository.softDelete(upload.id);
    return upload;
  }

  

  async softDeleteMany(
    quotationUploadEntities: ExpensQuotationUploadEntity[],
  ): Promise<ExpensQuotationUploadEntity[]> {
    this.storageService.deleteMany(
      quotationUploadEntities.map((qu) => qu.upload.id),
    );
    return this.quotationUploadRepository.softDeleteMany(
      quotationUploadEntities.map((qu) => qu.id),
    );
  }

  async deleteAll() {
    return this.quotationUploadRepository.deleteAll();
  }

  async getTotal(): Promise<number> {
    return this.quotationUploadRepository.getTotalCount();
  }
}

