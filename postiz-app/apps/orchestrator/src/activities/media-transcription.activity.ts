import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { MediaTranscriptionService } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';

@Injectable()
@Activity()
export class MediaTranscriptionActivity {
  constructor(
    private readonly _mediaTranscriptionService: MediaTranscriptionService
  ) {}

  @ActivityMethod()
  transcribeMedia(input: { transcriptionId: string; generation: number }) {
    return this._mediaTranscriptionService.processTranscription(
      input.transcriptionId,
      input.generation
    );
  }

  @ActivityMethod()
  failMediaTranscription(input: {
    transcriptionId: string;
    generation: number;
  }) {
    return this._mediaTranscriptionService.failTranscription(
      input.transcriptionId,
      input.generation
    );
  }
}
