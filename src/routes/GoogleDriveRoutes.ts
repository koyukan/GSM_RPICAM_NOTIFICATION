import { Router } from 'express';
import GoogleDriveController, { upload } from '@src/controllers/GoogleDriveController';

// Create router
const googleDriveRouter = Router();

// Bind methods to avoid unbound method issues
const uploadFileHandler = GoogleDriveController.uploadFile.bind(GoogleDriveController);
const uploadMultipartFileHandler = GoogleDriveController.uploadMultipartFile.bind(GoogleDriveController);

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