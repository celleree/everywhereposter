export interface IUploadProvider {
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  uploadFromPath(
    filePath: string,
    originalName: string
  ): Promise<{
    filename: string;
    path: string;
    mimetype: string;
    originalname: string;
    size: number;
  }>;
  removeFile(filePath: string): Promise<void>;
}
