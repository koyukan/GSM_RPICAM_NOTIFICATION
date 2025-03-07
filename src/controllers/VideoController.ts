// src/controllers/VideoController.ts
import { Request, Response } from 'express';
import { RouteError } from '@src/common/route-errors';
import HttpStatusCodes from '@src/common/HttpStatusCodes';
import logger from 'jet-logger';
import VideoService from '@src/services/VideoService';

/**
 * Controller for video capture operations
 */
class VideoController {
  /**
   * Start a video capture
   */
  public startCapture(req: Request, res: Response): Response {
    try {
      const body = req.body as Record<string, unknown>;
      
      // Safely extract and validate parameters
      const duration = typeof body.duration === 'number' ? body.duration :
                      typeof body.duration === 'string' ? parseInt(body.duration, 10) : 10000;
      
      const filename = typeof body.filename === 'string' ? body.filename : '';
      
      if (isNaN(duration) || duration <= 0) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Duration must be a positive number'
        );
      }
      
      const status = VideoService.startCapture({
        duration,
        filename
      });
      
      return res.status(HttpStatusCodes.OK).json({
        message: 'Video capture started',
        status
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Video capture error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to start video capture'
      );
    }
  }
  
  /**
   * Start streaming to a specified destination
   */
  public async startStream(req: Request, res: Response): Promise<Response> {
    try {
      const body = req.body as Record<string, unknown>;
      
      // Validate destination
      const destination = typeof body.destination === 'string' ? body.destination : '';
      if (!destination) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Destination is required'
        );
      }
      
      // Validate timeout
      const timeout = typeof body.timeout === 'number' ? body.timeout :
                      typeof body.timeout === 'string' ? parseInt(body.timeout, 10) : 300;
      
      if (isNaN(timeout) || timeout <= 0) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Timeout must be a positive number in seconds'
        );
      }
      
      const success = await VideoService.startStream({
        destination,
        timeout,
        timeoutRemaining: null
      });
      
      if (!success) {
        throw new RouteError(
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          'Failed to start stream'
        );
      }
      
      return res.status(HttpStatusCodes.OK).json({
        message: 'Stream started successfully',
        destination,
        timeout
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Stream start error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to start stream'
      );
    }
  }
  
  /**
   * Stop the current stream
   */
  public async stopStream(req: Request, res: Response): Promise<Response> {
    try {
      const success = await VideoService.stopStream();
      
      if (!success) {
        throw new RouteError(
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          'Failed to stop stream'
        );
      }
      
      return res.status(HttpStatusCodes.OK).json({
        message: 'Stream stopped successfully'
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Stream stop error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to stop stream'
      );
    }
  }
  
  /**
   * Get the status of a video capture
   */
  public getStatus(req: Request, res: Response): Response {
    try {
      const captureId = req.params.id;
      
      if (!captureId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Capture ID is required'
        );
      }
      
      const status = VideoService.getStatus(captureId);
      
      if (!status) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `Video capture with ID ${captureId} not found`
        );
      }
      
      return res.status(HttpStatusCodes.OK).json(status);
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Video status error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get video capture status'
      );
    }
  }
  
  /**
   * Get the status of all video captures
   */
  public getAllStatuses(req: Request, res: Response): Response {
    try {
      const statuses = VideoService.getAllStatuses();
      return res.status(HttpStatusCodes.OK).json({
        count: statuses.length,
        captures: statuses
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Video statuses error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get video capture statuses'
      );
    }
  }
  
  /**
   * Get the status of the current stream
   */
  public getStreamStatus(req: Request, res: Response): Response {
    try {
      const status = VideoService.getStreamStatus();
      return res.status(HttpStatusCodes.OK).json(status);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Stream status error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get stream status'
      );
    }
  }
  
  /**
   * Get detailed system status
   */
  public async getDetailedStatus(req: Request, res: Response): Promise<Response> {
    try {
      const status = await VideoService.getDetailedStatus();
      return res.status(HttpStatusCodes.OK).json(status);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Detailed status error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get detailed status'
      );
    }
  }
  
  /**
   * Stop a video capture
   */
  public async stopCapture(req: Request, res: Response): Promise<Response> {
    try {
      const captureId = req.params.id;
      
      if (!captureId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Capture ID is required'
        );
      }
      
      const killed = await VideoService.killProcess(captureId);
      const status = VideoService.getStatus(captureId);
      
      if (!status) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `Video capture with ID ${captureId} not found`
        );
      }
      
      return res.status(HttpStatusCodes.OK).json({
        message: killed ? 'Video capture stopped' : 'Video capture already completed',
        status
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Video stop error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to stop video capture'
      );
    }
  }
  
  /**
   * List available video files
   */
  public async listVideos(req: Request, res: Response): Promise<Response> {
    try {
      const files = await VideoService.getVideoFiles();
      return res.status(HttpStatusCodes.OK).json({
        count: files.length,
        files
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Video list error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to list video files'
      );
    }
  }
}

export default new VideoController();