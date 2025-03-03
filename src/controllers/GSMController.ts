// src/controllers/GSMController.ts
import { Request, Response } from 'express';
import { RouteError } from '@src/common/route-errors';
import HttpStatusCodes from '@src/common/HttpStatusCodes';
import logger from 'jet-logger';
import GSMService from '@src/services/GSMService';

/**
 * Controller for GSM operations
 */
class GSMController {
  /**
   * Initialize GSM modem
   */
  public async initialize(req: Request, res: Response): Promise<Response> {
    try {
      const result = await GSMService.initialize();
      return res.status(HttpStatusCodes.OK).json({
        success: result,
        message: result ? 'GSM modem initialized successfully' : 'Failed to initialize GSM modem',
        status: GSMService.getStatus()
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM initialization error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to initialize GSM modem'
      );
    }
  }

  /**
   * Get GSM modem status
   * Removed async since there are no await expressions
   */
  public getStatus(req: Request, res: Response): Response {
    try {
      return res.status(HttpStatusCodes.OK).json(GSMService.getStatus());
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM status error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get GSM modem status'
      );
    }
  }

  /**
   * Get current location
   */
  public async getLocation(req: Request, res: Response): Promise<Response> {
    try {
      const location = await GSMService.getLocation();
      return res.status(HttpStatusCodes.OK).json({
        location,
        available: location.available
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM location error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to get location from GSM modem'
      );
    }
  }

  /**
   * List SMS messages
   */
  public async listSMS(req: Request, res: Response): Promise<Response> {
    try {
      const smsListResponse = await GSMService.listSMS();
      return res.status(HttpStatusCodes.OK).json(smsListResponse);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM SMS list error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to list SMS messages'
      );
    }
  }

  /**
   * Read SMS message
   */
  public async readSMS(req: Request, res: Response): Promise<Response> {
    try {
      const smsId = req.params.id;
      if (!smsId) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'SMS ID is required'
        );
      }

      const smsMessage = await GSMService.readSMS(smsId);
      if (!smsMessage) {
        throw new RouteError(
          HttpStatusCodes.NOT_FOUND,
          `SMS message with ID ${smsId} not found`
        );
      }

      return res.status(HttpStatusCodes.OK).json(smsMessage);
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM SMS read error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to read SMS message'
      );
    }
  }

  /**
   * Send SMS message
   */
  public async sendSMS(req: Request, res: Response): Promise<Response> {
    try {
      const body = req.body as Record<string, unknown>;
      
      // Safely extract and validate number and text from request body
      const number = typeof body.number === 'string' ? body.number : '';
      const text = typeof body.text === 'string' ? body.text : '';
      
      if (!number || !text) {
        throw new RouteError(
          HttpStatusCodes.BAD_REQUEST,
          'Phone number and message text are required'
        );
      }

      const success = await GSMService.sendNewSMS(number, text);
      
      return res.status(success ? HttpStatusCodes.OK : HttpStatusCodes.INTERNAL_SERVER_ERROR).json({
        success,
        message: success ? 'SMS sent successfully' : 'Failed to send SMS'
      });
    } catch (error: unknown) {
      if (error instanceof RouteError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM SMS send error: ${errorMessage}`);
      throw new RouteError(
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to send SMS message'
      );
    }
  }
}

export default new GSMController();