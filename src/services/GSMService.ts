// src/services/GSMService.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from 'jet-logger';

// Convert exec to Promise-based
const execAsync = promisify(exec);

// Types
export interface ModemInfo {
  id: string;
  path: string;
  enabled: boolean;
}

export interface GPSLocation {
  utc: string;
  longitude: string;
  latitude: string;
  altitude: string;
  available: boolean;
}

export interface SMSMessage {
  id: string;
  path: string;
  number: string;
  text: string;
  timestamp: string;
  state: string;
}

export interface SMSListResponse {
  paths: string[];
  ids: string[];
}

/**
 * Service to interact with GSM modem
 */
class GSMService {
  private modemId: string | null = null;
  private gpsEnabled = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private location: GPSLocation = {
    utc: '',
    longitude: '',
    latitude: '',
    altitude: '',
    available: false,
  };
  private jsonSupported = true;

  /**
   * Initialize the GSM service
   */
  public constructor() {
    logger.info('GSM service created');
  }

  /**
   * Execute mmcli command and parse response - supporting both JSON and non-JSON formats
   * @param command The mmcli command to execute
   * @returns Parsed response
   */
  private async executeCommand<T>(command: string): Promise<T> {
    try {
      logger.info(`Executing command: ${command}`);
      
      // If previous commands failed with JSON, don't use -J flag
      if (!this.jsonSupported && command.includes(' -J ')) {
        command = command.replace(' -J ', ' ');
      }
      
      const { stdout } = await execAsync(command);
      logger.info(`Command output: ${stdout.substring(0, 200)}${stdout.length > 200 ? '...' : ''}`);
      
      // Parse response based on command type and format
      if (this.jsonSupported && command.includes(' -J ')) {
        try {
          // Try to parse as JSON
          return JSON.parse(stdout) as T;
        } catch (err) {
          // If JSON parsing fails, disable JSON for future commands
          this.jsonSupported = false;
          logger.warn('JSON parsing failed, falling back to text parsing for future commands');
          
          // Continue with text parsing
          return this.parseTextOutput<T>(command, stdout);
        }
      } else {
        // Direct text parsing for commands without -J or when JSON is known not to be supported
        return this.parseTextOutput<T>(command, stdout);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Command execution failed: ${errorMessage}`);
      throw error;
    }
  }
  
  /**
   * Parse plain text output from mmcli commands
   * @param command The original command that was executed
   * @param output The command output as text
   * @returns Parsed output in the expected format
   */
  private parseTextOutput<T>(command: string, output: string): T {
    // Default result if nothing else matches
    const defaultResult = { success: true, message: output.trim() } as unknown as T;
    
    // Check for specific command patterns and parse accordingly
    if (command.includes('mmcli -L')) {
      // List modems command
      const modemList: string[] = [];
      const modemRegex = /\/org\/freedesktop\/ModemManager1\/Modem\/(\d+)/g;
      let match;
      
      while ((match = modemRegex.exec(output)) !== null) {
        modemList.push(`/org/freedesktop/ModemManager1/Modem/${match[1]}`);
      }
      
      return { 'modem-list': modemList } as unknown as T;
    } 
    else if (command.includes('--messaging-create-sms')) {
      // Create SMS command
      const smsPathRegex = /\/org\/freedesktop\/ModemManager1\/SMS\/(\d+)/;
      const smsPathMatch = smsPathRegex.exec(output);
      
      if (smsPathMatch) {
        const smsPath = smsPathMatch[0];
        return { 
          modem: { 
            messaging: { 
              'created-sms': smsPath,
            },
          },
        } as unknown as T;
      }
    }
    else if (command.includes('--messaging-list-sms')) {
      // List SMS command
      const smsPaths: string[] = [];
      const smsRegex = /\/org\/freedesktop\/ModemManager1\/SMS\/(\d+)/g;
      let match;
      
      while ((match = smsRegex.exec(output)) !== null) {
        smsPaths.push(match[0]);
      }
      
      return { 'modem.messaging.sms': smsPaths } as unknown as T;
    }
    else if (command.includes('mmcli -s') && !command.includes('--send')) {
      // Read SMS details
      const numberRegex = /number\s*:\s*([^\n]+)/;
      const textRegex = /text\s*:\s*([^\n]+)/;
      const stateRegex = /state\s*:\s*([^\n]+)/;
      const timestampRegex = /timestamp\s*:\s*([^\n]+)/;
      const smsIdRegex = /mmcli -s (\d+)/;
      
      const numberMatch = numberRegex.exec(output);
      const textMatch = textRegex.exec(output);
      const stateMatch = stateRegex.exec(output);
      const timestampMatch = timestampRegex.exec(output);
      const smsIdMatch = smsIdRegex.exec(command);
      
      const smsId = smsIdMatch ? smsIdMatch[1] : '';
      const smsPath = `/org/freedesktop/ModemManager1/SMS/${smsId}`;
      
      return {
        sms: {
          content: {
            number: numberMatch ? numberMatch[1].trim() : '',
            text: textMatch ? textMatch[1].trim() : '',
          },
          'dbus-path': smsPath,
          properties: {
            state: stateMatch ? stateMatch[1].trim() : '',
            timestamp: timestampMatch ? timestampMatch[1].trim() : '',
          },
        },
      } as unknown as T;
    }
    else if (command.includes('--location-get')) {
      // Get location command
      const latitudeRegex = /latitude\s*:\s*([^\n]+)/;
      const longitudeRegex = /longitude\s*:\s*([^\n]+)/;
      const altitudeRegex = /altitude\s*:\s*([^\n]+)/;
      const utcRegex = /utc\s*:\s*([^\n]+)/;
      
      const latitudeMatch = latitudeRegex.exec(output);
      const longitudeMatch = longitudeRegex.exec(output);
      const altitudeMatch = altitudeRegex.exec(output);
      const utcMatch = utcRegex.exec(output);
      
      return {
        modem: {
          location: {
            gps: {
              latitude: latitudeMatch ? latitudeMatch[1].trim() : '--',
              longitude: longitudeMatch ? longitudeMatch[1].trim() : '--',
              altitude: altitudeMatch ? altitudeMatch[1].trim() : '--',
              utc: utcMatch ? utcMatch[1].trim() : '',
            },
          },
        },
      } as unknown as T;
    }
    
    // For send SMS and other commands that just need success
    if (output.toLowerCase().includes('successfully')) {
      return defaultResult;
    }
    
    // Default for any other commands
    return defaultResult;
  }

  /**
   * List available modems
   * @returns List of available modems
   */
  public async listModems(): Promise<ModemInfo[]> {
    try {
      const response = await this.executeCommand<{ 'modem-list': string[] }>('mmcli -L -J');
      
      // Extract modem IDs from paths
      const modems: ModemInfo[] = response['modem-list'].map(path => {
        const id = path.split('/').pop() ?? '';
        return {
          id: id.replace('Modem/', ''),
          path,
          enabled: false,
        };
      });
      
      return modems;
    } catch (err) {
      logger.err('Error listing modems');
      return [];
    }
  }

  /**
   * Initialize and set up the modem
   * @returns True if modem was set up successfully
   */
  public async initialize(): Promise<boolean> {
    try {
      // List modems
      const modems = await this.listModems();
      
      // If no modems found, try again
      if (modems.length === 0) {
        logger.warn('No modems found, trying again...');
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 2000));
        const modemsRetry = await this.listModems();
        
        if (modemsRetry.length === 0) {
          logger.err('No modems found after retry');
          return false;
        }
        
        this.modemId = modemsRetry[0].id;
      } else {
        this.modemId = modems[0].id;
      }
      
      logger.info(`Using modem ID: ${this.modemId}`);
      
      // Enable modem
      await this.enableModem();
      
      // Enable GPS
      await this.enableGPS();
      
      // Start polling for location updates
      this.startLocationPolling();
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Modem initialization failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Enable the modem
   * @returns True if modem was enabled successfully
   */
  public async enableModem(): Promise<boolean> {
    if (!this.modemId) {
      logger.err('No modem ID set. Cannot enable modem.');
      return false;
    }
    
    try {
      await this.executeCommand(`mmcli -m ${this.modemId} -J -e`);
      logger.info(`Modem ${this.modemId} enabled successfully`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to enable modem: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Enable GPS and location services
   * @returns True if GPS was enabled successfully
   */
  public async enableGPS(): Promise<boolean> {
    if (!this.modemId) {
      logger.err('No modem ID set. Cannot enable GPS.');
      return false;
    }
    
    try {
      await this.executeCommand(`mmcli -m ${this.modemId} -J --location-enable-gps-raw --location-enable-gps-nmea`);
      logger.info(`GPS enabled successfully for modem ${this.modemId}`);
      this.gpsEnabled = true;
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to enable GPS: ${errorMessage}`);
      // GPS is optional, so we don't want to fail the whole module
      return false;
    }
  }

  /**
   * Start polling for location updates
   */
  private startLocationPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    // Poll every 30 seconds
    this.pollingInterval = setInterval(async () => {
      try {
        await this.getLocation();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.warn(`Location polling error: ${errorMessage}`);
      }
    }, 30000); // 30 seconds
    
    // Get location immediately
    this.getLocation().catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Initial location error: ${errorMessage}`);
    });
  }

  /**
   * Get current location from GPS
   * @returns GPS location data
   */
  public async getLocation(): Promise<GPSLocation> {
    if (!this.modemId || !this.gpsEnabled) {
      return this.location;
    }
    
    try {
      const response = await this.executeCommand<{
        modem: {
          location: {
            gps: {
              altitude: string;
              latitude: string;
              longitude: string;
              utc: string;
            };
          };
        };
      }>(`mmcli -m ${this.modemId} -J --location-get`);
      
      // Check if we have valid GPS data
      const gps = response.modem.location.gps;
      
      if (gps.latitude !== '--' && gps.longitude !== '--') {
        this.location = {
          utc: gps.utc,
          longitude: gps.longitude,
          latitude: gps.latitude,
          altitude: gps.altitude,
          available: true,
        };
        logger.info(`GPS location updated: ${JSON.stringify(this.location)}`);
      } else {
        logger.info('GPS location not yet available');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Failed to get location: ${errorMessage}`);
    }
    
    return this.location;
  }

  /**
   * Get the current location without making a new request
   * @returns Current stored GPS location
   */
  public getCurrentLocation(): GPSLocation {
    return this.location;
  }

  /**
   * List SMS messages
   * @returns List of SMS paths and IDs
   */
  public async listSMS(): Promise<SMSListResponse> {
    if (!this.modemId) {
      logger.err('No modem ID set. Cannot list SMS.');
      return { paths: [], ids: [] };
    }
    
    try {
      const response = await this.executeCommand<{
        'modem.messaging.sms': string[];
      }>(`mmcli -m ${this.modemId} -J --messaging-list-sms`);
      
      const paths = response['modem.messaging.sms'] ?? [];
      const ids = paths.map(path => path.split('/').pop() ?? '');
      
      return { paths, ids };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to list SMS: ${errorMessage}`);
      return { paths: [], ids: [] };
    }
  }

  /**
   * Read SMS message by ID
   * @param smsId SMS ID to read
   * @returns SMS message content
   */
  public async readSMS(smsId: string): Promise<SMSMessage | null> {
    try {
      const response = await this.executeCommand<{
        sms: {
          content: {
            number: string;
            text: string;
          };
          'dbus-path': string;
          properties: {
            state: string;
            timestamp: string;
          };
        };
      }>(`mmcli -s ${smsId} -J`);
      
      return {
        id: smsId,
        path: response.sms['dbus-path'],
        number: response.sms.content.number,
        text: response.sms.content.text,
        timestamp: response.sms.properties.timestamp,
        state: response.sms.properties.state,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to read SMS ${smsId}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Create SMS message
   * @param number Recipient phone number
   * @param text Message text
   * @returns SMS ID if created successfully
   */
  public async createSMS(number: string, text: string): Promise<string | null> {
    if (!this.modemId) {
      logger.err('No modem ID set. Cannot create SMS.');
      return null;
    }
    
    try {
      // Escape single quotes in the text
      const escapedText = text.replace(/'/g, "\\'");
      
      // Execute the command with special handling for SMS creation
      const command = `mmcli -m ${this.modemId} -J --messaging-create-sms="text='${escapedText}',number='${number}'"`;
      
      // Try to create SMS
      const response = await this.executeCommand<{
        modem: {
          messaging: {
            'created-sms': string;
          };
        };
      }>(command);
      
      // Extract SMS ID
      const path = response.modem.messaging['created-sms'];
      const smsId = path.split('/').pop() ?? '';
      
      logger.info(`SMS created with ID ${smsId}`);
      return smsId;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // If JSON failed, try fallback to non-JSON command
      if (!this.jsonSupported) {
        try {
          logger.info('Attempting SMS creation with non-JSON command');
          const escapedText = text.replace(/'/g, "\\'");
          const fallbackCommand = `mmcli -m ${this.modemId} --messaging-create-sms="text='${escapedText}',number='${number}'"`;
          
          const { stdout } = await execAsync(fallbackCommand);
          logger.info(`SMS creation output: ${stdout}`);
          
          // Parse SMS ID from text output
          const smsPathRegex = /\/org\/freedesktop\/ModemManager1\/SMS\/(\d+)/;
          const smsPathMatch = smsPathRegex.exec(stdout);
          if (smsPathMatch) {
            const smsId = smsPathMatch[1];
            logger.info(`SMS created with ID ${smsId} (non-JSON method)`);
            return smsId;
          }
        } catch (fallbackError: unknown) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
          logger.err(`Failed to create SMS with fallback method: ${fallbackErrorMessage}`);
        }
      }
      
      logger.err(`Failed to create SMS: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Send SMS message by ID
   * @param smsId SMS ID to send
   * @returns True if sent successfully
   */
  public async sendSMS(smsId: string): Promise<boolean> {
    try {
      // Try with JSON first, fallback to non-JSON if needed
      const command = this.jsonSupported 
        ? `mmcli -s ${smsId} -J --send`
        : `mmcli -s ${smsId} --send`;
      
      const { stdout } = await execAsync(command);
      
      // Check for success message
      const success = stdout.toLowerCase().includes('successfully');
      
      if (success) {
        logger.info(`SMS ${smsId} sent successfully`);
        return true;
      } else {
        logger.warn(`SMS send command completed but no success confirmation: ${stdout}`);
        return false;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.err(`Failed to send SMS ${smsId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Create and send SMS in one operation
   * @param number Recipient phone number
   * @param text Message text
   * @returns True if sent successfully
   */
  public async sendNewSMS(number: string, text: string): Promise<boolean> {
    const smsId = await this.createSMS(number, text);
    if (!smsId) {
      return false;
    }
    
    return this.sendSMS(smsId);
  }

  /**
   * Get the modem ID
   * @returns Current modem ID
   */
  public getModemId(): string | null {
    return this.modemId;
  }

  /**
   * Get service status
   * @returns Status of the GSM service
   */
  public getStatus(): Record<string, unknown> {
    return {
      initialized: !!this.modemId,
      modemId: this.modemId,
      gpsEnabled: this.gpsEnabled,
      location: this.location,
    };
  }
}

export default new GSMService();