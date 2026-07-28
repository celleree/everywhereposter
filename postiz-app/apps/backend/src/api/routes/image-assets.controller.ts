import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ImageAssetService } from '@gitroom/nestjs-libraries/copy-generation/image-asset.service';
import { RenderImagePlansDto } from '@gitroom/nestjs-libraries/dtos/copy-generation/render.image.plans.dto';

@ApiTags('Image Assets')
@Controller('/image-assets')
export class ImageAssetsController {
  constructor(private readonly _imageAssetService: ImageAssetService) {}

  @Post('/render')
  renderImagePlans(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RenderImagePlansDto
  ) {
    return this._imageAssetService.render(org, body);
  }
}
