import { Repository } from 'typeorm';
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
    txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    super(invoiceUploadRespository, txHost);
  }
}
