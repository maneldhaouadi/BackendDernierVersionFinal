/* eslint-disable prettier/prettier */
import { ApiProperty } from '@nestjs/swagger';
import { UpdateExpensQuotationUploadDto } from './expensquotation-upload.update.dto';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateExpensQuotationDto } from './expensquotation.create.dto';
import { ResponseQuotationUploadDto } from 'src/modules/quotation/dtos/quotation-upload.response.dto';

export class UpdateExpensQuotationDto extends CreateExpensQuotationDto {
  @ApiProperty({ example: 1, type: Number })
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(25)
  sequentialNumbr?: string;
}
