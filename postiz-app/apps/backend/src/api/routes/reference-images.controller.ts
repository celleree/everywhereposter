import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import {
  ReferenceImageAspectRatio,
  ReferenceImageService,
} from '@gitroom/nestjs-libraries/database/prisma/reference-images/reference-image.service';

const REFERENCE_ASPECT_RATIOS: ReferenceImageAspectRatio[] = [
  '1:1',
  '4:5',
  '16:9',
  '9:16',
];

class CreateReferenceImageDto {
  @IsString()
  mediaId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @IsIn(REFERENCE_ASPECT_RATIOS)
  aspectRatio?: ReferenceImageAspectRatio;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  styleNotes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

class UpdateReferenceImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @IsIn(REFERENCE_ASPECT_RATIOS)
  aspectRatio?: ReferenceImageAspectRatio;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  styleNotes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

@ApiTags('Reference Images')
@Controller('/reference-images')
export class ReferenceImagesController {
  constructor(private readonly _service: ReferenceImageService) {}

  @Get('/')
  list(
    @GetOrgFromRequest() org: Organization,
    @Query('includeArchived') includeArchived?: string
  ) {
    return this._service.list(org.id, includeArchived === 'true');
  }

  @Post('/')
  create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateReferenceImageDto
  ) {
    return this._service.create(org.id, body);
  }

  @Patch('/:id')
  update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateReferenceImageDto
  ) {
    return this._service.update(org.id, id, body);
  }

  @Delete('/:id')
  archive(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._service.archive(org.id, id);
  }

  @Post('/:id/restore')
  restore(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._service.restore(org.id, id);
  }
}
