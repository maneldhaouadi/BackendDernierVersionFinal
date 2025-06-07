import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity('article_history')
export class ArticleHistoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  version: number;

  @Column('json')
  changes: Record<string, { oldValue: any; newValue: any }>;

  @Column('json') // Nouveau champ pour le snapshot complet
  snapshot: Record<string, any>;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;
  
  @Column({ default: false })
  isActive: boolean;
  
  @ManyToOne(() => ArticleEntity, article => article.history, { 
    onDelete: 'CASCADE',
    nullable: false
  })
  article: ArticleEntity;

  @Column()
  articleId: number;
}