import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class QuickUploadDestinationDto {
  @IsString() @MaxLength(128)
  id: string;
  @IsObject()
  settings: Record<string, any>;
}
export class QuickUploadIntentDto {
  @Equals(true)
  confirmNoIndividualReview: true;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((value: QuickUploadDestinationDto) => value.id)
  @ValidateNested({ each: true }) @Type(() => QuickUploadDestinationDto)
  destinations: QuickUploadDestinationDto[];
}
