import { Router, Request, Response, NextFunction } from 'express';
import GoogleDriveController, { upload } from '@src/controllers/GoogleDriveController';

// Create router
const googleDriveRouter = Router();

// Create proper route handlers that match Express expectations
const uploadFileHandler = (req: Request, res: Response, next: NextFunction): void => {
  GoogleDriveController.uploadFile(req, res)
    .catch(next);
};

const uploadMultipartFileHandler = (req: Request, res: Response, next: NextFunction): void => {
  GoogleDriveController.uploadMultipartFile(req, res)
    .catch(next);
};

const startUploadHandler = (req: Request, res: Response, next: NextFunction): void => {
  GoogleDriveController.startUpload(req, res)
    .catch(next);
};

const getUploadStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  GoogleDriveController.getUploadStatus(req, res)
    .catch(next);
};

const getAllUploadsHandler = (req: Request, res: Response, next: NextFunction): void => {
  GoogleDriveController.getAllUploads(req, res)
    .catch(next);
};

const cancelUploadHandler = (req: Request, res: Response, next: NextFunction): void => {
  GoogleDriveController.cancelUpload(req, res)
    .catch(next);
};

/**
 * @route   POST /upload/path
 * @desc    Upload a file to Google Drive from a local path
 * @access  Public
 */
googleDriveRouter.post(
  '/upload/path',
  uploadFileHandler,
);

/**
 * @route   POST /upload/file
 * @desc    Upload a file to Google Drive from a form upload
 * @access  Public
 */
googleDriveRouter.post(
  '/upload/file',
  upload.single('file'),
  uploadMultipartFileHandler,
);

/**
 * @route   POST /start
 * @desc    Start an asynchronous file upload and get an upload ID
 * @access  Public
 */
googleDriveRouter.post(
  '/start',
  startUploadHandler,
);

/**
 * @route   GET /status/:id
 * @desc    Get the status of an upload by ID
 * @access  Public
 */
googleDriveRouter.get(
  '/status/:id',
  getUploadStatusHandler,
);

/**
 * @route   GET /all
 * @desc    Get all uploads status
 * @access  Public
 */
googleDriveRouter.get(
  '/all',
  getAllUploadsHandler,
);

/**
 * @route   DELETE /cancel/:id
 * @desc    Cancel an ongoing upload
 * @access  Public
 */
googleDriveRouter.delete(
  '/cancel/:id',
  cancelUploadHandler,
);

export default googleDriveRouter;