import { Injectable } from '@nestjs/common';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindManyOptions, FindOneOptions } from 'typeorm';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { StorageService } from 'src/common/storage/services/storage.service';
import { ExpenseInvoiceUploadRepository } from '../repositories/repository/expense-invoice-upload.repository';
import { ExpenseInvoiceUploadEntity } from '../repositories/entities/expense-invoice-file.entity';
import { ExpenseInvoiceUploadNotFoundException } from '../errors/expense-invoice-upload.notfound';

@Injectable()
export class ExpenseInvoiceUploadService {
  constructor(
    private readonly invoiceUploadRepository: ExpenseInvoiceUploadRepository,
    private readonly storageService: StorageService,
  ) {}

  async findOneById(id: number): Promise<ExpenseInvoiceUploadEntity> {
    const upload = await this.invoiceUploadRepository.findOneById(id);
    if (!upload) {
      throw new ExpenseInvoiceUploadNotFoundException();
    }
    return upload;
  }

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpenseInvoiceUploadEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return this.invoiceUploadRepository.findOne(
      queryOptions as FindOneOptions<ExpenseInvoiceUploadEntity>,
    );
  }

  async findAll(query: IQueryObject): Promise<ExpenseInvoiceUploadEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return this.invoiceUploadRepository.findAll(
      queryOptions as FindManyOptions<ExpenseInvoiceUploadEntity>,
    );
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ExpenseInvoiceUploadEntity>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);

    const count = await this.invoiceUploadRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.invoiceUploadRepository.findAll(
      queryOptions as FindManyOptions<ExpenseInvoiceUploadEntity>,
    );

    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page, 10) || 1,
        take: parseInt(query.limit, 10) || 10,
      },
      itemCount: count,
    });

    return new PageDto(entities, pageMetaDto);
  }

  async save(
    invoiceId: number,
    uploadId: number,
  ): Promise<ExpenseInvoiceUploadEntity> {
    // Vérifier si le fichier est déjà associé à la facture
    const existingUpload = await this.invoiceUploadRepository.findOne({
      where: {
        expenseInvoice: { id: invoiceId }, // Vérifier la relation avec la facture
        uploadId,                          // Vérifier l'ID du fichier uploadé
      },
    });
  
    if (existingUpload) {
      console.log('Le fichier est déjà associé à la facture:', existingUpload);
      return existingUpload; // Retourner l'entrée existante
    }
  
    // Créer une nouvelle entrée
    const newUpload = this.invoiceUploadRepository.create({
      expenseInvoice: { id: invoiceId }, // Associer l'ID de la facture
      uploadId,                          // Associer l'ID du fichier uploadé
    });
  
    console.log('Ajout d\'un nouveau fichier avec l\'uploadId:', uploadId, 'et invoiceId:', invoiceId);
    return this.invoiceUploadRepository.save(newUpload);
  }
  

  async duplicate(id: number, invoiceId: number): Promise<ExpenseInvoiceUploadEntity> {
    const originalInvoiceUpload = await this.findOneById(id);
    const duplicatedUpload = await this.storageService.duplicate(
      originalInvoiceUpload.uploadId,
    );
  
    const duplicatedInvoiceUploadEntity = await this.invoiceUploadRepository.save({
      expenseInvoice: { id: invoiceId },
      uploadId: duplicatedUpload.id,
    });
  
    return duplicatedInvoiceUploadEntity;
  }
  

  async duplicateMany(
    ids: number[],
    invoiceId: number,
  ): Promise<ExpenseInvoiceUploadEntity[]> {
    return Promise.all(ids.map((id) => this.duplicate(id, invoiceId)));
  }

  async softDelete(id: number): Promise<ExpenseInvoiceUploadEntity> {
    const upload = await this.findOneById(id);
    await this.storageService.delete(upload.uploadId);
    await this.invoiceUploadRepository.softDelete(upload.id);
    return upload;
  }

  async softDeleteMany(
    invoiceUploadEntities: ExpenseInvoiceUploadEntity[],
  ): Promise<ExpenseInvoiceUploadEntity[]> {
    await this.storageService.deleteMany(
      invoiceUploadEntities.map((qu) => qu.upload.id), // corrected: use qu.upload.id
    );
    return this.invoiceUploadRepository.softDeleteMany(
      invoiceUploadEntities.map((qu) => qu.id),
    );
  }

  async deleteAll(): Promise<void> {
    await this.invoiceUploadRepository.deleteAll();
  }

  async getTotal(): Promise<number> {
    return this.invoiceUploadRepository.getTotalCount();
  }
  async findByInvoiceId(invoiceId: number): Promise<ExpenseInvoiceUploadEntity[]> {
    return this.invoiceUploadRepository.findAll({
      where: { expenseInvoice: { id: invoiceId } },
    });
  }
}

