// src/routes/VideoRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import VideoController from '@src/controllers/VideoController';

// Create router
const videoRouter = Router();

// Create proper route handlers that match Express expectations
const startCaptureHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.startCapture(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.getStatus(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getAllStatusesHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.getAllStatuses(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const stopCaptureHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.stopCapture(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const listVideosHandler = (req: Request, res: Response, next: NextFunction): void => {
  VideoController.listVideos(req, res).catch(next);
};

/**
 * @route   POST /capture
 * @desc    Start a video capture
 * @access  Public
 */
videoRouter.post('/capture', startCaptureHandler);

/**
 * @route   GET /capture/:id
 * @desc    Get status of a video capture
 * @access  Public
 */
videoRouter.get('/capture/:id', getStatusHandler);

/**
 * @route   GET /capture
 * @desc    Get status of all video captures
 * @access  Public
 */
videoRouter.get('/capture', getAllStatusesHandler);

/**
 * @route   DELETE /capture/:id
 * @desc    Stop a video capture
 * @access  Public
 */
videoRouter.delete('/capture/:id', stopCaptureHandler);

/**
 * @route   GET /files
 * @desc    List available video files
 * @access  Public
 */
videoRouter.get('/files', listVideosHandler);

export default videoRouter;