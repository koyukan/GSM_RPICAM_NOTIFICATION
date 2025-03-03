import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { RouteError } from '@src/common/route-errors';
import HttpStatusCodes from '@src/common/HttpStatusCodes';
import logger from 'jet-logger';
import multer from 'multer';
import os from 'os';

import GoogleDriveService from '@src/services/GoogleDriveService';

/**
 * Type definitions for request body
 */
interface UploadFileRequest {
  filePath: string;
  mimeType?: string;
  folderID?: string;
  fileName?: string;
}

/**
 * Type definitions for file upload
 */
interface FileUpload {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

/**
 * Request with file upload
 */
interface RequestWithFile extends Request {
  file?: FileUpload;
}

/**
 * Configure multer for file upload
 */
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    const tempDir = path.join(os.tmpdir(), 'uploads');
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    cb(null, tempDir);
  },
  filename: function (_req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 500, // 500MB limit
  },
});

/**
 * Controller for Google Drive operations
 */
class GoogleDriveController {
  /**
   * Upload a file to Google Drive from a provided local path
   */
  public async uploadFile(req: Request, res: Response): Promise<Response> {
    try {
      const { filePath, mimeType, folderID, fileName } = req.body as UploadFileRequest;

      if (!filePath) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'File path is required',
        );
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `File not found at path: ${filePath}`,
        );
      }

      // Upload to Google Drive
      const fileData = await GoogleDriveService.uploadFile(filePath, {
        mimeType,
        folderID,
        fileName,
      });

      // Return file information with direct download link
      return res.status(HttpStatusCodes.OK).json({
        message: 'File uploaded successfully',
        file: {
          ...fileData,
          directDownloadLink: GoogleDriveService.getDirectDownloadLink(fileData.webContentLink || ''),
        },
      });
    } catch (error) {
      logger.err('Error in uploadFile controller:', error);
      if (error instanceof RouteError) {
        throw error;
      }
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Error uploading file to Google Drive',
      );
    }
  }

  /**
   * Upload a file to Google Drive from a multipart form upload
   */
  public async uploadMultipartFile(req: RequestWithFile, res: Response): Promise<Response> {
    try {
      if (!req.file) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'No file was uploaded',
        );
      }

      const filePath = req.file.path;
      const { folderID } = req.body;
      const fileName = req.body.fileName as string || req.file.originalname;

      // Upload to Google Drive
      const fileData = await GoogleDriveService.uploadFile(filePath, {
        mimeType: req.file.mimetype,
        folderID: folderID as string | undefined,
        fileName,
      });

      // Clean up temp file after upload
      fs.unlink(filePath, (err) => {
        if (err) {
          logger.err(`Error deleting temp file ${filePath}:`, err);
        }
      });

      // Return file information with direct download link
      return res.status(HttpStatusCodes.OK).json({
        message: 'File uploaded successfully',
        file: {
          ...fileData,
          directDownloadLink: GoogleDriveService.getDirectDownloadLink(fileData.webContentLink || ''),
        },
      });
    } catch (error) {
      logger.err('Error in uploadMultipartFile controller:', error);
      
      // Remove temp file if it exists
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {
          // Intentionally empty callback
        });
      }
      
      if (error instanceof RouteError) {
        throw error;
      }
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Error uploading file to Google Drive',
      );
    }
  }
}

export default new GoogleDriveController();