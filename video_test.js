const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const VIDEO_ENDPOINT = `${BASE_URL}/video`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Create a section header
const section = (title) => {
  console.log('\n' + colors.bright + colors.blue + '='.repeat(80) + colors.reset);
  console.log(colors.bright + colors.blue + ` ${title} ` + colors.reset);
  console.log(colors.bright + colors.blue + '='.repeat(80) + colors.reset);
};

// Format successful operation output
const success = (message, data = null) => {
  console.log(colors.green + '✓ ' + colors.reset + message);
  if (data) {
    console.log('  ' + colors.cyan + 'Data:' + colors.reset, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  }
};

// Format failed operation output
const failure = (message, error = null) => {
  console.log(colors.red + '✗ ' + colors.reset + message);
  if (error) {
    const errorMessage = error.response?.data?.error || error.message || String(error);
    console.log('  ' + colors.red + 'Error:' + colors.reset, errorMessage);
  }
};

// Wait for specified milliseconds
const wait = async (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Test video streaming
async function testVideoStreaming() {
  section('Video Streaming Test');
  
  try {
    const destination = "192.168.2.238:12345"; // Replace with your UDP destination
    
    // Get detailed status before starting
    const initialStatus = await axios.get(`${VIDEO_ENDPOINT}/status`);
    success('Got initial system status', initialStatus.data);
    
    // Start streaming
    const streamResponse = await axios.post(`${VIDEO_ENDPOINT}/stream`, {
      destination,
      timeout: 120 // 1 minute timeout for testing
    });
    success('Started streaming', streamResponse.data);
    
    // Check stream status
    await wait(2000);
    const streamStatus = await axios.get(`${VIDEO_ENDPOINT}/stream/status`);
    success('Stream status', streamStatus.data);
    
    // Start a recording while streaming
    const recordResponse = await axios.post(`${VIDEO_ENDPOINT}/capture`, {
      duration: 5000, // 5 seconds
      filename: "test_recording.h264"
    });
    success('Started recording', recordResponse.data);
    
    // Wait for recording to complete
    await wait(7000);
    
    // Check status of recording
    const captureStatus = await axios.get(`${VIDEO_ENDPOINT}/capture/${recordResponse.data.status.id}`);
    success('Recording status', captureStatus.data);
    
    // Check we can get all captures
    const allCaptures = await axios.get(`${VIDEO_ENDPOINT}/capture`);
    success('All captures', allCaptures.data);
    
    // List video files
    const files = await axios.get(`${VIDEO_ENDPOINT}/files`);
    success('Video files', files.data);
    
    // Stop streaming
    const streamStopResponse = await axios.delete(`${VIDEO_ENDPOINT}/stream`);
    success('Stopped streaming', streamStopResponse.data);
    
    // Final status check
    const finalStatus = await axios.get(`${VIDEO_ENDPOINT}/status`);
    success('Final system status', finalStatus.data);
    
    return true;
  } catch (error) {
    failure('Streaming test failed', error);
    return false;
  }
}

// Main test function
async function runTests() {
  console.log(colors.bright + colors.cyan + '\nVIDEO SERVICE TEST' + colors.reset);
  console.log(colors.cyan + new Date().toISOString() + colors.reset + '\n');
  
  const streamingResult = await testVideoStreaming();
  
  // Print summary
  section('TEST SUMMARY');
  
  if (streamingResult) {
    console.log(colors.bright + 'Video Streaming Test: ' + colors.green + 'SUCCESS' + colors.reset);
  } else {
    console.log(colors.bright + 'Video Streaming Test: ' + colors.red + 'FAILED' + colors.reset);
  }
}

// Run tests
runTests().catch(error => {
  console.error(colors.red + 'Test execution failed:' + colors.reset, error);
});