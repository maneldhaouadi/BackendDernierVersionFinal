import {
  BaseEntity,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  DATABASE_CREATED_AT_FIELD_NAME,
  DATABASE_DELETED_AT_FIELD_NAME,
  DATABASE_RESTRICT_DELETE_FIELD_NAME,
  DATABASE_UPDATED_AT_FIELD_NAME,
} from 'src/common/database/constants/database.constant';
import { Expose } from 'class-transformer';

export class EntityHelper extends BaseEntity {
  @CreateDateColumn()
  @Expose({ name: DATABASE_CREATED_AT_FIELD_NAME })
  [DATABASE_CREATED_AT_FIELD_NAME]?: Date;

  @UpdateDateColumn()
  @Expose({ name: DATABASE_UPDATED_AT_FIELD_NAME })
  [DATABASE_UPDATED_AT_FIELD_NAME]?: Date;

  @DeleteDateColumn()
  @Expose({ name: DATABASE_DELETED_AT_FIELD_NAME })
  [DATABASE_DELETED_AT_FIELD_NAME]?: Date;

  @Column({ type: 'boolean', default: false })
  @Expose({ name: DATABASE_RESTRICT_DELETE_FIELD_NAME })
  [DATABASE_RESTRICT_DELETE_FIELD_NAME]: boolean;
}
