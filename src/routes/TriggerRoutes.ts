// src/routes/TriggerRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import TriggerController from '@src/controllers/TriggerController';

// Create router
const triggerRouter = Router();

// Create proper route handlers that match Express expectations
const startTriggerHandler = (req: Request, res: Response, next: NextFunction): void => {
  TriggerController.startTrigger(req, res).catch(next);
};

const getTriggerStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    TriggerController.getTriggerStatus(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getAllTriggerStatusesHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    TriggerController.getAllTriggerStatuses(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getUploadStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    TriggerController.getUploadStatus(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getAllUploadStatusesHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    TriggerController.getAllUploadStatuses(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const cancelUploadHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    TriggerController.cancelUpload(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @route   POST /start
 * @desc    Start a trigger flow (record video, upload, and send SMS)
 * @access  Public
 */
triggerRouter.post('/start', startTriggerHandler);

/**
 * @route   GET /:id
 * @desc    Get status of a specific trigger
 * @access  Public
 */
triggerRouter.get('/:id', getTriggerStatusHandler);

/**
 * @route   GET /
 * @desc    Get status of all triggers
 * @access  Public
 */
triggerRouter.get('/', getAllTriggerStatusesHandler);

/**
 * @route   GET /upload/:id
 * @desc    Get status of a specific upload
 * @access  Public
 */
triggerRouter.get('/upload/:id', getUploadStatusHandler);

/**
 * @route   GET /uploads
 * @desc    Get status of all uploads
 * @access  Public
 */
triggerRouter.get('/uploads', getAllUploadStatusesHandler);

/**
 * @route   DELETE /upload/:id
 * @desc    Cancel an ongoing upload
 * @access  Public
 */
triggerRouter.delete('/upload/:id', cancelUploadHandler);

export default triggerRouter;