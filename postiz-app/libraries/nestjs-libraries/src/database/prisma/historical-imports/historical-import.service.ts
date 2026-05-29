import { Injectable } from '@nestjs/common';
import {
  HistoricalImportJobCreateInput,
  HistoricalImportRepository,
  HistoricalImportSourceUpsertInput,
  HistoricalPostMetricCreateInput,
  HistoricalPostUpsertInput,
} from '@gitroom/nestjs-libraries/database/prisma/historical-imports/historical-import.repository';

@Injectable()
export class HistoricalImportService {
  constructor(private _historicalImportRepository: HistoricalImportRepository) {}

  createOrUpdateSource(input: HistoricalImportSourceUpsertInput) {
    return this._historicalImportRepository.createOrUpdateSource(input);
  }

  createJobRecord(input: HistoricalImportJobCreateInput) {
    return this._historicalImportRepository.createJobRecord(input);
  }

  upsertHistoricalPost(input: HistoricalPostUpsertInput) {
    return this._historicalImportRepository.upsertHistoricalPost(input);
  }

  insertHistoricalPostMetrics(metrics: HistoricalPostMetricCreateInput[]) {
    return this._historicalImportRepository.insertHistoricalPostMetrics(metrics);
  }
}
