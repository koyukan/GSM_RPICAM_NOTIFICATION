import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import logger from 'jet-logger';
import { getEnv } from '@src/util/env';
import { EventEmitter } from 'events';

/**
 * Interface for file upload options
 */
interface UploadOptions {
  mimeType?: string;
  folderID?: string;
  fileName?: string;
}

/**
 * Interface for file upload response
 */
interface DriveFileResponse {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
  [key: string]: unknown;
}

/**
 * Interface for service account credentials
 */
interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

/**
 * Interface for upload status
 */
export interface UploadStatus {
  fileId: string | null;
  fileName: string;
  filePath: string;
  startTime: number;
  endTime: number | null;
  bytesTotal: number;
  bytesUploaded: number;
  percentComplete: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'canceled';
  error: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
}

/**
 * Service to handle Google Drive operations with resumable uploads
 */
class GoogleDriveService extends EventEmitter {
  private driveClient: drive_v3.Drive | null = null;
  private jwtClient: JWT | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private activeUploads = new Map<string, UploadStatus>();
  
  // Size in bytes where we'll use resumable uploads (5MB)
  private RESUMABLE_THRESHOLD = 5 * 1024 * 1024;
  
  // Chunk size for uploads (1MB)
  private CHUNK_SIZE = 1024 * 1024;

  /**
   * Initialize the Google Drive service
   */
  public constructor(
    private readonly keyFilePath: string = getEnv('GOOGLE_APPLICATION_CREDENTIALS', ''),
    private readonly scopes: string[] = ['https://www.googleapis.com/auth/drive'],
  ) {
    super();
    logger.info('Google Drive service created - will initialize on first use');
  }

  /**
   * Initialize the Google Drive client with JWT authentication
   * This follows the recommended pattern from the googleapis documentation
   */
  private async initClient(): Promise<void> {
    // If already initialized or initializing, return the existing promise
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    // Set up the initialization promise
    this.initializationPromise = (async () => {
      try {
        logger.info('Initializing Google Drive client...');
        
        // Check if credentials file exists
        if (!fs.existsSync(this.keyFilePath)) {
          throw new Error(`Service account key file not found at: ${this.keyFilePath}`);
        }

        // Read and parse the service account key file
        const rawData = fs.readFileSync(this.keyFilePath, 'utf8');
        
        // Parse and validate credentials
        let credentials: ServiceAccountCredentials;
        try {
          const parsed = JSON.parse(rawData) as unknown;
          
          // Validate the parsed data
          if (typeof parsed !== 'object' || parsed === null) {
            throw new Error('Invalid credentials format: not an object');
          }
          
          const checkedCredentials = parsed as Record<string, unknown>;
          
          // Check required fields
          if (typeof checkedCredentials.client_email !== 'string') {
            throw new Error('Invalid credentials: missing or invalid client_email');
          }
          
          if (typeof checkedCredentials.private_key !== 'string') {
            throw new Error('Invalid credentials: missing or invalid private_key');
          }
          
          credentials = parsed as ServiceAccountCredentials;
        } catch (err) {
          throw new Error(`Failed to parse credentials file: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }

        logger.info('Creating JWT client...');
        
        // Create a JWT client DIRECTLY with the credentials we read
        // This bypasses all metadata server lookups
        this.jwtClient = new JWT({
          email: credentials.client_email,
          key: credentials.private_key,
          scopes: this.scopes,
        });

        logger.info('Authenticating with JWT client...');
        
        // Authorize the client
        await this.jwtClient.authorize();
        
        logger.info('Creating Drive client...');
        
        // Initialize the Drive API client with our authorized JWT client
        this.driveClient = google.drive({
          version: 'v3',
          auth: this.jwtClient,
        });

        this.isInitialized = true;
        logger.info('Google Drive client initialized successfully using service account');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.err('Error initializing Google Drive client: ' + errorMessage);
        // Reset initialization state so it can be tried again
        this.initializationPromise = null;
        throw error;
      }
    })();
    
    return this.initializationPromise;
  }

  /**
   * Start uploading a file to Google Drive
   * @param filePath Path to the file to upload
   * @param options Additional options for the upload
   * @returns Upload ID that can be used to check status
   */
  public async startUpload(
    filePath: string, 
    options: UploadOptions = {},
  ): Promise<string> {
    try {
      // Initialize if needed
      if (!this.isInitialized) {
        await this.initClient();
      }

      // Verify initialization succeeded
      if (!this.driveClient) {
        throw new Error('Google Drive client not initialized');
      }

      const fileName = options.fileName ?? path.basename(filePath);
      
      // Check if file exists and get its size
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at path: ${filePath}`);
      }
      
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      
      // Create upload ID
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Create initial status
      const status: UploadStatus = {
        fileId: null,
        fileName,
        filePath,
        startTime: Date.now(),
        endTime: null,
        bytesTotal: fileSize,
        bytesUploaded: 0,
        percentComplete: 0,
        status: 'pending',
        error: null,
        webViewLink: null,
        webContentLink: null,
      };
      
      this.activeUploads.set(uploadId, status);
      
      // Start upload in background
      this.processUpload(uploadId, options).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.err(`Background upload failed for ${uploadId}: ${errorMessage}`);
        
        // Update status on error
        const uploadStatus = this.activeUploads.get(uploadId);
        if (uploadStatus) {
          uploadStatus.status = 'failed';
          uploadStatus.error = errorMessage;
          uploadStatus.endTime = Date.now();
          this.activeUploads.set(uploadId, uploadStatus);
          
          // Emit error event
          this.emit('upload-error', uploadId, errorMessage);
        }
      });
      
      return uploadId;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error starting upload: ' + errorMessage);
      throw error;
    }
  }

  /**
   * Process the upload in the background
   * @param uploadId The upload ID
   * @param options Upload options
   */
  private async processUpload(uploadId: string, options: UploadOptions): Promise<void> {
    try {
      const status = this.activeUploads.get(uploadId);
      if (!status) {
        throw new Error(`Upload ${uploadId} not found`);
      }
      
      // Update status to uploading
      status.status = 'uploading';
      this.activeUploads.set(uploadId, status);
      this.emit('upload-status-change', uploadId, { ...status });
      
      // Determine if we should use resumable upload
      const useResumable = status.bytesTotal > this.RESUMABLE_THRESHOLD;
      
      if (useResumable) {
        await this.processResumableUpload(uploadId, options);
      } else {
        await this.processSimpleUpload(uploadId, options);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Upload processing error for ${uploadId}: ${errorMessage}`);
      
      // Update status on error
      const status = this.activeUploads.get(uploadId);
      if (status) {
        status.status = 'failed';
        status.error = errorMessage;
        status.endTime = Date.now();
        this.activeUploads.set(uploadId, status);
        
        // Emit error event
        this.emit('upload-error', uploadId, errorMessage);
      }
      
      throw error;
    }
  }

  /**
   * Process a simple (non-resumable) upload
   * @param uploadId The upload ID
   * @param options Upload options
   */
  private async processSimpleUpload(uploadId: string, options: UploadOptions): Promise<void> {
    const status = this.activeUploads.get(uploadId);
    if (!status) {
      throw new Error(`Upload ${uploadId} not found`);
    }
    
    // Determine mime type
    const mimeType = options.mimeType ?? this.getMimeType(status.filePath);
    
    // Prepare request body
    const requestBody: drive_v3.Schema$File = {
      name: status.fileName,
      mimeType,
      // Make the file accessible to anyone with the link
      copyRequiresWriterPermission: false,
    };

    // If folder ID is provided, set parent folder
    if (options.folderID) {
      requestBody.parents = [options.folderID];
    }

    // Upload file
    const response = await this.driveClient!.files.create({
      requestBody,
      media: {
        mimeType,
        body: fs.createReadStream(status.filePath),
      },
      fields: 'id, name, webViewLink, webContentLink',
    });
    
    // Make the file publicly accessible
    if (response.data.id) {
      await this.makeFilePublic(response.data.id);
    }
    
    // Update status
    status.fileId = response.data.id ?? null;
    status.webViewLink = response.data.webViewLink ?? null;
    status.webContentLink = response.data.webContentLink ?? null;
    status.bytesUploaded = status.bytesTotal;
    status.percentComplete = 100;
    status.status = 'completed';
    status.endTime = Date.now();
    
    this.activeUploads.set(uploadId, status);
    this.emit('upload-complete', uploadId, { ...status });
    
    logger.info(`Simple upload completed for ${uploadId}: ${status.fileName}`);
  }

  /**
   * Process a resumable upload with chunking
   * @param uploadId The upload ID
   * @param options Upload options
   */
  private async processResumableUpload(uploadId: string, options: UploadOptions = {}): Promise<void> {
    const status = this.activeUploads.get(uploadId);
    if (!status) {
      throw new Error(`Upload ${uploadId} not found`);
    }
    
    // Determine mime type
    const mimeType = options.mimeType ?? this.getMimeType(status.filePath);
    
    // Prepare request body
    const requestBody: drive_v3.Schema$File = {
      name: status.fileName,
      mimeType,
      // Make the file accessible to anyone with the link
      copyRequiresWriterPermission: false,
    };

    // If folder ID is provided, set parent folder
    if (options.folderID) {
      requestBody.parents = [options.folderID];
    }
    
    try {
      // Import axios dynamically
      const axios = (await import('axios')).default;
      
      logger.info(`Starting resumable upload for ${uploadId}: ${status.fileName}`);
      
      if (!this.driveClient) {
        throw new Error('Google Drive client not initialized');
      }

      // Step 1: Create a direct resumable session URL using axios
      
      // Get the base URL from the discovery document
      const baseUrl = 'https://www.googleapis.com/upload/drive/v3/files';
      
      // Get an OAuth2 token
      const credentials = await this.jwtClient!.authorize();
      const accessToken = credentials.access_token;
      
      if (!accessToken) {
        throw new Error('Failed to obtain access token');
      }
      
      logger.info('Initiating resumable upload session...');
      
      // Make the initial request to get the resumable session URI
      const sessionInitResponse = await axios({
        method: 'POST',
        url: `${baseUrl}?uploadType=resumable`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': status.bytesTotal
        },
        data: requestBody
      });
      
      // Extract the location header (contains the resumable session URI)
      const location = typeof sessionInitResponse.headers?.location === 'string' ? sessionInitResponse.headers.location : null;
      if (!location) {
        throw new Error('Resumable upload URL not found in response headers');
      }
      
      logger.info(`Got resumable upload URL: ${location}`);
      
      // Now we can start uploading chunks to the resumable session URL
      let bytesUploaded = 0;
      const fileSize = status.bytesTotal;
      
      // Update status to uploading
      status.status = 'uploading';
      this.activeUploads.set(uploadId, status);
      this.emit('upload-status-change', uploadId, { ...status });
      
      // Read the file as a stream and upload in chunks
      const fileStream = fs.createReadStream(status.filePath, { 
        highWaterMark: this.CHUNK_SIZE, // Use our chunk size as the buffer size
      });
      
      // Process the stream chunk by chunk
      for await (const chunk of fileStream) {
        // Check if upload was canceled
        const currentStatus = this.activeUploads.get(uploadId);
        if (!currentStatus || currentStatus.status === 'canceled') {
          throw new Error('Upload canceled');
        }
        
        // Get the buffer from the chunk
        const buffer = Buffer.from(chunk as Buffer);
        const chunkSize = buffer.length;
        const endByte = bytesUploaded + chunkSize - 1;
        
        const contentRange = `bytes ${bytesUploaded}-${endByte}/${fileSize}`;
        logger.info(`Uploading chunk: ${contentRange}`);
        
        try {
          // Use axios for the upload
          const response = await axios({
            url: location,
            method: 'PUT',
            headers: {
              'Content-Range': contentRange,
              'Content-Length': chunkSize.toString()
            },
            data: buffer,
            validateStatus: (status) => {
              // Accept 200, 201 (success) and 308 (resume incomplete)
              return (status >= 200 && status < 300) || status === 308;
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });
          
          // Handle the response
          if (response.status === 200 || response.status === 201) {
            // Upload complete
            logger.info('Upload completed successfully');
            const responseData = response.data as drive_v3.Schema$File;
            status.fileId = responseData.id ?? null;
            
            // Google Drive doesn't always return these links in the final response
            // We'll check for them and query for them if missing
            status.webViewLink = responseData.webViewLink ?? null;
            status.webContentLink = responseData.webContentLink ?? null;
            
            // Mark as complete
            bytesUploaded = fileSize;
            status.bytesUploaded = fileSize;
            status.percentComplete = 100;
          } else if (response.status === 308) {
            // Resume incomplete - get the range from the response
            const range: string | undefined = response.headers.range as string | undefined;
            if (range) {
              // Range comes back as 'bytes=0-X'
              const regex = /bytes=0-(\d+)/;
              const match = regex.exec(range);
              if (match?.[1]) {
                const newBytesUploaded = parseInt(match[1], 10) + 1;
                logger.info(`Server confirmed ${newBytesUploaded} bytes received. Continuing upload...`);
                bytesUploaded = newBytesUploaded;
                
                // Update progress in status
                status.bytesUploaded = bytesUploaded;
                status.percentComplete = Math.round((bytesUploaded / fileSize) * 100);
                this.activeUploads.set(uploadId, status);
                
                // Emit progress event
                this.emit('upload-progress', uploadId, { ...status });
              } else {
                // If we can't parse the range, increment by our chunk size
                bytesUploaded += chunkSize;
                logger.info(`Couldn't parse range header. Assuming ${bytesUploaded} bytes uploaded.`);
                
                // Update progress in status
                status.bytesUploaded = bytesUploaded;
                status.percentComplete = Math.round((bytesUploaded / fileSize) * 100);
                this.activeUploads.set(uploadId, status);
                
                // Emit progress event
                this.emit('upload-progress', uploadId, { ...status });
              }
            } else {
              // If no range header, just move to the next chunk
              bytesUploaded += chunkSize;
              logger.info(`No range header received. Assuming ${bytesUploaded} bytes uploaded.`);
              
              // Update progress in status
              status.bytesUploaded = bytesUploaded;
              status.percentComplete = Math.round((bytesUploaded / fileSize) * 100);
              this.activeUploads.set(uploadId, status);
              
              // Emit progress event
              this.emit('upload-progress', uploadId, { ...status });
            }
          }
        } catch (error: unknown) {
          // Handle errors
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Special handling for 404 errors - session expired
          if (axios.isAxiosError(error) && error.response && error.response.status === 404) {
            logger.warn(`Upload session expired. Restarting the upload process.`);
            // We need to start over with a new session
            return await this.processResumableUpload(uploadId, options);
          }
          
          // For other errors, throw and let the caller handle it
          logger.err(`Chunk upload error: ${errorMessage}`);
          throw error;
        }
      }
      
      // If we didn't get file links from the upload response, query for them
      if (!status.webViewLink || !status.webContentLink) {
        await this.fetchFileLinksByFileId(status);
      }
      
      // Make the file publicly accessible
      if (status.fileId) {
        logger.info(`Making file ${status.fileId} publicly accessible`);
        await this.makeFilePublic(status.fileId);
        
        // If we still don't have links, try one more time after making public
        if (!status.webViewLink || !status.webContentLink) {
          await this.fetchFileLinksByFileId(status);
        }
      }
      
      // Update status to completed
      status.status = 'completed';
      status.endTime = Date.now();
      
      this.activeUploads.set(uploadId, status);
      this.emit('upload-complete', uploadId, { ...status });
      
      logger.info(`Resumable upload completed for ${uploadId}: ${status.fileName}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Resumable upload error for ${uploadId}: ${errorMessage}`);
      
      // Update status
      status.status = 'failed';
      status.error = errorMessage;
      status.endTime = Date.now();
      
      this.activeUploads.set(uploadId, status);
      this.emit('upload-error', uploadId, errorMessage);
      
      throw error;
    }
  }

  /**
   * Fetch file links by fileId when they weren't provided in the upload response
   * @param status Upload status with fileId
   */
  private async fetchFileLinksByFileId(status: UploadStatus): Promise<void> {
    if (!status.fileId || !this.driveClient) {
      return;
    }
    
    try {
      logger.info(`Fetching file links for fileId: ${status.fileId}`);
      
      const fileInfo = await this.driveClient.files.get({
        fileId: status.fileId,
        fields: 'id,name,webViewLink,webContentLink'
      });
      
      if (fileInfo.data) {
        status.webViewLink = fileInfo.data.webViewLink ?? status.webViewLink;
        status.webContentLink = fileInfo.data.webContentLink ?? status.webContentLink;
        
        logger.info(`Retrieved links for ${status.fileId}:`);
        logger.info(`- Web View Link: ${status.webViewLink}`);
        logger.info(`- Web Content Link: ${status.webContentLink}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Failed to fetch file links for ${status.fileId}: ${errorMessage}`);
      // Don't throw, continue without links
    }
  }

  /**
   * Cancel an ongoing upload
   * @param uploadId ID of the upload to cancel
   * @returns true if canceled, false if not found or already completed
   */
  public cancelUpload(uploadId: string): boolean {
    const status = this.activeUploads.get(uploadId);
    if (!status || status.status === 'completed' || status.status === 'failed') {
      return false;
    }
    
    status.status = 'canceled';
    status.endTime = Date.now();
    this.activeUploads.set(uploadId, status);
    
    logger.info(`Upload ${uploadId} canceled`);
    this.emit('upload-canceled', uploadId, { ...status });
    
    return true;
  }

  /**
   * Get the status of an upload
   * @param uploadId Upload ID
   * @returns Upload status or null if not found
   */
  public getUploadStatus(uploadId: string): UploadStatus | null {
    const status = this.activeUploads.get(uploadId);
    return status ? { ...status } : null;
  }

  /**
   * Get the status of all active uploads
   * @returns Array of upload statuses
   */
  public getAllUploadStatuses(): UploadStatus[] {
    return Array.from(this.activeUploads.values()).map(status => ({ ...status }));
  }

  /**
   * Make a file publicly accessible via link
   * @param fileId ID of the file to make public
   */
  public async makeFilePublic(fileId: string): Promise<void> {
    try {
      if (!this.driveClient) {
        throw new Error('Google Drive client not initialized');
      }

      await this.driveClient.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      logger.info(`File ${fileId} made public`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error making file public: ' + errorMessage);
      throw error;
    }
  }

  /**
   * Upload a file to Google Drive (legacy method)
   * This is maintained for backward compatibility
   * @param filePath Path to the file to upload
   * @param options Additional options for the upload
   * @returns Information about the uploaded file including the webViewLink
   */
  public async uploadFile(
    filePath: string, 
    options: UploadOptions = {},
  ): Promise<DriveFileResponse> {
    try {
      // Start upload
      const uploadId = await this.startUpload(filePath, options);
      
      // Wait for upload to complete
      return await new Promise<DriveFileResponse>((resolve, reject) => {
        // Set timeout for long-running uploads
        const timeout = setTimeout(() => {
          const status = this.getUploadStatus(uploadId);
          if (status && status.status === 'uploading') {
            // Don't reject, just return what we have so far
            logger.warn(`Upload ${uploadId} is taking longer than expected. Returning in-progress upload info.`);
            
            // Return partial info
            resolve({
              id: status.fileId ?? 'in-progress',
              name: status.fileName,
              uploadId: uploadId, // Special field to indicate this is still in progress
              status: status.status,
              percentComplete: status.percentComplete,
            });
          }
        }, 60000); // 60 seconds timeout
        
        // Set up event listener for completed upload
        const completeListener = (id: string, uploadStatus: UploadStatus) => {
          if (id === uploadId) {
            clearTimeout(timeout);
            this.removeListener('upload-complete', completeListener);
            this.removeListener('upload-error', errorListener);
            
            // Convert to legacy response format
            const response: DriveFileResponse = {
              id: uploadStatus.fileId ?? '',
              name: uploadStatus.fileName,
              webViewLink: uploadStatus.webViewLink ?? undefined,
              webContentLink: uploadStatus.webContentLink ?? undefined,
            };
            
            resolve(response);
          }
        };
        
        // Set up event listener for upload errors
        const errorListener = (id: string, error: string) => {
          if (id === uploadId) {
            clearTimeout(timeout);
            this.removeListener('upload-complete', completeListener);
            this.removeListener('upload-error', errorListener);
            
            reject(new Error(error));
          }
        };
        
        // Register event listeners
        this.on('upload-complete', completeListener);
        this.on('upload-error', errorListener);
        
        // Also poll for completion in case we're restarting and the event has already fired
        const checkInterval = setInterval(() => {
          const status = this.getUploadStatus(uploadId);
          if (!status) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            this.removeListener('upload-complete', completeListener);
            this.removeListener('upload-error', errorListener);
            reject(new Error(`Upload ${uploadId} not found`));
            return;
          }
          
          if (status.status === 'completed') {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            this.removeListener('upload-complete', completeListener);
            this.removeListener('upload-error', errorListener);
            
            // Convert to legacy response format
            const response: DriveFileResponse = {
              id: status.fileId ?? '',
              name: status.fileName,
              webViewLink: status.webViewLink ?? undefined,
              webContentLink: status.webContentLink ?? undefined,
            };
            
            resolve(response);
          } else if (status.status === 'failed') {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            this.removeListener('upload-complete', completeListener);
            this.removeListener('upload-error', errorListener);
            reject(new Error(status.error ?? 'Upload failed'));
          }
        }, 1000);
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error uploading file: ' + errorMessage);
      throw error;
    }
  }

  /**
   * Get the MIME type based on file extension
   * @param filePath Path to the file
   * @returns MIME type string
   */
  private getMimeType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    
    // Common MIME types map
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.mkv': 'video/x-matroska',
      '.h264': 'video/h264',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    return mimeTypes[extension] ?? 'application/octet-stream';
  }
  
  /**
   * Generate a direct download link for a file
   * @param webContentLink The web content link from Google Drive
   * @returns Direct download link
   */
  public getDirectDownloadLink(webContentLink: string): string {
    if (!webContentLink) return '';
    // Convert the "view" link to a direct download link
    return webContentLink.replace('&export=download', '');
  }
}

export default new GoogleDriveService();