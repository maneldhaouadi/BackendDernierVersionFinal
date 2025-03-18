import { ApiProperty } from '@nestjs/swagger';

export class CreateArticleHistoryDto {
  @ApiProperty({ example: 1, description: 'Version de l\'article' })
  version: number;

  @ApiProperty({
    example: { title: { oldValue: 'Ancien titre', newValue: 'Nouveau titre' } },
    description: 'Modifications apportées à l\'article',
  })
  changes: Record<string, { oldValue: any; newValue: any }>;

  @ApiProperty({ example: 1, description: 'ID de l\'article associé' })
  articleId: number;
}