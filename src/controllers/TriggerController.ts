// src/controllers/TriggerController.ts
import { Request, Response } from 'express';
import { RouteError } from '@src/common/route-errors';
import HttpStatusCodes from '@src/common/HttpStatusCodes';
import logger from 'jet-logger';
import TriggerService, { TriggerConfig } from '@src/services/TriggerService';
import GoogleDriveService from '@src/services/GoogleDriveService';
import { getBoolEnv } from '@src/util/env';

/**
 * Controller for trigger operations
 */
class TriggerController {
  /**
   * Start a new trigger flow (record, upload, notify)
   */
  public async startTrigger(req: Request, res: Response): Promise<Response> {
    try {
      const body = req.body as Record<string, unknown>;
      
      // Validate and extract required parameters
      const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber : '';
      if (!phoneNumber) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Phone number is required'
        );
      }
      
      // Extract and validate optional parameters with defaults
      const videoDuration = typeof body.videoDuration === 'number' ? body.videoDuration :
                           typeof body.videoDuration === 'string' ? parseInt(body.videoDuration, 10) : 10000;
      
      const videoFilename = typeof body.videoFilename === 'string' ? body.videoFilename : undefined;
      const customMessage = typeof body.customMessage === 'string' ? body.customMessage : undefined;
      
      // Check if early notification should be sent (defaults to env setting)
      const sendEarlyNotification = typeof body.sendEarlyNotification === 'boolean' ? 
                                   body.sendEarlyNotification : 
                                   getBoolEnv('SMS_SEND_EARLY_NOTIFICATION', true);
      
      // Validate numeric parameters
      if (isNaN(videoDuration) || videoDuration <= 0) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Video duration must be a positive number'
        );
      }
      
      // Create trigger config
      const config: TriggerConfig = {
        phoneNumber,
        videoDuration,
        sendEarlyNotification,
      };
      
      // Add optional parameters if provided
      if (videoFilename) config.videoFilename = videoFilename;
      if (customMessage) config.customMessage = customMessage;
      
      // Start the trigger flow
      const triggerStatus = await TriggerService.startTrigger(config);
      
      return res.status(HttpStatusCodes.OK).json({
        message: 'Trigger flow started successfully',
        triggerId: triggerStatus.id,
        status: triggerStatus
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Trigger flow error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to start trigger flow'
      );
    }
  }
  
  /**
   * Get status of a specific trigger
   */
  public getTriggerStatus(req: Request, res: Response): Response {
    try {
      const triggerId = req.params.id;
      
      if (!triggerId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Trigger ID is required'
        );
      }
      
      const status = TriggerService.getTriggerStatus(triggerId);
      
      if (!status) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `Trigger with ID ${triggerId} not found`
        );
      }
      
      return res.status(HttpStatusCodes.OK).json(status);
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Get trigger status error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get trigger status'
      );
    }
  }
  
  /**
   * Get status of all triggers
   */
  public getAllTriggerStatuses(req: Request, res: Response): Response {
    try {
      const statuses = TriggerService.getAllTriggerStatuses();
      return res.status(HttpStatusCodes.OK).json({
        count: statuses.length,
        triggers: statuses
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Get all trigger statuses error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get trigger statuses'
      );
    }
  }
  
  /**
   * Get status of a specific upload
   */
  public getUploadStatus(req: Request, res: Response): Response {
    try {
      const uploadId = req.params.id;
      
      if (!uploadId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Upload ID is required'
        );
      }
      
      const status = GoogleDriveService.getUploadStatus(uploadId);
      
      if (!status) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `Upload with ID ${uploadId} not found`
        );
      }
      
      return res.status(HttpStatusCodes.OK).json(status);
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Get upload status error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get upload status'
      );
    }
  }
  
  /**
   * Get status of all uploads
   */
  public getAllUploadStatuses(req: Request, res: Response): Response {
    try {
      const statuses = GoogleDriveService.getAllUploadStatuses();
      return res.status(HttpStatusCodes.OK).json({
        count: statuses.length,
        uploads: statuses
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Get all upload statuses error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get upload statuses'
      );
    }
  }
  
  /**
   * Cancel an upload
   */
  public cancelUpload(req: Request, res: Response): Response {
    try {
      const uploadId = req.params.id;
      
      if (!uploadId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Upload ID is required'
        );
      }
      
      const canceled = GoogleDriveService.cancelUpload(uploadId);
      
      if (!canceled) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          `Upload with ID ${uploadId} cannot be canceled (not found or already completed)`
        );
      }
      
      return res.status(HttpStatusCodes.OK).json({
        message: `Upload ${uploadId} canceled successfully`,
        uploadId
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Cancel upload error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to cancel upload'
      );
    }
  }
}

export default new TriggerController();