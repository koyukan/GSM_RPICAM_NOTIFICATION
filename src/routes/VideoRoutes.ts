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

const startStreamHandler = (req: Request, res: Response, next: NextFunction): void => {
  VideoController.startStream(req, res).catch(next);
};

const stopStreamHandler = (req: Request, res: Response, next: NextFunction): void => {
  VideoController.stopStream(req, res).catch(next);
};

const getStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.getStatus(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getStreamStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.getStreamStatus(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getDetailedStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  VideoController.getDetailedStatus(req, res).catch(next);
};

const getAllStatusesHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    VideoController.getAllStatuses(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const stopCaptureHandler = (req: Request, res: Response, next: NextFunction): void => {
  VideoController.stopCapture(req, res).catch(next);
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
 * @route   POST /stream
 * @desc    Start streaming video to a destination
 * @access  Public
 */
videoRouter.post('/stream', startStreamHandler);

/**
 * @route   DELETE /stream
 * @desc    Stop the current stream
 * @access  Public
 */
videoRouter.delete('/stream', stopStreamHandler);

/**
 * @route   GET /stream/status
 * @desc    Get status of the current stream
 * @access  Public
 */
videoRouter.get('/stream/status', getStreamStatusHandler);

/**
 * @route   GET /capture/:id
 * @desc    Get status of a video capture
 * @access  Public
 */
videoRouter.get('/capture/:id', getStatusHandler);

/**
 * @route   GET /status
 * @desc    Get detailed status of all components
 * @access  Public
 */
videoRouter.get('/status', getDetailedStatusHandler);

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