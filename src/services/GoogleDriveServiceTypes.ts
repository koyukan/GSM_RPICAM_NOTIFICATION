// src/services/GoogleDriveServiceTypes.ts
import { EventEmitter } from 'events';

// Interface for upload status
export interface UploadStatus {
  fileId: string | null;
  fileName: string;
  filePath: string;
  startTime: number;
  endTime: number | null;
  bytesTotal: number;
  bytesUploaded: number;
  percentComplete: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'canceled';
  error: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
}

// Interface for upload options
export interface UploadOptions {
  mimeType?: string;
  folderID?: string;
  fileName?: string;
}

// Interface for what GoogleDriveService provides
export interface IGoogleDriveService extends EventEmitter {
  startUpload(filePath: string, options?: UploadOptions): Promise<string>;
  getUploadStatus(uploadId: string): UploadStatus | null;
  getAllUploadStatuses(): UploadStatus[];
  cancelUpload(uploadId: string): boolean;
  makeFilePublic(fileId: string): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadFile(filePath: string, options?: UploadOptions): Promise<any>;
  getDirectDownloadLink(webContentLink: string): string;
}