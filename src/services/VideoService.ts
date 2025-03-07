/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import logger from 'jet-logger';
import { getEnv } from '@src/util/env';

// Convert exec to Promise-based
// eslint-disable-next-line n/no-deprecated-api
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

export interface VideoConfig {
  duration: number; // in milliseconds
  filename: string;
}

export interface VideoStatus {
  id: string;
  filename: string;
  duration: number;
  startTime: number;
  endTime: number | null;
  completed: boolean;
  error: string | null;
  path: string;
}

export interface StreamConfig {
  destination: string;
  timeout: number; // in seconds (default 5 minutes = 300)exists
  timeoutRemaining: number | null; // remaining seconds
}

export interface StreamStatus {
  active: boolean;
  destination: string | null;
  timeoutRemaining: number | null;
}

/**
 * Service to handle video capture using Python Picamera2
 */
class VideoService {
  private static VIDEO_DIRECTORY = getEnv('VIDEO_DIRECTORY', path.join(process.cwd(), 'videos'));
  private static PYTHON_SCRIPT = path.join(process.cwd(), 'python', 'video_handler.py');
  
  private videoProcesses: Map<string, VideoStatus> = new Map<string, VideoStatus>();
  private pythonProcess: ChildProcess | null = null;
  private initialized = false;
  private streamStatus: StreamStatus = {
    active: false,
    destination: null,
    timeoutRemaining: null
  };

  /**
   * Initialize the Video Capture service
   */
  public constructor() {
    logger.info(`Video Capture service created with directory: ${VideoService.VIDEO_DIRECTORY}`);
    // Ensure the video directory exists with proper permissions
    this.ensureVideoDirectory();
    // Initialize the Python process
    this.initializePythonProcess();
  }

  /**
   * Ensure the video directory exists with proper permissions
   */
  private async ensureVideoDirectory(): Promise<void> {
    try {
      // Check if directory exists
      try {
        await access(VideoService.VIDEO_DIRECTORY);
      } catch {
        // Create directory with proper permissions (0o755 = rwxr-xr-x)
        await mkdir(VideoService.VIDEO_DIRECTORY, { recursive: true, mode: 0o755 });
        logger.info(`Created video directory: ${VideoService.VIDEO_DIRECTORY}`);
      }

      // Ensure directory has correct permissions even if it already exists
      fs.chmodSync(VideoService.VIDEO_DIRECTORY, 0o755);

      logger.info(`Video directory ${VideoService.VIDEO_DIRECTORY} is writable`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to ensure video directory is writable: ${errorMessage}`);

      // Try to use the /tmp directory as a fallback
      VideoService.VIDEO_DIRECTORY = '/tmp/videos';
      logger.info(`Falling back to ${VideoService.VIDEO_DIRECTORY}`);

      // Create fallback directory
      try {
        await fs.promises.access(VideoService.VIDEO_DIRECTORY);
      } catch {
        await mkdir(VideoService.VIDEO_DIRECTORY, { recursive: true, mode: 0o777 });
      }

      // Ensure everyone can write to fallback directory
      fs.chmodSync(VideoService.VIDEO_DIRECTORY, 0o777);
    }
  }

  /**
   * Initialize the Python process for video handling
   */
  private initializePythonProcess(): void {
    try {
      // Check if the Python script exists
      if (!fs.existsSync(VideoService.PYTHON_SCRIPT)) {
        logger.err(`Python script not found at: ${VideoService.PYTHON_SCRIPT}`);
        throw new Error(`Python script not found at: ${VideoService.PYTHON_SCRIPT}`);
      }

      // Create directory for the script if it doesn't exist
      const scriptDir = path.dirname(VideoService.PYTHON_SCRIPT);
      if (!fs.existsSync(scriptDir)) {
        fs.mkdirSync(scriptDir, { recursive: true });
      }

      // Copy the script file to the destination
      const scriptContent = fs.readFileSync(path.join(__dirname, '../../python/video_handler.py'), 'utf8');
      fs.writeFileSync(VideoService.PYTHON_SCRIPT, scriptContent);
      fs.chmodSync(VideoService.PYTHON_SCRIPT, 0o755); // Make executable

      // Start the Python process in interactive mode
      this.pythonProcess = spawn('python3', [VideoService.PYTHON_SCRIPT, '--interactive']);
      
      // Handle process output
      this.pythonProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        try {
          // Try to parse JSON responses
          const response = JSON.parse(output);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (!response.success) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            logger.warn(`Python handler reported error: ${response.message}`);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            logger.info(`Python handler: ${response.message}`);
            
            // Update stream status if available
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (response.data?.streaming) {
              this.streamStatus = {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                active: response.data.streaming.active,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                destination: response.data.streaming.destination,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                timeoutRemaining: response.data.streaming.timeout_remaining,
              };
            }
          }
        } catch (e) {
          // Regular log output, not JSON
          logger.info(`Python: ${output}`);
        }
      });

      this.pythonProcess.stderr?.on('data', (data: Buffer) => {
        logger.warn(`Python error: ${data.toString().trim()}`);
      });

      this.pythonProcess.on('close', (code: number | null) => {
        logger.warn(`Python process exited with code ${code}`);
        this.initialized = false;
        this.pythonProcess = null;
        
        // Attempt to restart after a delay
        setTimeout(() => {
          if (!this.pythonProcess) {
            logger.info('Attempting to restart Python process...');
            this.initializePythonProcess();
          }
        }, 5000);
      });

      this.pythonProcess.on('error', (error: Error) => {
        logger.err(`Python process error: ${error.message}`);
        this.initialized = false;
      });

      this.initialized = true;
      logger.info('Python video handler initialized successfully');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to initialize Python process: ${errorMessage}`);
      this.initialized = false;
    }
  }

  /**
   * Send a command to the Python process and get the response
   */
  private async sendCommand(command: string): Promise<{ success: boolean; message?: string; data?: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess || !this.initialized) {
        // Try to reinitialize if needed
        if (!this.pythonProcess) {
          this.initializePythonProcess();
        }
        
        if (!this.initialized) {
          reject(new Error('Python process not initialized'));
          return;
        }
      }

      let response = '';
      const responseHandler = (data: Buffer) => {
        const output = data.toString().trim();
        response += output;
        
        try {
          // Check if we have a complete JSON response
          const result = JSON.parse(response);
          cleanup();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          resolve(result);
        } catch (e) {
          // Not a complete JSON response yet, continue collecting
        }
      };

      const errorHandler = (data: Buffer) => {
        logger.warn(`Python error during command: ${data.toString().trim()}`);
      };

      const closeHandler = (code: number | null) => {
        cleanup();
        reject(new Error(`Python process closed unexpectedly with code ${code}`));
      };

      const cleanup = () => {
        this.pythonProcess?.stdout?.removeListener('data', responseHandler);
        this.pythonProcess?.stderr?.removeListener('data', errorHandler);
        this.pythonProcess?.removeListener('close', closeHandler);
      };

      // Set up temporary listeners for this command
      if (this.pythonProcess?.stdout) {
        this.pythonProcess.stdout.on('data', responseHandler);
      }
      if (this.pythonProcess?.stderr) {
        this.pythonProcess.stderr.on('data', errorHandler);
      }
      if (this.pythonProcess) {
        this.pythonProcess.on('close', closeHandler);
      }

      // Send the command
      this.pythonProcess?.stdin?.write(command + '\n') ?? reject(new Error('Python process stdin is null'));
      
      // Set a timeout to prevent hanging
      setTimeout(() => {
        cleanup();
        reject(new Error('Command timeout'));
      }, 10000); // 10 second timeout
    });
  }

  /**
   * Start streaming to the specified destination
   * @param config Streaming configuration
   * @returns Success or failure
   */
  public async startStream(config: StreamConfig): Promise<boolean> {
    try {
      const command = `stream:destination=${config.destination},timeout=${config.timeout || 300}`;
      const response = await this.sendCommand(command);
      
      if (response.success) {
        this.streamStatus = {
          active: true,
          destination: config.destination,
          timeoutRemaining: config.timeout || 300
        };
      }
      
      return response.success;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Start stream error: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Stop the current stream
   * @returns Success or failure
   */
  public async stopStream(): Promise<boolean> {
    try {
      const response = await this.sendCommand('stop:target=stream');
      
      if (response.success) {
        this.streamStatus = {
          active: false, 
          destination: null,
          timeoutRemaining: null
        };
      }
      
      return response.success;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Stop stream error: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Get the current stream status
   * @returns Stream status information
   */
  public getStreamStatus(): StreamStatus {
    return this.streamStatus;
  }

  /**
   * Start video capture
   * @param config Video configuration
   * @returns Video status
   */
  public startCapture(config: VideoConfig): VideoStatus {
    // Validate and sanitize inputs
    const duration = Math.max(config.duration, 1000); // Minimum 1 second
    const timestamp = Date.now();
    const sanitizedFilename = this.sanitizeFilename(config.filename || `video_${timestamp}`);
    const filename = sanitizedFilename.endsWith('.mp4') || sanitizedFilename.endsWith('.h264') 
      ? sanitizedFilename 
      : `${sanitizedFilename}.h264`;
    const outputPath = path.join(VideoService.VIDEO_DIRECTORY, filename);

    // Create a unique ID for this capture
    const id = `capture_${timestamp}`;

    // Create the status object
    const status: VideoStatus = {
      id,
      filename,
      duration,
      startTime: timestamp,
      endTime: null,
      completed: false,
      error: null,
      path: outputPath,
    };

    // Store the status
    this.videoProcesses.set(id, status);

    // Start the recording process
    this.executeCapture(id, status);

    return status;
  }

  /**
   * Execute the video capture command
   * @param id Capture ID
   * @param status Capture status
   */
  private async executeCapture(id: string, status: VideoStatus): Promise<void> {
    try {
      const durationInSeconds = Math.ceil(status.duration / 1000);
      const command = `record:duration=${durationInSeconds},filename=${status.path}`;
      
      const response = await this.sendCommand(command);
      
      if (!response.success) {
        status.error = response.message ?? 'Unknown error starting capture';
        status.completed = true;
        status.endTime = Date.now();
        this.videoProcesses.set(id, status);
        logger.err(`Failed to start recording: ${status.error}`);
        return;
      }
      
      logger.info(`Recording started for ${id}: ${status.filename} for ${durationInSeconds} seconds`);
      
      // Wait for the recording to complete
      setTimeout(() => {
        // Update status on completion
        status.completed = true;
        status.endTime = Date.now();
        this.videoProcesses.set(id, status);
        logger.info(`Recording completed for ${id}: ${status.filename}`);
      }, status.duration + 2000); // Add a buffer of 2 seconds
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      status.error = errorMessage;
      status.completed = true;
      status.endTime = Date.now();
      this.videoProcesses.set(id, status);
      logger.err(`Video capture error: ${errorMessage}`);
    }
  }

  /**
   * Kill a running video capture process
   * @param id Capture ID
   * @returns true if process was killed
   */
  public async killProcess(id: string): Promise<boolean> {
    const status = this.videoProcesses.get(id);
    if (!status || status.completed) {
      return false;
    }
    
    try {
      // Send command to stop recording
      const response = await this.sendCommand('stop:target=record');
      
      // Update status
      status.completed = true;
      status.endTime = Date.now();
      this.videoProcesses.set(id, status);
      
      logger.info(`Killed recording process for ${id}`);
      return response.success;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to kill recording process: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Get the status of a video capture
   * @param id Capture ID
   * @returns Video status or null if not found
   */
  public getStatus(id: string): VideoStatus | null {
    return this.videoProcesses.get(id) ?? null;
  }

  /**
   * Get the status of all video captures
   * @returns Array of video statuses
   */
  public getAllStatuses(): VideoStatus[] {
    return Array.from(this.videoProcesses.values());
  }

  /**
   * Get a list of available video files
   */
  public async getVideoFiles(): Promise<string[]> {
    try {
      // Get list of files in the video directory
      const files = await fs.promises.readdir(VideoService.VIDEO_DIRECTORY);
      return files.filter(file => file.endsWith('.h264') || file.endsWith('.mp4'));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to read video directory: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Get detailed status from the Python process
   */
  public async getDetailedStatus(): Promise<unknown> {
    try {
      const response: { success: boolean; message?: string; data?: unknown } = await this.sendCommand('status');
      return response.data || {};
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to get detailed status: ${errorMessage}`);
      return {};
    }
  }

  /**
   * Clean up resources when shutting down
   */
  public async cleanup(): Promise<void> {
    try {
      if (this.pythonProcess) {
        // Try to stop all active operations
        await this.sendCommand('stop:target=all');
        
        // Give it a moment to clean up
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send exit command
        this.pythonProcess.stdin?.write('exit\n');
        
        // Wait a bit for clean exit
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Force kill if still running
        if (this.pythonProcess) {
          this.pythonProcess.kill();
          this.pythonProcess = null;
        }
      }
      
      logger.info('Video service cleaned up');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Error during cleanup: ${errorMessage}`);
      
      // Force kill if needed
      if (this.pythonProcess) {
        this.pythonProcess.kill('SIGKILL');
        this.pythonProcess = null;
      }
    }
  }

  /**
   * Sanitize a filename to ensure it's safe
   * @param filename Filename to sanitize
   * @returns Sanitized filename
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/_{2,}/g, '_');
  }
}

export default new VideoService();