import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import logger from 'jet-logger';
import { getEnv } from '@src/util/env';

// Convert exec to Promise-based
const execAsync = promisify(exec);

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

/**
 * Service to handle video capture using rpicam-vid
 */
class VideoService {
  private static MAX_DURATION = 60000; // 60 seconds max for safety
  private static MIN_DURATION = 1000; // 1 second min
  private static DEFAULT_DURATION = 10000; // 10 seconds
  private static VIDEO_DIRECTORY = getEnv('VIDEO_DIRECTORY', path.join(process.cwd(), 'videos'));

  private videoProcesses: Map<
    string,
    {
      process: ReturnType<typeof spawn> | null;
      status: VideoStatus;
    }
  > = new Map<string, { process: ReturnType<typeof spawn> | null; status: VideoStatus }>();

  /**
   * Initialize the Video Capture service
   */
  public constructor() {
    logger.info(`Video Capture service created with directory: ${VideoService.VIDEO_DIRECTORY}`);
    // Ensure the video directory exists with proper permissions
    this.ensureVideoDirectory();
  }

  /**
   * Ensure the video directory exists with proper permissions
   */
  private ensureVideoDirectory(): void {
    try {
      // Check if directory exists
      if (!fs.existsSync(VideoService.VIDEO_DIRECTORY)) {
        // Create directory with proper permissions (0o755 = rwxr-xr-x)
        fs.mkdirSync(VideoService.VIDEO_DIRECTORY, { recursive: true, mode: 0o755 });
        logger.info(`Created video directory: ${VideoService.VIDEO_DIRECTORY}`);
      }

      // Ensure directory has correct permissions even if it already exists
      fs.chmodSync(VideoService.VIDEO_DIRECTORY, 0o755);

      // Check if directory is writable
      const testFile = path.join(VideoService.VIDEO_DIRECTORY, '.write_test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      logger.info(`Video directory ${VideoService.VIDEO_DIRECTORY} is writable`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to ensure video directory is writable: ${errorMessage}`);

      // Try to use the /tmp directory as a fallback
      VideoService.VIDEO_DIRECTORY = '/tmp/videos';
      logger.info(`Falling back to ${VideoService.VIDEO_DIRECTORY}`);

      // Create fallback directory
      if (!fs.existsSync(VideoService.VIDEO_DIRECTORY)) {
        fs.mkdirSync(VideoService.VIDEO_DIRECTORY, { recursive: true, mode: 0o777 });
      }

      // Ensure everyone can write to fallback directory
      fs.chmodSync(VideoService.VIDEO_DIRECTORY, 0o777);
    }
  }

  /**
   * Get a list of available video files
   */
  public async getVideoFiles(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(VideoService.VIDEO_DIRECTORY);
      return files.filter((file) => file.endsWith('.h264') || file.endsWith('.mp4'));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to read video directory: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Start video capture
   * @param config Video configuration
   * @returns Video status
   */
  public startCapture(config: VideoConfig): VideoStatus {
    // Validate and sanitize inputs
    const duration = Math.min(
      Math.max(config.duration || VideoService.DEFAULT_DURATION, VideoService.MIN_DURATION),
      VideoService.MAX_DURATION,
    );

    const timestamp = Date.now();
    const sanitizedFilename = this.sanitizeFilename(config.filename || `video_${timestamp}`);
    const filename = sanitizedFilename.endsWith('.h264') ? sanitizedFilename : `${sanitizedFilename}.h264`;
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

    // Check if the command exists
    this.checkCommandExists('rpicam-vid')
      .then((exists) => {
        if (!exists) {
          status.error = 'rpicam-vid command not found';
          status.completed = true;
          logger.err(status.error);
          return;
        }

        // Start the capture process
        this.executeCapture(id, status);
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        status.error = errorMessage;
        status.completed = true;
        logger.err(`Error checking for rpicam-vid command: ${errorMessage}`);
      });

    // Store the status
    this.videoProcesses.set(id, {
      process: null,
      status,
    });

    return status;
  }

  /**
   * Execute the video capture command
   * @param id Capture ID
   * @param status Capture status
   */
  private executeCapture(id: string, status: VideoStatus): void {
    const entry = this.videoProcesses.get(id);
    if (!entry) {
      logger.err(`Capture ${id} not found`);
      return;
    }

    try {
      // Ensure the output directory exists with proper permissions
      this.ensureVideoDirectory();

      // Build the command
      const args = ['-t', status.duration.toString(), '-o', status.path];

      logger.info(`Starting video capture: rpicam-vid ${args.join(' ')}`);

      // Use the command directly - permissions should be fixed now
      const command = 'rpicam-vid';

      // Start the process
      const captureProcess = spawn(command, args);

      // Update the entry with the process
      entry.process = captureProcess;

      // Log stdout and stderr
      captureProcess.stdout?.on('data', (data: Buffer) => {
        logger.info(`[rpicam-vid] ${data.toString().trim()}`);
      });

      captureProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        logger.warn(`[rpicam-vid] ${output}`);

        // Check for specific error messages
        if (output.includes('no cameras available')) {
          entry.status.error = 'No cameras available';
          this.killProcess(id);
        } else if (output.includes('Could not open any dmaHeap device')) {
          entry.status.error = 'Permission issue: Could not open dmaHeap device';
          this.killProcess(id);
        } else if (output.includes('failed to open output file')) {
          entry.status.error = `Permission issue: Cannot write to ${status.path}`;
          this.killProcess(id);

          // Try to recover by using /tmp directory
          this.recoverFromFilePermissionError(id, status);
        }
      });

      // Handle process completion
      captureProcess.on('close', (code: number) => {
        const endTime = Date.now();
        entry.status.endTime = endTime;
        entry.status.completed = true;

        if (code !== 0 && !entry.status.error) {
          entry.status.error = `Process exited with code ${code}`;
          logger.err(`Video capture ${id} failed: ${entry.status.error}`);
        } else if (!entry.status.error) {
          logger.info(`Video capture ${id} completed successfully`);
        }
      });

      captureProcess.on('error', (error: Error) => {
        const errorMessage = error.message;
        entry.status.error = errorMessage;
        entry.status.completed = true;
        entry.status.endTime = Date.now();
        logger.err(`Video capture ${id} error: ${errorMessage}`);
      });

      // Set a timeout to kill the process if it runs too long
      setTimeout(() => {
        if (!entry.status.completed) {
          logger.warn(`Video capture ${id} timed out`);
          this.killProcess(id);
        }
      }, status.duration + 5000); // Add 5 seconds grace period
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      entry.status.error = errorMessage;
      entry.status.completed = true;
      entry.status.endTime = Date.now();
      logger.err(`Failed to start video capture: ${errorMessage}`);
    }
  }

  /**
   * Try to recover from file permission errors by using /tmp directory
   * @param id Capture ID
   * @param status Capture status
   */
  private recoverFromFilePermissionError(id: string, status: VideoStatus): void {
    try {
      // Create a new filename in /tmp
      const tmpDir = '/tmp';
      const tmpFilename = `recovery_${status.filename}`;
      const tmpPath = path.join(tmpDir, tmpFilename);

      logger.info(`Attempting to recover by using tmp path: ${tmpPath}`);

      // Update the status
      status.path = tmpPath;

      // Start a new capture process
      this.executeCapture(id, status);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to recover from file permission error: ${errorMessage}`);
    }
  }

  /**
   * Kill a running video capture process
   * @param id Capture ID
   * @returns true if process was killed
   */
  public killProcess(id: string): boolean {
    const entry = this.videoProcesses.get(id);
    if (!entry?.status.completed) {
      try {
        if (entry?.process?.pid) {
          process.kill(entry.process.pid);
          entry.status.completed = true;
          entry.status.endTime = Date.now();
          logger.info(`Killed video capture process ${id}`);
          return true;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.err(`Failed to kill video capture process: ${errorMessage}`);
      }
    }
    return false;
  }

  /**
   * Get the status of a video capture
   * @param id Capture ID
   * @returns Video status or null if not found
   */
  public getStatus(id: string): VideoStatus | null {
    const entry = this.videoProcesses.get(id);
    return entry ? { ...entry.status } : null;
  }

  /**
   * Get the status of all video captures
   * @returns Array of video statuses
   */
  public getAllStatuses(): VideoStatus[] {
    return Array.from(this.videoProcesses.values()).map((entry) => ({ ...entry.status }));
  }

  /**
   * Check if a command exists
   * @param command Command to check
   * @returns true if command exists
   */
  private async checkCommandExists(command: string): Promise<boolean> {
    try {
      await execAsync(`which ${command}`);
      return true;
    } catch (error: unknown) {
      return false;
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
