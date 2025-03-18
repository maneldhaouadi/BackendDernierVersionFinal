import { faker } from '@faker-js/faker';
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsDate, IsOptional, IsBoolean } from 'class-validator';

export class ResponseArticleDto {
  @ApiProperty({ example: 1, type: Number })
  @IsNumber()
  id: number;

  @ApiProperty({ example: faker.commerce.product(), type: String })
  @IsString()
  title: string;

  @ApiProperty({ example: faker.commerce.productDescription(), type: String })
  @IsString()
  description: string;

  @ApiProperty({ example: 'Électronique', type: String })
  @IsString()
  category: string;

  @ApiProperty({ example: 'Téléphones', type: String })
  @IsString()
  subCategory: string;

  @ApiProperty({ example: 400.0, type: Number })
  @IsNumber()
  purchasePrice: number;

  @ApiProperty({ example: 600.0, type: Number })
  @IsNumber()
  salePrice: number;

  @ApiProperty({ example: 50, type: Number })
  @IsNumber()
  quantityInStock: number;

  @ApiProperty({ example: 'draft', type: String })
  @IsString()
  status: string;

  @ApiProperty({ example: 1, type: Number })
  @IsNumber()
  version: number;

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  createdAt?: Date;

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  updatedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  deletedAt?: Date;

  @ApiProperty({ type: Boolean, required: false })
  @IsBoolean()
  @IsOptional()
  isDeletionRestricted?: boolean;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  history: Array<{
    version: number;
    changes: Record<string, { oldValue: any; newValue: any }>;
    date: Date;
  }>;
}