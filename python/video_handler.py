#!/usr/bin/env python3
"""
Video Handler for Node.js Integration

This script provides video streaming and recording capabilities using Picamera2.
It can be controlled via command-line arguments or stdin commands.

Commands:
- stream:destination=<ip:port>,timeout=<seconds>
- record:duration=<seconds>,filename=<path>
- status
- stop:stream
- stop:record
- stop:all
"""

import sys
import os
import time
import json
import signal
import threading
import argparse
import logging
from datetime import datetime
from typing import Dict, Any, Optional, Union, List, Tuple

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("VideoHandler")

try:
    from picamera2 import Picamera2
    from picamera2.encoders import H264Encoder, Quality
    from picamera2.outputs import FfmpegOutput, FileOutput
except ImportError:
    logger.error("Failed to import Picamera2 modules. Make sure they are installed.")
    sys.exit(1)

class VideoHandler:
    """Handles video streaming and recording using Picamera2."""

    def __init__(self):
        """Initialize the video handler."""
        self.picam2 = None
        self.stream_encoder = None
        self.record_encoder = None
        self.stream_output = None
        self.record_output = None
        self.stream_thread = None
        self.record_thread = None
        self.stream_active = False
        self.record_active = False
        self.stream_destination = None
        self.stream_timeout = 300  # Default 5 minutes
        self.stream_timeout_timer = None
        self.resolution = (640, 480)
        self.format = "RGB888"
        self.initialized = False
        
        # Initialize camera
        self.initialize_camera()
        
    def initialize_camera(self) -> bool:
        """Initialize the camera with the configured settings."""
        try:
            if self.picam2 is None:
                logger.info("Initializing camera...")
                self.picam2 = Picamera2()
                
                # Configure camera
                video_config = self.picam2.create_video_configuration(
                    main={"size": self.resolution, "format": self.format}
                )
                self.picam2.configure(video_config)
                logger.info(f"Camera initialized with resolution {self.resolution} and format {self.format}")
                self.initialized = True
                return True
            return True
        except Exception as e:
            logger.error(f"Failed to initialize camera: {str(e)}")
            self.initialized = False
            return False
    
    def start_stream(self, destination: str, timeout: int = 300) -> bool:
        """
        Start streaming to the specified destination.
        
        Args:
            destination: UDP destination in format 'ip:port'
            timeout: Stream timeout in seconds (default: 300s = 5 minutes)
            
        Returns:
            bool: True if successful, False otherwise
        """
        if not self.initialized and not self.initialize_camera():
            return False
            
        # If already streaming to the same destination, just reset the timeout
        if self.stream_active and self.stream_destination == destination:
            logger.info(f"Already streaming to {destination}, resetting timeout to {timeout} seconds")
            self.reset_stream_timeout(timeout)
            return True
            
        # If already streaming to a different destination, stop the current stream
        if self.stream_active:
            logger.info(f"Stopping current stream to {self.stream_destination} before starting new stream")
            self.stop_stream()
        
        try:
            # Start the camera if it's not already running
            if not self.picam2.started:
                self.picam2.start()
                logger.info("Camera started")
                
            # Set up encoder and output for streaming
            # H.264 encoder with repeat enabled for streaming
            self.stream_encoder = H264Encoder(repeat=True, iperiod=15)
            
            # FfmpegOutput for UDP streaming
            output_cmd = f"-f mpegts udp://{destination}"
            self.stream_output = FfmpegOutput(output_cmd)
            
            # Start recording/streaming
            self.picam2.start_encoder(encoder=self.stream_encoder, output=self.stream_output)
            
            # Update state
            self.stream_active = True
            self.stream_destination = destination
            self.stream_timeout = timeout
            
            # Set timeout
            self.reset_stream_timeout(timeout)
            
            logger.info(f"Streaming started to {destination} with {timeout}s timeout")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start stream: {str(e)}")
            # Cleanup in case of failure
            self.stop_stream()
            return False
    
    def reset_stream_timeout(self, timeout: int = 300) -> None:
        """Reset the stream timeout timer."""
        # Cancel existing timer if it exists
        if self.stream_timeout_timer is not None:
            self.stream_timeout_timer.cancel()
        
        # Set new timer
        self.stream_timeout = timeout
        self.stream_timeout_timer = threading.Timer(timeout, self.stop_stream)
        self.stream_timeout_timer.daemon = True
        self.stream_timeout_timer.start()
        logger.info(f"Stream timeout set to {timeout} seconds")
    
    def stop_stream(self) -> bool:
        """Stop the current streaming session."""
        if not self.stream_active:
            logger.info("No active stream to stop")
            return True
            
        try:
            # Cancel timeout timer
            if self.stream_timeout_timer is not None:
                self.stream_timeout_timer.cancel()
                self.stream_timeout_timer = None
            
            # Stop the encoder if it's running
            if self.stream_encoder is not None:
                self.picam2.stop_encoder(self.stream_encoder)
                self.stream_encoder = None
                self.stream_output = None
            
            # Update state
            self.stream_active = False
            self.stream_destination = None
            
            logger.info("Streaming stopped")
            
            # If no recording is active, stop the camera too
            if not self.record_active and self.picam2 and self.picam2.started:
                self.picam2.stop()
                logger.info("Camera stopped")
                
            return True
            
        except Exception as e:
            logger.error(f"Error stopping stream: {str(e)}")
            return False
    
    def start_recording(self, filename: str, duration: int) -> bool:
        """
        Start recording video for the specified duration.
        
        Args:
            filename: Output filename (should end with .mp4 or .h264)
            duration: Recording duration in seconds
            
        Returns:
            bool: True if successful, False otherwise
        """
        if not self.initialized and not self.initialize_camera():
            return False
            
        # Check if already recording
        if self.record_active:
            logger.error("Recording already in progress")
            return False
            
        try:
            # Start the camera if it's not already running
            if not self.picam2.started:
                self.picam2.start()
                logger.info("Camera started")
                
            # Set up encoder for recording
            self.record_encoder = H264Encoder(bitrate=10000000)
            
            # Choose the right output format based on filename
            if filename.endswith('.mp4'):
                self.record_output = FfmpegOutput(filename)
            else:
                # Default to .h264 if not .mp4
                if not filename.endswith('.h264'):
                    filename += '.h264'
                self.record_output = FileOutput(filename)
            
            # Start recording
            self.picam2.start_encoder(encoder=self.record_encoder, output=self.record_output)
            
            # Update state
            self.record_active = True
            
            # Start a timer to stop recording after the specified duration
            self.record_thread = threading.Timer(duration, self.stop_recording)
            self.record_thread.daemon = True
            self.record_thread.start()
            
            logger.info(f"Recording started to {filename} for {duration} seconds")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start recording: {str(e)}")
            # Cleanup in case of failure
            self.stop_recording()
            return False
    
    def stop_recording(self) -> bool:
        """Stop the current recording session."""
        if not self.record_active:
            logger.info("No active recording to stop")
            return True
            
        try:
            # Cancel timer if it exists
            if self.record_thread is not None:
                self.record_thread.cancel()
                self.record_thread = None
            
            # Stop the encoder if it's running
            if self.record_encoder is not None:
                self.picam2.stop_encoder(self.record_encoder)
                self.record_encoder = None
                self.record_output = None
            
            # Update state
            self.record_active = False
            
            logger.info("Recording stopped")
            
            # If no streaming is active, stop the camera too
            if not self.stream_active and self.picam2 and self.picam2.started:
                self.picam2.stop()
                logger.info("Camera stopped")
                
            return True
            
        except Exception as e:
            logger.error(f"Error stopping recording: {str(e)}")
            return False
    
    def stop_all(self) -> bool:
        """Stop all active sessions (streaming and recording)."""
        stream_result = self.stop_stream()
        record_result = self.stop_recording()
        
        # Make sure camera is stopped
        if self.picam2 and self.picam2.started:
            try:
                self.picam2.stop()
                logger.info("Camera stopped")
            except Exception as e:
                logger.error(f"Error stopping camera: {str(e)}")
                return False
        
        return stream_result and record_result
    
    def get_status(self) -> Dict[str, Any]:
        """Get current status information."""
        status = {
            "initialized": self.initialized,
            "camera_running": self.picam2.started if self.picam2 else False,
            "streaming": {
                "active": self.stream_active,
                "destination": self.stream_destination,
                "timeout_remaining": None  # Will be calculated below if active
            },
            "recording": {
                "active": self.record_active
            },
            "resolution": self.resolution,
            "format": self.format
        }
        
        # Calculate remaining timeout if streaming is active
        if self.stream_active and self.stream_timeout_timer is not None:
            # This is an approximation since we can't directly access the timer's remaining time
            remaining = max(0, self.stream_timeout - (time.time() - self.stream_timeout_timer._when))
            status["streaming"]["timeout_remaining"] = int(remaining)
        
        return status
    
    def cleanup(self) -> None:
        """Clean up resources."""
        logger.info("Cleaning up resources...")
        self.stop_all()
        
        # Release camera resources
        if self.picam2 is not None:
            if self.picam2.started:
                self.picam2.stop()
            self.picam2.close()
            self.picam2 = None
        
        logger.info("Cleanup complete")


def parse_command(cmd: str) -> Tuple[str, Dict[str, str]]:
    """
    Parse a command string into command name and parameters.
    Example: 'stream:destination=192.168.1.100:12345,timeout=300'
    
    Returns:
        tuple: (command_name, parameters_dict)
    """
    # Split command and parameters
    parts = cmd.strip().split(':', 1)
    command = parts[0].lower()
    
    params = {}
    if len(parts) > 1:
        # Parse parameters
        param_pairs = parts[1].split(',')
        for pair in param_pairs:
            if '=' in pair:
                key, value = pair.split('=', 1)
                params[key.strip()] = value.strip()
    
    return command, params


def handle_command(video_handler: VideoHandler, command: str, params: Dict[str, str]) -> Dict[str, Any]:
    """Process a command and return a result."""
    response = {"success": False, "message": "", "data": None}
    
    try:
        if command == "stream":
            if "destination" not in params:
                response["message"] = "Missing required parameter: destination"
                return response
                
            destination = params["destination"]
            timeout = int(params.get("timeout", 300))
            
            success = video_handler.start_stream(destination, timeout)
            response["success"] = success
            response["message"] = f"Streaming {'started' if success else 'failed'}" 
            
        elif command == "record":
            if "duration" not in params or "filename" not in params:
                response["message"] = "Missing required parameters: duration and/or filename"
                return response
                
            filename = params["filename"]
            try:
                duration = int(params["duration"])
            except ValueError:
                response["message"] = "Duration must be an integer"
                return response
                
            success = video_handler.start_recording(filename, duration)
            response["success"] = success
            response["message"] = f"Recording {'started' if success else 'failed'}"
            
        elif command == "stop":
            target = params.get("target", "all").lower()
            
            if target == "stream":
                success = video_handler.stop_stream()
                component = "stream"
            elif target == "record":
                success = video_handler.stop_recording()
                component = "recording"
            elif target == "all":
                success = video_handler.stop_all()
                component = "all components"
            else:
                response["message"] = f"Invalid stop target: {target}"
                return response
                
            response["success"] = success
            response["message"] = f"Stopped {component}"
            
        elif command == "status":
            status = video_handler.get_status()
            response["success"] = True
            response["message"] = "Status retrieved"
            response["data"] = status
            
        else:
            response["message"] = f"Unknown command: {command}"
            
    except Exception as e:
        response["success"] = False
        response["message"] = f"Error processing command: {str(e)}"
        logger.error(f"Command error: {str(e)}", exc_info=True)
        
    return response


def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(description="Video Handler for Node.js Integration")
    parser.add_argument('--command', help='Command to execute')
    parser.add_argument('--interactive', action='store_true', help='Run in interactive mode')
    args = parser.parse_args()
    
    # Create video handler
    video_handler = VideoHandler()
    
    # Set up signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        logger.info("Received shutdown signal")
        video_handler.cleanup()
        sys.exit(0)
        
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Process a single command if provided
        if args.command:
            command, params = parse_command(args.command)
            result = handle_command(video_handler, command, params)
            print(json.dumps(result))
            if not args.interactive:
                video_handler.cleanup()
                return
                
        # Interactive mode - read commands from stdin
        if args.interactive:
            logger.info("Running in interactive mode. Enter commands or 'exit' to quit.")
            
            while True:
                try:
                    cmd = input().strip()
                    if cmd.lower() == 'exit':
                        break
                        
                    command, params = parse_command(cmd)
                    result = handle_command(video_handler, command, params)
                    print(json.dumps(result))
                    sys.stdout.flush()  # Ensure output is immediately visible to parent process
                    
                except KeyboardInterrupt:
                    break
                except Exception as e:
                    logger.error(f"Error processing input: {str(e)}")
                    print(json.dumps({"success": False, "message": f"Error: {str(e)}"}))
                    sys.stdout.flush()
    
    finally:
        video_handler.cleanup()


if __name__ == "__main__":
    main()