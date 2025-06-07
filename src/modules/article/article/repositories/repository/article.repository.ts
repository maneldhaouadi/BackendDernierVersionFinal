import { Injectable } from '@nestjs/common';
import { DatabaseAbstractRepository } from 'src/common/database/utils/database.repository';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { ArticleEntity } from '../entities/article.entity';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

@Injectable()
export class ArticleRepository extends DatabaseAbstractRepository<ArticleEntity> {
  constructor(
    @InjectRepository(ArticleEntity)
    private readonly articleRepository: Repository<ArticleEntity>,
    txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    super(articleRepository, txHost);
  }
  async find(options?: FindManyOptions<ArticleEntity>): Promise<ArticleEntity[]> {
    return this.articleRepository.find(options);
  }

  
}