import { EntityManager, Repository } from 'typeorm';
import { DatabaseAbstractRepository } from 'src/common/database/utils/database.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ExpenseInvoiceUploadEntity } from '../entities/expense-invoice-file.entity';

@Injectable()
export class ExpenseInvoiceUploadRepository extends DatabaseAbstractRepository<ExpenseInvoiceUploadEntity> {
  constructor(
    @InjectRepository(ExpenseInvoiceUploadEntity)
    private readonly invoiceUploadRespository: Repository<ExpenseInvoiceUploadEntity>,
    private readonly manager:EntityManager,
    
    txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    super(invoiceUploadRespository, txHost);
  }

 async insertUnique(
  invoiceId: number,
  uploadId: number
): Promise<ExpenseInvoiceUploadEntity | undefined> {
  const exists = await this.findOne({
    where: {
      expenseInvoiceId: invoiceId,
      uploadId: uploadId
    }
  });

  if (exists) return undefined;

  return this.save({
    expenseInvoice: { id: invoiceId },
    uploadId: uploadId
  });
}

async restore(id: number): Promise<void> {
    await this.manager.restore(ExpenseInvoiceUploadEntity, id);
  }
}
