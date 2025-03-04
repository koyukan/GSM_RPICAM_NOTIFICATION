// src/services/TriggerService.ts
import logger from 'jet-logger';
import VideoService, { VideoStatus } from '@src/services/VideoService';
import GoogleDriveService from '@src/services/GoogleDriveService';
import GSMService from '@src/services/GSMService';
import fs from 'fs';

/**
 * Interface for trigger configuration
 */
export interface TriggerConfig {
  videoDuration: number;
  phoneNumber: string;
  customMessage?: string;
  videoFilename?: string;
}

/**
 * Interface for trigger status
 */
export interface TriggerStatus {
  id: string;
  createdAt: number;
  completed: boolean;
  currentStep: 'initialized' | 'recording' | 'uploading' | 'notifying' | 'completed' | 'failed';
  videoStatus?: VideoStatus;
  uploadedFileId?: string;
  uploadedFileLink?: string;
  smsStatus?: boolean;
  error?: string;
}

/**
 * Service to orchestrate the trigger flow: record video → upload → send SMS
 */
class TriggerService {
  // Use constructor-type arguments for generic Map
  private triggers = new Map<string, TriggerStatus>();
  private gsmInitialized = false;
  
  /**
   * Start the trigger flow process
   * @param config Configuration for the trigger
   * @returns The trigger status
   */
  public startTrigger(config: TriggerConfig): Promise<TriggerStatus> {
    const id = `trigger_${Date.now()}`;
    const timestamp = Date.now();
    
    // Initialize trigger status
    const status: TriggerStatus = {
      id,
      createdAt: timestamp,
      completed: false,
      currentStep: 'initialized',
    };
    
    // Store the status
    this.triggers.set(id, status);
    
    // Start the process asynchronously
    this.executeFlow(id, config).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Trigger flow execution error: ${errorMessage}`);
      
      // Update status on error
      const currentStatus = this.triggers.get(id);
      if (currentStatus) {
        currentStatus.error = errorMessage;
        currentStatus.completed = true;
        currentStatus.currentStep = 'failed';
        this.triggers.set(id, currentStatus);
      }
    });
    
    // Using Promise.resolve to make this async without await
    return Promise.resolve(status);
  }
  
  /**
   * Get the status of a trigger
   * @param id Trigger ID
   * @returns The trigger status or null if not found
   */
  public getTriggerStatus(id: string): TriggerStatus | null {
    return this.triggers.get(id) ?? null;
  }
  
  /**
   * Get all trigger statuses
   * @returns Array of all trigger statuses
   */
  public getAllTriggerStatuses(): TriggerStatus[] {
    return Array.from(this.triggers.values());
  }
  
  /**
   * Execute the entire trigger flow process
   * @param triggerId Trigger ID
   * @param config Trigger configuration
   */
  private async executeFlow(triggerId: string, config: TriggerConfig): Promise<void> {
    try {
      // Step 1: Record Video
      await this.recordVideo(triggerId, config);
      
      // Step 2: Upload Video to Google Drive
      await this.uploadToGoogleDrive(triggerId);
      
      // Step 3: Send SMS Notification
      await this.sendSmsNotification(triggerId, config);
      
      // Mark as completed
      const status = this.triggers.get(triggerId);
      if (status) {
        status.completed = true;
        status.currentStep = 'completed';
        this.triggers.set(triggerId, status);
        logger.info(`Trigger flow completed successfully: ${triggerId}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Trigger flow error: ${errorMessage}`);
      
      // Update status
      const status = this.triggers.get(triggerId);
      if (status) {
        status.completed = true;
        status.currentStep = 'failed';
        status.error = errorMessage;
        this.triggers.set(triggerId, status);
      }
      
      throw error;
    }
  }
  
  /**
   * Record a video
   * @param triggerId Trigger ID
   * @param config Trigger configuration
   */
  private async recordVideo(triggerId: string, config: TriggerConfig): Promise<void> {
    try {
      // Update status
      const status = this.triggers.get(triggerId);
      if (!status) {
        throw new Error(`Trigger ${triggerId} not found`);
      }
      
      status.currentStep = 'recording';
      this.triggers.set(triggerId, status);
      
      // Prepare video filename
      const timestamp = new Date().getTime();
      const videoFilename = config.videoFilename ?? `trigger_${timestamp}.h264`;
      
      // Start video capture
      const videoStatus = VideoService.startCapture({
        duration: config.videoDuration,
        filename: videoFilename,
      });
      
      // Update trigger status with video status
      status.videoStatus = videoStatus;
      this.triggers.set(triggerId, status);
      
      logger.info(`Started video recording for trigger ${triggerId}: ${videoFilename}`);
      
      // Wait for video recording to complete
      await this.waitForVideoCompletion(videoStatus.id);
      
      // Get updated video status
      const updatedVideoStatus = VideoService.getStatus(videoStatus.id);
      if (!updatedVideoStatus) {
        throw new Error(`Video status not found for ID: ${videoStatus.id}`);
      }
      
      // Check for errors in video recording
      if (updatedVideoStatus.error) {
        throw new Error(`Video recording failed: ${updatedVideoStatus.error}`);
      }
      
      // Update trigger status
      status.videoStatus = updatedVideoStatus;
      this.triggers.set(triggerId, status);
      
      logger.info(`Video recording completed for trigger ${triggerId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Video recording error: ${errorMessage}`);
      throw error;
    }
  }
  
  /**
   * Wait for video recording to complete
   * @param videoId Video ID to wait for
   */
  private async waitForVideoCompletion(videoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkInterval = 1000; // 1 second
      const maxWaitTime = 120000; // 2 minutes
      let elapsedTime = 0;
      
      const checkStatus = () => {
        const status = VideoService.getStatus(videoId);
        
        if (!status) {
          clearInterval(intervalId);
          reject(new Error(`Video status not found for ID: ${videoId}`));
          return;
        }
        
        if (status.completed) {
          clearInterval(intervalId);
          resolve();
          return;
        }
        
        elapsedTime += checkInterval;
        if (elapsedTime >= maxWaitTime) {
          clearInterval(intervalId);
          reject(new Error(`Timeout waiting for video recording to complete: ${videoId}`));
          return;
        }
      };
      
      const intervalId = setInterval(checkStatus, checkInterval);
    });
  }
  
  /**
   * Upload video to Google Drive
   * @param triggerId Trigger ID
   */
  private async uploadToGoogleDrive(triggerId: string): Promise<void> {
    try {
      // Update status
      const status = this.triggers.get(triggerId);
      if (!status) {
        throw new Error(`Trigger ${triggerId} not found`);
      }
      
      if (!status.videoStatus) {
        throw new Error(`No video status found for trigger ${triggerId}`);
      }
      
      status.currentStep = 'uploading';
      this.triggers.set(triggerId, status);
      
      // Check if file exists
      const videoPath = status.videoStatus.path;
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found at path: ${videoPath}`);
      }
      
      logger.info(`Uploading video to Google Drive for trigger ${triggerId}: ${videoPath}`);
      
      // Upload to Google Drive
      const fileData = await GoogleDriveService.uploadFile(videoPath);
      
      // Update trigger status with upload information
      status.uploadedFileId = fileData.id;
      status.uploadedFileLink = fileData.webViewLink;
      this.triggers.set(triggerId, status);
      
      logger.info(`Video upload completed for trigger ${triggerId}: ${fileData.webViewLink}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Google Drive upload error: ${errorMessage}`);
      throw error;
    }
  }
  
  /**
   * Ensure GSM module is initialized
   * @returns True if GSM module is initialized or initialization was successful
   */
  private async ensureGSMInitialized(): Promise<boolean> {
    if (this.gsmInitialized) {
      return true;
    }
    
    try {
      // Check if GSM modem is already initialized
      const status = GSMService.getStatus();
      if (status.initialized && status.modemId) {
        this.gsmInitialized = true;
        logger.info('GSM modem already initialized');
        return true;
      }
      
      // Initialize GSM modem
      logger.info('Initializing GSM modem...');
      const initResult = await GSMService.initialize();
      
      if (initResult) {
        this.gsmInitialized = true;
        logger.info('GSM modem initialized successfully');
        return true;
      } else {
        logger.err('Failed to initialize GSM modem');
        return false;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`GSM initialization error: ${errorMessage}`);
      return false;
    }
  }
  
  /**
   * Send SMS notification with the video link
   * @param triggerId Trigger ID
   * @param config Trigger configuration
   */
  private async sendSmsNotification(triggerId: string, config: TriggerConfig): Promise<void> {
    try {
      // Update status
      const status = this.triggers.get(triggerId);
      if (!status) {
        throw new Error(`Trigger ${triggerId} not found`);
      }
      
      if (!status.uploadedFileLink) {
        throw new Error(`No upload link found for trigger ${triggerId}`);
      }
      
      status.currentStep = 'notifying';
      this.triggers.set(triggerId, status);
      
      // Ensure GSM modem is initialized
      const gsmReady = await this.ensureGSMInitialized();
      if (!gsmReady) {
        throw new Error('GSM modem is not initialized. Cannot send SMS.');
      }
      
      // Prepare SMS message
      const defaultMessage = 'Alert: Motion detected. View recording at: ';
      const message = (config.customMessage ?? defaultMessage) + status.uploadedFileLink;
      
      logger.info(`Sending SMS notification for trigger ${triggerId} to ${config.phoneNumber}`);
      
      // Send SMS
      const smsResult = await GSMService.sendNewSMS(config.phoneNumber, message);
      
      // Update trigger status with SMS result
      status.smsStatus = smsResult;
      this.triggers.set(triggerId, status);
      
      if (smsResult) {
        logger.info(`SMS notification sent successfully for trigger ${triggerId}`);
      } else {
        logger.warn(`SMS notification failed for trigger ${triggerId}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`SMS notification error: ${errorMessage}`);
      throw error;
    }
  }
}

export default new TriggerService();