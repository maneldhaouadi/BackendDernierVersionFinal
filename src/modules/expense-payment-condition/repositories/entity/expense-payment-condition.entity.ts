import { EntityHelper } from 'src/common/database/interfaces/database.entity.interface';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('payment_condition')
export class ExpensePaymentConditionEntity extends EntityHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  description: string;
}
