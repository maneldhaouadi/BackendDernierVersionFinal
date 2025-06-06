import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsNotEmpty, Matches } from 'class-validator';
import { ArticleStatus } from '../interfaces/article-data.interface';
export class UpdateArticleDto {
  
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reference?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  quantityInStock?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  status?: ArticleStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ required: false, type: Number })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  version?: number;

  
}