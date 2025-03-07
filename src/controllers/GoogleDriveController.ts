/* eslint-disable @typescript-eslint/require-await */
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { RouteError } from '@src/common/route-errors';
import HttpStatusCodes from '@src/common/HttpStatusCodes';
import logger from 'jet-logger';
import multer from 'multer';
import os from 'os';

import GoogleDriveService from '@src/services/GoogleDriveService';

// Define MulterFile interface that matches the structure of uploaded files
interface MulterFile {
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
   * Start an asynchronous upload from a provided local path
   */
  public async startUpload(req: Request, res: Response): Promise<Response> {
    try {
      const body = req.body as Record<string, unknown>;
      
      const filePath = typeof body.filePath === 'string' ? body.filePath : '';
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : undefined;
      const folderID = typeof body.folderID === 'string' ? body.folderID : undefined;
      const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;

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

      // Get file size
      const stats = fs.statSync(filePath);

      // Start async upload and get upload ID
      const uploadId = await GoogleDriveService.startUpload(filePath, {
        mimeType,
        folderID,
        fileName,
      });

      // Get initial status
      const status = GoogleDriveService.getUploadStatus(uploadId);
      if (!status) {
        throw new RouteError(
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          'Failed to get upload status',
        );
      }

      // Return the upload ID and initial status
      return res.status(HttpStatusCodes.OK).json({
        message: 'File upload started',
        uploadId,
        status,
        fileName: status.fileName,
        fileSize: stats.size,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error in startUpload controller: ' + errorMessage);
      if (error instanceof RouteError) {
        throw error;
      }
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Error starting file upload to Google Drive',
      );
    }
  }

  /**
   * Get the status of an upload
   */
  public async getUploadStatus(req: Request, res: Response): Promise<Response> {
    try {
      const uploadId = req.params.id;

      if (!uploadId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Upload ID is required',
        );
      }

      // Get status
      const status = GoogleDriveService.getUploadStatus(uploadId);
      if (!status) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `Upload with ID ${uploadId} not found`,
        );
      }

      // If the upload is complete and we have a fileId, ensure we return the proper links
      if (status.status === 'completed' && status.fileId) {
        // Return status with direct download link
        return res.status(HttpStatusCodes.OK).json({
          ...status,
          directDownloadLink: status.webContentLink 
            ? GoogleDriveService.getDirectDownloadLink(status.webContentLink) 
            : null,
        });
      }

      // Return status
      return res.status(HttpStatusCodes.OK).json(status);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error in getUploadStatus controller: ' + errorMessage);
      if (error instanceof RouteError) {
        throw error;
      }
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Error getting upload status',
      );
    }
  }

  /**
   * Get all uploads
   */
  public async getAllUploads(req: Request, res: Response): Promise<Response> {
    try {
      const statuses = GoogleDriveService.getAllUploadStatuses();
      
      // Add direct download links to completed uploads
      const statusesWithLinks = statuses.map(status => {
        if (status.status === 'completed' && status.webContentLink) {
          return {
            ...status,
            directDownloadLink: GoogleDriveService.getDirectDownloadLink(status.webContentLink),
          };
        }
        return status;
      });

      return res.status(HttpStatusCodes.OK).json({
        count: statusesWithLinks.length,
        uploads: statusesWithLinks,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error in getAllUploads controller: ' + errorMessage);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Error getting all uploads',
      );
    }
  }

  /**
   * Cancel an upload
   */
  public async cancelUpload(req: Request, res: Response): Promise<Response> {
    try {
      const uploadId = req.params.id;

      if (!uploadId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Upload ID is required',
        );
      }

      // Cancel upload
      const canceled = GoogleDriveService.cancelUpload(uploadId);
      if (!canceled) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          `Upload with ID ${uploadId} cannot be canceled (not found or already completed)`,
        );
      }

      return res.status(HttpStatusCodes.OK).json({
        message: `Upload ${uploadId} canceled successfully`,
        uploadId,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error in cancelUpload controller: ' + errorMessage);
      if (error instanceof RouteError) {
        throw error;
      }
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Error canceling upload',
      );
    }
  }

  /**
   * Upload a file to Google Drive from a provided local path
   * (Legacy method - maintained for backward compatibility)
   */
  public async uploadFile(req: Request, res: Response): Promise<Response> {
    try {
      const body = req.body as Record<string, unknown>;
      
      const filePath = typeof body.filePath === 'string' ? body.filePath : '';
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : undefined;
      const folderID = typeof body.folderID === 'string' ? body.folderID : undefined;
      const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;

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
          directDownloadLink: GoogleDriveService.getDirectDownloadLink(fileData.webContentLink ?? ''),
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error in uploadFile controller: ' + errorMessage);
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
   * (Legacy method - maintained for backward compatibility)
   */
  public async uploadMultipartFile(req: Request, res: Response): Promise<Response> {
    try {
      // Safely cast to known structure
      const file = req.file as MulterFile | undefined;
      
      if (!file) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'No file was uploaded',
        );
      }

      // Safely access file properties
      const filePath = file.path;
      const fileMimeType = file.mimetype;
      const fileOriginalName = file.originalname;
      
      // Extract and validate form fields
      const reqBody = req.body as Record<string, unknown>;
      const folderID = typeof reqBody.folderID === 'string' ? reqBody.folderID : undefined;
      const fileName = typeof reqBody.fileName === 'string' ? reqBody.fileName : fileOriginalName;

      // Upload to Google Drive
      const fileData = await GoogleDriveService.uploadFile(filePath, {
        mimeType: fileMimeType,
        folderID,
        fileName,
      });

      // Clean up temp file after upload
      fs.unlink(filePath, (unlinkErr: NodeJS.ErrnoException | null) => {
        if (unlinkErr) {
          logger.err(`Error deleting temp file ${filePath}: ${unlinkErr.message}`);
        }
      });

      // Return file information with direct download link
      return res.status(HttpStatusCodes.OK).json({
        message: 'File uploaded successfully',
        file: {
          ...fileData,
          directDownloadLink: GoogleDriveService.getDirectDownloadLink(fileData.webContentLink ?? ''),
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error in uploadMultipartFile controller: ' + errorMessage);
      
      // Remove temp file if it exists 
      const file = req.file as MulterFile | undefined;
      if (file && typeof file.path === 'string') {
        fs.unlink(file.path, () => {
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