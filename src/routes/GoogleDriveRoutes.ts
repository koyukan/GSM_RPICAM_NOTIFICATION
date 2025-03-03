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

export default googleDriveRouter;