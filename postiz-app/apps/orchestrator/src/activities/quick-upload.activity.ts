import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { QuickUploadService } from '@gitroom/nestjs-libraries/upload/quick-upload.service';

@Injectable()
@Activity()
export class QuickUploadActivity {
  constructor(private quick: QuickUploadService) {}
  @ActivityMethod() async drainQuickUploads() { return this.quick.drain(); }
  @ActivityMethod() async prepareQuickUpload(id: string) { return this.quick.prepare(id); }
  @ActivityMethod() async generateQuickUpload(id: string) { return this.quick.generate(id); }
  @ActivityMethod() async submitQuickUpload(id: string) { return this.quick.submit(id); }
  @ActivityMethod() async reconcileQuickUpload(id: string) { return this.quick.reconcile(id); }
  @ActivityMethod() async failQuickUpload(id: string) { return this.quick.fail(id); }
}
