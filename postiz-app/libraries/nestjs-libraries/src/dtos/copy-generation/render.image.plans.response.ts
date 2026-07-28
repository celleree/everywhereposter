import { CopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import {
  ImagePlanAspectRatio,
  ImagePlanType,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export type ImageAssetRenderStatus = 'completed' | 'failed';

export interface RenderedImageAssetMedia {
  id: string;
  name: string;
  originalName?: string | null;
  path: string;
  type: string;
  thumbnail?: string | null;
  alt?: string | null;
}

export interface RenderedImagePlanResult {
  planId: string;
  platform: CopyPlatform;
  type: ImagePlanType;
  aspectRatio: ImagePlanAspectRatio;
  status: ImageAssetRenderStatus;
  width?: number;
  height?: number;
  mimeType?: 'image/png';
  media?: RenderedImageAssetMedia;
  error?: {
    code: 'IMAGE_ASSET_RENDER_FAILED';
    message: string;
  };
}

export interface RenderImagePlansResponse {
  mediaId: string;
  status: 'complete' | 'partial' | 'failed';
  results: RenderedImagePlanResult[];
}
