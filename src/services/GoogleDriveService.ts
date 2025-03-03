import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import logger from 'jet-logger';
import { getEnv } from '@src/util/env';

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
 * Service to handle Google Drive operations
 */
class GoogleDriveService {
  private driveClient: drive_v3.Drive | null = null;
  private jwtClient: JWT | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the Google Drive service
   */
  public constructor(
    private readonly keyFilePath: string = getEnv('GOOGLE_APPLICATION_CREDENTIALS', ''),
    private readonly scopes: string[] = ['https://www.googleapis.com/auth/drive'],
  ) {
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
   * Upload a file to Google Drive
   * @param filePath Path to the file to upload
   * @param options Additional options for the upload
   * @returns Information about the uploaded file including the webViewLink
   */
  public async uploadFile(
    filePath: string, 
    options: UploadOptions = {},
  ): Promise<DriveFileResponse> {
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
      
      // Determine mime type
      const mimeType = options.mimeType ?? this.getMimeType(filePath);
      
      // Prepare request body
      const requestBody: drive_v3.Schema$File = {
        name: fileName,
        mimeType: mimeType,
        // Make the file accessible to anyone with the link
        copyRequiresWriterPermission: false,
      };

      // If folder ID is provided, set parent folder
      if (options.folderID) {
        requestBody.parents = [options.folderID];
      }

      // Upload file
      const response = await this.driveClient.files.create({
        requestBody,
        media: {
          mimeType,
          body: fs.createReadStream(filePath),
        },
        fields: 'id, name, webViewLink, webContentLink',
      });

      // Make the file publicly accessible
      if (response.data.id) {
        await this.makeFilePublic(response.data.id);
      }

      logger.info(`File uploaded successfully: ${fileName}`);
      return response.data as DriveFileResponse;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err('Error uploading file: ' + errorMessage);
      throw error;
    }
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

    return mimeTypes[extension] || 'application/octet-stream';
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