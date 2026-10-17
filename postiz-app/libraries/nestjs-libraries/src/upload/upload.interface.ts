export interface IUploadProvider {
  uploadFromPath(path: string, originalName: string): Promise<UploadedFileReceipt>;
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  removeFile(filePath: string): Promise<void>;
}

// Rollback owns only this newly generated artifact; never serialize the receipt.
export interface UploadedFileReceipt {
  filename: string;
  originalname: string;
  path: string;
  mimetype: 'video/mp4';
  rollback: () => Promise<void>;
}
