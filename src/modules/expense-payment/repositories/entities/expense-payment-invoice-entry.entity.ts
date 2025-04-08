import { EntityHelper } from 'src/common/database/interfaces/database.entity.interface';
import { ExpenseInvoiceEntity } from 'src/modules/expense-invoice/repositories/entities/expense-invoice.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ExpensePaymentEntity } from './expense-payment.entity';

@Entity('expense_payment_invoice_entry')
export class ExpensePaymentInvoiceEntryEntity extends EntityHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ExpensePaymentEntity)
  @JoinColumn({ name: 'paymentId' })
  payment: ExpensePaymentEntity;

  @Column({ name: 'paymentId', type: 'int' }) // Utilisez le nom de colonne existant
  paymentId: number;

  @ManyToOne(() => ExpenseInvoiceEntity)
  @JoinColumn({ name: 'expenseInvoiceId' })
  expenseInvoice: ExpenseInvoiceEntity;

  @Column({ type: 'int' })
  expenseInvoiceId: number;

  @Column({ type: 'float', nullable: true })
  amount: number;
  @Column({ type: 'float', nullable: true, default: 1.0 })
  exchangeRate: number;

  @Column({ type: 'float', nullable: true })
  originalAmount: number;

  @Column({ type: 'int', nullable: true })
  originalCurrencyId: number;

  @Column({ type: 'int', nullable: true })
  digitAfterComma: number;
}