/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ExpensQuotationService } from './services/expensquotation.service';
import { ArticleExpensQuotationEntryService } from './services/article-expensquotation-entry.service';
import { ArticleExpensQuotationEntryTaxService } from './services/article-expensquotation-entry-tax.service';
import { PdfModule } from 'src/common/pdf/pdf.module';
import { CalculationsModule } from 'src/common/calculations/calculations.module';
import { AppConfigModule } from 'src/common/app-config/app-config.module';
import { GatewaysModule } from 'src/common/gateways/gateways.module';
import { ExpensQuotationMetaDataService } from './services/expensquotation-meta-data.service';
import { StorageModule } from 'src/common/storage/storage.module';
import { ExpensQuotationUploadService } from './services/expensquotation-upload.service';
import { BankAccountModule } from 'src/modules/bank-account/bank-account.module';
import { CurrencyModule } from 'src/modules/currency/currency.module';
import { FirmModule } from 'src/modules/firm/firm.module';
import { InterlocutorModule } from 'src/modules/interlocutor/Interlocutor.module';
import { InvoiceModule } from 'src/modules/invoice/invoice.module';
import { TaxModule } from 'src/modules/tax/tax.module';
import { ExpensQuotationController } from './controllers/expensquotation.controller';
import { QuotationRepositoryModule } from './repositories/expensquotation.repository.module';
import { TemplateModule } from '../template/template.module';
import { ArticleModule } from '../article/article/article.module';
import { ArticleService } from '../article/article/services/article.service';
import { ArticleRepositoryModule } from '../article/article/repositories/article.repository.module';

@Module({
  controllers: [ExpensQuotationController], // Ajout du contrôleur ici
  providers: [
    ExpensQuotationService,
    ExpensQuotationMetaDataService,
    ExpensQuotationUploadService,
    ArticleExpensQuotationEntryService,
    ArticleExpensQuotationEntryTaxService,
  ],
  exports: [ExpensQuotationService],
  imports: [
    //repositories
    QuotationRepositoryModule,
    ArticleRepositoryModule,
    //entities
    ArticleModule,
    AppConfigModule,
    BankAccountModule,
    CurrencyModule,
    FirmModule,
    InterlocutorModule,
    InvoiceModule,
    TaxModule,
    //abstract modules
    PdfModule,
    GatewaysModule,
    CalculationsModule,
    StorageModule,
    TemplateModule,
  ],
})
export class ExpenseQuotationModule {}
