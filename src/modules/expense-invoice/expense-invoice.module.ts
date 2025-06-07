import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { FirmModule } from '../firm/firm.module';
import { InterlocutorModule } from '../interlocutor/Interlocutor.module';
import { TaxModule } from '../tax/tax.module';
import { PdfModule } from 'src/common/pdf/pdf.module';
import { CalculationsModule } from 'src/common/calculations/calculations.module';
import { AppConfigModule } from 'src/common/app-config/app-config.module';
import { GatewaysModule } from 'src/common/gateways/gateways.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { TaxWithholdingModule } from '../tax-withholding/tax-withholding.module';
import { ExpenseInvoiceService } from './services/expense-invoice.service';
import { ExpenseInvoiceMetaDataService } from './services/expense-invoice-meta-data.service';
import { ExpenseInvoiceUploadService } from './services/expense-invoice-upload.service';
import { ExpenseArticleInvoiceEntryService } from './services/expense-article-invoice-entry.service';
import { ExpenseArticleInvoiceEntryTaxService } from './services/expense-article-invoice-entry-tax.service';
import { ExpenseInvoiceRepositoryModule } from './repositories/expense-invoice.repository.module';
import { ExpensQuotationService } from '../expense_quotation/services/expensquotation.service';
import { ExpenseQuotationModule } from '../expense_quotation/expensquotation.module';
import { ExpensePaymentInvoiceEntryEntity } from '../expense-payment/repositories/entities/expense-payment-invoice-entry.entity';
import { ExpensePaymentModule } from '../expense-payment/expense-payment.module';
import { ExpensePaymentInvoiceEntryService } from '../expense-payment/services/expense-payment-invoice-entry.service';
import { TemplateModule } from '../template/template.module';
import { ArticleModule } from '../article/article/article.module';
import { ArticleRepositoryModule } from '../article/article/repositories/article.repository.module';

@Module({
  controllers: [],
  providers: [
    ExpenseInvoiceService,
    ExpenseInvoiceMetaDataService,
    ExpenseInvoiceUploadService,
    ExpenseArticleInvoiceEntryService,
    ExpenseArticleInvoiceEntryTaxService,
  ],
  exports: [ExpenseInvoiceService],
  imports: [
    //repositories
    ExpenseInvoiceRepositoryModule,
    ArticleRepositoryModule,
    
    //entities
    ArticleModule,
    AppConfigModule,
    BankAccountModule,
    CurrencyModule,
    FirmModule,
    InterlocutorModule,
    TaxModule,
    TaxWithholdingModule,
    //abstract modules
    PdfModule,
    GatewaysModule,
    CalculationsModule,
    StorageModule,
    ExpenseQuotationModule,
    TemplateModule
  ],
})
export class ExpenseInvoiceModule {}
