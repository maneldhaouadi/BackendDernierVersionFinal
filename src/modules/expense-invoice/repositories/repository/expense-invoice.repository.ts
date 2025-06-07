import { TransactionHost } from "@nestjs-cls/transactional";
import { TransactionalAdapterTypeOrm } from "@nestjs-cls/transactional-adapter-typeorm";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ExpenseInvoiceEntity } from "../entities/expense-invoice.entity";
import { Repository } from "typeorm";
import { DatabaseAbstractRepository } from "src/common/database/utils/database.repository";

@Injectable()
export class ExpenseInvoiceRepository extends DatabaseAbstractRepository<ExpenseInvoiceEntity> {
  constructor(
    @InjectRepository(ExpenseInvoiceEntity)
    private readonly invoiceRepository: Repository<ExpenseInvoiceEntity>,
    txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    super(invoiceRepository, txHost);
  }

  
}
