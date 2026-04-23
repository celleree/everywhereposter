import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import path from 'path';

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.srt', '.vtt']);
const MAX_TRANSCRIPT_UPLOAD_SIZE = 5 * 1024 * 1024;

@Injectable()
export class KnowledgeBaseUploadValidationPipe implements PipeTransform {
  transform(value: any) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (!value.buffer || !Buffer.isBuffer(value.buffer)) {
      throw new BadRequestException('Invalid transcript upload.');
    }

    const extension = path.extname(value.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'Unsupported transcript file type. Use .txt, .md, .srt, or .vtt.'
      );
    }

    if (value.size > MAX_TRANSCRIPT_UPLOAD_SIZE) {
      throw new BadRequestException(
        'Transcript upload exceeds the 5 MB size limit.'
      );
    }

    const bufferPreview = value.buffer.toString('utf8', 0, 2048);
    const controlCharacters = (bufferPreview.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || [])
      .length;

    if (controlCharacters > 10) {
      throw new BadRequestException(
        'Transcript upload appears to be a binary file instead of plain text.'
      );
    }

    return value;
  }
}
