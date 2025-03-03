import { google, drive_v3 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import logger from 'jet-logger';

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
 * Service to handle Google Drive operations
 */
class GoogleDriveService {
  private driveClient: drive_v3.Drive | null = null;
  private auth: GoogleAuth | null = null;

  /**
   * Initialize the Google Drive service
   */
  public constructor(
    private readonly keyFilePath: string = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '',
    private readonly scopes: string[] = ['https://www.googleapis.com/auth/drive'],
  ) {
    this.initClient().catch(err => {
      logger.err('Failed to initialize Google Drive client:', err);
    });
  }

  /**
   * Initialize the Google Drive client
   */
  private async initClient(): Promise<void> {
    try {
      this.auth = new GoogleAuth({
        keyFile: this.keyFilePath,
        scopes: this.scopes,
      });

      const authClient = await this.auth.getClient();
      this.driveClient = google.drive({
        version: 'v3',
        auth: authClient,
      });

      logger.info('Google Drive client initialized successfully');
    } catch (error) {
      logger.err('Error initializing Google Drive client:', error);
      throw error;
    }
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
      // Make sure the client is initialized
      if (!this.driveClient) {
        await this.initClient();
        if (!this.driveClient) {
          throw new Error('Failed to initialize Google Drive client');
        }
      }

      const fileName = options.fileName ?? path.basename(filePath);
      
      // Determine mime type
      const mimeType = options.mimeType ?? this.getMimeType(filePath);
      
      // Prepare request body
      const requestBody: drive_v3.Schema$File = {
        name: fileName,
        mimeType: mimeType,
        // Make the file accessible to anyone with the link
        'copyRequiresWriterPermission': false,
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
    } catch (error) {
      logger.err(`Error uploading file: ${error}`);
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
    } catch (error) {
      logger.err(`Error making file public: ${error}`);
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