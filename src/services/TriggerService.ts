// src/services/TriggerService.ts
import logger from 'jet-logger';
import VideoService, { VideoStatus } from '@src/services/VideoService';
import GoogleDriveService, { UploadStatus } from '@src/services/GoogleDriveService';
import GSMService, { GPSLocation } from '@src/services/GSMService';
import fs from 'fs';

/**
 * Interface for trigger configuration
 */
export interface TriggerConfig {
  videoDuration: number;
  phoneNumber: string;
  customMessage?: string;
  videoFilename?: string;
  sendEarlyNotification?: boolean; // Option to send SMS before upload completes
  includeLocation?: boolean; // Option to include location in SMS
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
  uploadId?: string;
  uploadStatus?: UploadStatus;
  uploadedFileId?: string;
  uploadedFileLink?: string;
  smsStatus?: boolean;
  earlyNotificationSent?: boolean;
  locationData?: GPSLocation; // Store location data with the trigger
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
   * Constructor with Google Drive event listeners
   */
  constructor() {
    // Set up event listeners for Google Drive uploads
    GoogleDriveService.on('upload-progress', this.handleUploadProgress.bind(this));
    GoogleDriveService.on('upload-complete', this.handleUploadComplete.bind(this));
    GoogleDriveService.on('upload-error', this.handleUploadError.bind(this));
  }
  
  /**
   * Format GPS location into a Google Maps link
   * @param location GPS location data
   * @returns Formatted location string with Google Maps link
   */
  private formatLocationForSMS(location: GPSLocation | undefined): string {
    if (!location || !location.available || 
        !location.latitude || !location.longitude || 
        location.latitude === '--' || location.longitude === '--') {
      return 'Location: Not available';
    }
    
    try {
      // Parse latitude and longitude
      const lat = parseFloat(location.latitude);
      const lng = parseFloat(location.longitude);
      
      // Check if parsing was successful and values are valid
      if (isNaN(lat) || isNaN(lng)) {
        return 'Location: Invalid coordinates';
      }
      
      // Create Google Maps link using the recommended format
      const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      return `Location: ${mapsLink}`;
    } catch (error) {
      logger.err(`Error formatting location: ${error}`);
      return 'Location: Error processing coordinates';
    }
  }
  
  /**
   * Handle upload progress event
   */
  private handleUploadProgress(uploadId: string, uploadStatus: UploadStatus): void {
    // Find the trigger that owns this upload
    for (const [triggerId, triggerStatus] of this.triggers.entries()) {
      if (triggerStatus.uploadId === uploadId) {
        // Update the trigger with upload status
        triggerStatus.uploadStatus = uploadStatus;
        this.triggers.set(triggerId, triggerStatus);
        
        // Log progress periodically (avoid excessive logging)
        if (uploadStatus.percentComplete % 10 === 0) {
          logger.info(`Upload progress for trigger ${triggerId}: ${uploadStatus.percentComplete}%`);
        }
        
        // Send early notification when upload reaches 10% if configured
        if (uploadStatus.percentComplete >= 10 && 
            !triggerStatus.earlyNotificationSent && 
            triggerStatus.smsStatus !== true) {
          this.sendEarlyNotification(triggerId).catch((err: unknown) => {
            logger.err(`Failed to send early notification for trigger ${triggerId}: ${(err as Error).message}`);
          });
        }
        
        break;
      }
    }
  }
  
  /**
   * Handle upload complete event
   */
  private handleUploadComplete(uploadId: string, uploadStatus: UploadStatus): void {
    // Find the trigger that owns this upload
    for (const [triggerId, triggerStatus] of this.triggers.entries()) {
      if (triggerStatus.uploadId === uploadId) {
        // Update the trigger with completed upload status
        triggerStatus.uploadStatus = uploadStatus;
        triggerStatus.uploadedFileId = uploadStatus.fileId ?? undefined;
        triggerStatus.uploadedFileLink = uploadStatus.webViewLink ?? undefined;
        
        // If early notification was not sent, send final notification
        if (!triggerStatus.earlyNotificationSent) {
          this.sendSmsNotification(triggerId, {
            phoneNumber: '', // Will be retrieved from existing config
            videoDuration: 0, // Not needed at this point
          }).catch((err: unknown) => {
            logger.err(`Failed to send SMS notification for trigger ${triggerId}: ${(err as Error).message}`);
          });
        }
        
        // Update step to completed if it was the last step
        if (triggerStatus.currentStep === 'uploading') {
          triggerStatus.currentStep = 'completed';
          triggerStatus.completed = true;
          logger.info(`Trigger flow completed successfully: ${triggerId}`);
        }
        
        this.triggers.set(triggerId, triggerStatus);
        break;
      }
    }
  }
  
  /**
   * Handle upload error event
   */
  private handleUploadError(uploadId: string, error: string): void {
    // Find the trigger that owns this upload
    for (const [triggerId, triggerStatus] of this.triggers.entries()) {
      if (triggerStatus.uploadId === uploadId) {
        // Update the trigger with error
        triggerStatus.error = `Upload error: ${error}`;
        
        // If early notification was not sent, send error notification
        if (!triggerStatus.earlyNotificationSent) {
          this.sendErrorNotification(triggerId, error).catch((err: unknown) => {
            logger.err(`Failed to send error notification for trigger ${triggerId}: ${(err as Error).message}`);
          });
        }
        
        // Mark as failed
        triggerStatus.currentStep = 'failed';
        triggerStatus.completed = true;
        
        this.triggers.set(triggerId, triggerStatus);
        logger.err(`Trigger ${triggerId} failed due to upload error: ${error}`);
        break;
      }
    }
  }
  
  /**
   * Start the trigger flow process
   * @param config Configuration for the trigger
   * @returns The trigger status
   */
  public async startTrigger(config: TriggerConfig): Promise<TriggerStatus> {
    const id = `trigger_${Date.now()}`;
    const timestamp = Date.now();
    
    // Initialize trigger status
    const status: TriggerStatus = {
      id,
      createdAt: timestamp,
      completed: false,
      currentStep: 'initialized',
      earlyNotificationSent: false,
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
   * Execute the trigger flow process
   * @param triggerId Trigger ID
   * @param config Trigger configuration
   */
  private async executeFlow(triggerId: string, config: TriggerConfig): Promise<void> {
    try {
      // Initialize GSM to get location data early
      await this.ensureGSMInitialized();
      
      // Fetch location and store it with the trigger
      await this.updateLocationData(triggerId);
      
      // Step 1: Record Video
      await this.recordVideo(triggerId, config);
      
      // Step 2: Start Upload to Google Drive
      // This now starts the upload but doesn't wait for completion
      await this.startUploadToGoogleDrive(triggerId);
      
      // Step 3: Send SMS Notification if early notification is enabled
      if (config.sendEarlyNotification) {
        await this.sendEarlyNotification(triggerId);
      }
      
      // The rest of the process continues asynchronously via event handlers
      logger.info(`Trigger flow initial steps completed for ${triggerId}, continuing in background`);
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
   * Update location data for a trigger
   * @param triggerId Trigger ID
   */
  private async updateLocationData(triggerId: string): Promise<void> {
    try {
      const status = this.triggers.get(triggerId);
      if (!status) {
        throw new Error(`Trigger ${triggerId} not found`);
      }
      
      // Get current location from GSM module
      const location = await GSMService.getLocation();
      
      // Update trigger status with location data
      status.locationData = location;
      this.triggers.set(triggerId, status);
      
      if (location.available) {
        logger.info(`Location data updated for trigger ${triggerId}: ${location.latitude}, ${location.longitude}`);
      } else {
        logger.info(`No location data available for trigger ${triggerId}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Failed to update location data: ${errorMessage}`);
      // Don't throw error, just continue without location data
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
   * Start uploading video to Google Drive
   * @param triggerId Trigger ID
   */
  private async startUploadToGoogleDrive(triggerId: string): Promise<void> {
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
      
      logger.info(`Starting video upload to Google Drive for trigger ${triggerId}: ${videoPath}`);
      
      // Start upload (non-blocking)
      const uploadId = await GoogleDriveService.startUpload(videoPath);
      
      // Store the upload ID in trigger status
      status.uploadId = uploadId;
      
      // Get initial upload status
      const uploadStatus = GoogleDriveService.getUploadStatus(uploadId);
      if (uploadStatus) {
        status.uploadStatus = uploadStatus;
      }
      
      this.triggers.set(triggerId, status);
      
      logger.info(`Upload started for trigger ${triggerId} with upload ID: ${uploadId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Google Drive upload error: ${errorMessage}`);
      throw error;
    }
  }
  
  /**
   * Send early notification with preliminary link
   * @param triggerId Trigger ID
   */
  private async sendEarlyNotification(triggerId: string): Promise<void> {
    try {
      const status = this.triggers.get(triggerId);
      if (!status) {
        throw new Error(`Trigger ${triggerId} not found`);
      }
      
      // Skip if already sent
      if (status.earlyNotificationSent) {
        return;
      }
      
      // Update location data before sending notification
      await this.updateLocationData(triggerId);
      
      logger.info(`Sending early notification for trigger ${triggerId}`);
      
      // Update status
      status.currentStep = 'notifying';
      this.triggers.set(triggerId, status);
      
      // Get phone number from previous executions saved in status
      const config = this.extractConfigFromStatus(status);
      if (!config.phoneNumber) {
        throw new Error(`No phone number found for trigger ${triggerId}`);
      }
      
      // Ensure GSM modem is initialized
      const gsmReady = await this.ensureGSMInitialized();
      if (!gsmReady) {
        throw new Error('GSM modem is not initialized. Cannot send SMS.');
      }
      
      // Format location data for SMS
      const locationText = this.formatLocationForSMS(status.locationData);
      
      // Prepare SMS message
      const uploadingMessage = "Alert: Motion detected. Video is being uploaded, link will be active soon.\n\n" + locationText;
      
      // Send SMS
      const smsResult = await GSMService.sendNewSMS(config.phoneNumber, uploadingMessage);
      
      // Update trigger status
      status.earlyNotificationSent = true;
      status.smsStatus = smsResult;
      this.triggers.set(triggerId, status);
      
      if (smsResult) {
        logger.info(`Early notification sent successfully for trigger ${triggerId}`);
      } else {
        logger.warn(`Early notification failed for trigger ${triggerId}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Early notification error: ${errorMessage}`);
      throw error;
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
      
      // Skip if early notification was already sent
      if (status.earlyNotificationSent) {
        return;
      }
      
      if (!status.uploadedFileLink) {
        throw new Error(`No upload link found for trigger ${triggerId}`);
      }
      
      // Update location data before sending notification
      await this.updateLocationData(triggerId);
      
      status.currentStep = 'notifying';
      this.triggers.set(triggerId, status);
      
      // If config doesn't have phone number, extract from status
      if (!config.phoneNumber) {
        const extractedConfig = this.extractConfigFromStatus(status);
        config.phoneNumber = extractedConfig.phoneNumber;
      }
      
      if (!config.phoneNumber) {
        throw new Error(`No phone number found for trigger ${triggerId}`);
      }
      
      // Ensure GSM modem is initialized
      const gsmReady = await this.ensureGSMInitialized();
      if (!gsmReady) {
        throw new Error('GSM modem is not initialized. Cannot send SMS.');
      }
      
      // Format location data for SMS
      const locationText = this.formatLocationForSMS(status.locationData);
      
      // Prepare SMS message
      const defaultMessage = 'Alert: Motion detected. View recording at: ';
      const message = (config.customMessage ?? defaultMessage) + 
                     status.uploadedFileLink + 
                     "\n\n" + locationText;
      
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
  
  /**
   * Send error notification
   * @param triggerId Trigger ID
   * @param errorMessage Error message
   */
  private async sendErrorNotification(triggerId: string, errorMessage: string): Promise<void> {
    try {
      // Get trigger status
      const status = this.triggers.get(triggerId);
      if (!status) {
        throw new Error(`Trigger ${triggerId} not found`);
      }
      
      // Update location data before sending notification
      await this.updateLocationData(triggerId);
      
      // Extract config from status
      const config = this.extractConfigFromStatus(status);
      if (!config.phoneNumber) {
        throw new Error(`No phone number found for trigger ${triggerId}`);
      }
      
      // Ensure GSM modem is initialized
      const gsmReady = await this.ensureGSMInitialized();
      if (!gsmReady) {
        throw new Error('GSM modem is not initialized. Cannot send SMS.');
      }
      
      // Format location data for SMS
      const locationText = this.formatLocationForSMS(status.locationData);
      
      // Prepare error message
      const message = `Alert: Motion was detected but an error occurred while processing the video: ${errorMessage}\n\n${locationText}`;
      
      // Send SMS
      const smsResult = await GSMService.sendNewSMS(config.phoneNumber, message);
      
      // Update trigger status
      status.smsStatus = smsResult;
      status.earlyNotificationSent = true;
      this.triggers.set(triggerId, status);
      
      if (smsResult) {
        logger.info(`Error notification sent successfully for trigger ${triggerId}`);
      } else {
        logger.warn(`Error notification failed for trigger ${triggerId}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Error notification error: ${errorMessage}`);
      throw error;
    }
  }
  
  /**
   * Extract config from status (for when we don't have the original config)
   * @param status Trigger status
   * @returns Partial trigger config
   */
  private extractConfigFromStatus(status: TriggerStatus): TriggerConfig {
    // This function extracts necessary configuration from a status object
    // This is used when we need to perform actions but don't have the original config
    
    // Here we rely on data that was stored during the initial trigger
    return {
      phoneNumber: '', // Must be filled in by the caller
      videoDuration: status.videoStatus?.duration ?? 10000,
      includeLocation: true, // Always include location when available
    };
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
}

export default new TriggerService();