// src/routes/GSMRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import GSMController from '@src/controllers/GSMController';

// Create router
const gsmRouter = Router();

// Create proper route handlers that match Express expectations
const initializeHandler = (req: Request, res: Response, next: NextFunction): void => {
  GSMController.initialize(req, res).catch(next);
};

const getStatusHandler = (req: Request, res: Response, next: NextFunction): void => {
  try {
    GSMController.getStatus(req, res);
  } catch (error: unknown) {
    next(error);
  }
};

const getLocationHandler = (req: Request, res: Response, next: NextFunction): void => {
  GSMController.getLocation(req, res).catch(next);
};

const listSMSHandler = (req: Request, res: Response, next: NextFunction): void => {
  GSMController.listSMS(req, res).catch(next);
};

const readSMSHandler = (req: Request, res: Response, next: NextFunction): void => {
  GSMController.readSMS(req, res).catch(next);
};

const sendSMSHandler = (req: Request, res: Response, next: NextFunction): void => {
  GSMController.sendSMS(req, res).catch(next);
};

/**
 * @route   POST /init
 * @desc    Initialize GSM modem
 * @access  Public
 */
gsmRouter.post('/init', initializeHandler);

/**
 * @route   GET /status
 * @desc    Get GSM modem status
 * @access  Public
 */
gsmRouter.get('/status', getStatusHandler);

/**
 * @route   GET /location
 * @desc    Get current location
 * @access  Public
 */
gsmRouter.get('/location', getLocationHandler);

/**
 * @route   GET /sms
 * @desc    List SMS messages
 * @access  Public
 */
gsmRouter.get('/sms', listSMSHandler);

/**
 * @route   GET /sms/:id
 * @desc    Read SMS message
 * @access  Public
 */
gsmRouter.get('/sms/:id', readSMSHandler);

/**
 * @route   POST /sms
 * @desc    Send SMS message
 * @access  Public
 */
gsmRouter.post('/sms', sendSMSHandler);

export default gsmRouter;