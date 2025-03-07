#!/usr/bin/env python3
"""
Test script for video_handler.py

This script tests the main functionality of video_handler.py:
1. Start a UDP stream to a specified destination
2. Create two recordings while the stream is active
3. Stop the stream and clean up
"""

import os
import sys
import time
import json
import argparse
import subprocess
import signal

# Colors for terminal output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def section(title):
    """Print a section header"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'=' * 80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.BLUE} {title} {Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'=' * 80}{Colors.ENDC}")

def success(message, data=None):
    """Print a success message"""
    print(f"{Colors.GREEN}✓ {Colors.ENDC}{message}")
    if data:
        if isinstance(data, dict) or isinstance(data, list):
            print(f"  {Colors.BLUE}Data:{Colors.ENDC} {json.dumps(data, indent=2)}")
        else:
            print(f"  {Colors.BLUE}Data:{Colors.ENDC} {data}")

def failure(message, error=None):
    """Print a failure message"""
    print(f"{Colors.RED}✗ {Colors.ENDC}{message}")
    if error:
        print(f"  {Colors.RED}Error:{Colors.ENDC} {error}")

def run_video_handler_command(process, command):
    """Send a command to the video_handler.py process and get the response"""
    try:
        # Send command to the process
        process.stdin.write(command + '\n')
        process.stdin.flush()
        
        # Read the response (assuming JSON response)
        response_str = ""
        while True:
            line = process.stdout.readline().strip()
            response_str += line
            try:
                # Try to parse as JSON
                response = json.loads(response_str)
                return response
            except json.JSONDecodeError:
                # Not a complete JSON yet, continue reading
                continue
    except Exception as e:
        failure(f"Failed to execute command: {command}", str(e))
        return {"success": False, "message": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Test script for video_handler.py")
    parser.add_argument('--video-handler', default='./video_handler.py', 
                        help='Path to video_handler.py')
    parser.add_argument('--destination', default='78.189.148.208:12345',
                        help='Streaming destination (default: 78.189.148.208:12345)')
    parser.add_argument('--stream-timeout', type=int, default=300, 
                        help='Stream timeout in seconds (default: 300)')
    parser.add_argument('--recording1-duration', type=int, default=10,
                        help='Duration of first recording in seconds (default: 10)')
    parser.add_argument('--recording2-duration', type=int, default=5,
                        help='Duration of second recording in seconds (default: 5)')
                        
    args = parser.parse_args()

    # Check if video_handler.py exists
    if not os.path.exists(args.video_handler):
        failure(f"Video handler script not found at: {args.video_handler}")
        return False

    # Make sure video_handler.py is executable
    os.chmod(args.video_handler, 0o755)

    section("Starting video_handler.py")
    
    # Start the video_handler.py process
    try:
        process = subprocess.Popen(
            [args.video_handler, '--interactive'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1  # Line buffered
        )
        success("Started video_handler.py process")
    except Exception as e:
        failure("Failed to start video_handler.py process", str(e))
        return False

    try:
        # Give the process a moment to initialize
        time.sleep(2)
        
        # Get initial status
        section("Checking Initial Status")
        status_response = run_video_handler_command(process, "status")
        if status_response.get("success"):
            success("Got initial status", status_response.get("data"))
        else:
            failure("Failed to get initial status", status_response.get("message"))

        # Start streaming
        section("Starting UDP Stream")
        stream_cmd = f"stream:destination={args.destination},timeout={args.stream_timeout}"
        stream_response = run_video_handler_command(process, stream_cmd)
        
        if stream_response.get("success"):
            success(f"Started streaming to {args.destination}", stream_response)
        else:
            failure("Failed to start streaming", stream_response.get("message"))
            raise Exception("Streaming failed to start")

        # Check stream status
        time.sleep(2)
        status_response = run_video_handler_command(process, "status")
        if status_response.get("success"):
            streaming_data = status_response.get("data", {}).get("streaming", {})
            if streaming_data.get("active"):
                success("Stream is active", streaming_data)
            else:
                failure("Stream is not active", streaming_data)
                raise Exception("Stream is not active")
        
        # Start first recording
        section("Starting First Recording")
        recording1_filename = f"test_recording1_{int(time.time())}.h264"
        record1_cmd = f"record:duration={args.recording1_duration},filename={recording1_filename}"
        record1_response = run_video_handler_command(process, record1_cmd)
        
        if record1_response.get("success"):
            success(f"Started first recording: {recording1_filename}", record1_response)
        else:
            failure("Failed to start first recording", record1_response.get("message"))

        # Wait for first recording to complete
        print(f"{Colors.YELLOW}Waiting for first recording to complete ({args.recording1_duration} seconds)...{Colors.ENDC}")
        time.sleep(args.recording1_duration + 2)  # Add a little buffer

        # Check status after first recording
        status_response = run_video_handler_command(process, "status")
        if status_response.get("success"):
            success("Status after first recording", status_response.get("data"))
        
        # Start second recording
        section("Starting Second Recording")
        recording2_filename = f"test_recording2_{int(time.time())}.mp4"
        record2_cmd = f"record:duration={args.recording2_duration},filename={recording2_filename}"
        record2_response = run_video_handler_command(process, record2_cmd)
        
        if record2_response.get("success"):
            success(f"Started second recording: {recording2_filename}", record2_response)
        else:
            failure("Failed to start second recording", record2_response.get("message"))

        # Wait for second recording to complete
        print(f"{Colors.YELLOW}Waiting for second recording to complete ({args.recording2_duration} seconds)...{Colors.ENDC}")
        time.sleep(args.recording2_duration + 2)  # Add a little buffer

        # Check status after second recording
        status_response = run_video_handler_command(process, "status")
        if status_response.get("success"):
            success("Status after second recording", status_response.get("data"))
        
        # Stop the stream
        section("Stopping Stream")
        stop_stream_response = run_video_handler_command(process, "stop:target=stream")
        if stop_stream_response.get("success"):
            success("Stopped streaming", stop_stream_response)
        else:
            failure("Failed to stop streaming", stop_stream_response.get("message"))

        # Final status check
        status_response = run_video_handler_command(process, "status")
        if status_response.get("success"):
            success("Final status", status_response.get("data"))
        
        # Clean up - stop all components
        section("Cleaning Up")
        cleanup_response = run_video_handler_command(process, "stop:target=all")
        if cleanup_response.get("success"):
            success("Cleaned up all components", cleanup_response)
        else:
            failure("Failed to clean up", cleanup_response.get("message"))
        
        section("TEST SUMMARY")
        print(f"{Colors.BOLD}{Colors.GREEN}Test completed successfully!{Colors.ENDC}")
        return True
        
    except Exception as e:
        failure("Test failed", str(e))
        return False
    finally:
        # Send exit command
        try:
            process.stdin.write("exit\n")
            process.stdin.flush()
            time.sleep(1)
        except:
            pass
            
        # Make sure process is terminated
        try:
            process.terminate()
            process.wait(timeout=5)
        except:
            process.kill()
        
        print(f"\n{Colors.BOLD}Test finished{Colors.ENDC}")

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)