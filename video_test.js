const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const VIDEO_ENDPOINT = `${BASE_URL}/video`;
const TEST_VIDEO_DURATION = 5000; // 5 seconds
const TEST_VIDEO_FILENAME = `test_${Date.now()}.h264`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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

// Function to start video capture
async function startVideoCapture() {
  section('Starting Video Capture');
  console.log(`Capturing ${TEST_VIDEO_DURATION}ms of video as "${TEST_VIDEO_FILENAME}"...`);
  
  try {
    const response = await axios.post(`${VIDEO_ENDPOINT}/capture`, {
      duration: TEST_VIDEO_DURATION,
      filename: TEST_VIDEO_FILENAME
    });
    
    success('Video capture started', response.data);
    return response.data.status.id;
  } catch (error) {
    failure('Failed to start video capture', error);
    return null;
  }
}

// Function to get capture status
async function getCaptureStatus(captureId) {
  section(`Getting Capture Status (ID: ${captureId})`);
  
  try {
    const response = await axios.get(`${VIDEO_ENDPOINT}/capture/${captureId}`);
    
    success('Retrieved capture status', response.data);
    return response.data;
  } catch (error) {
    failure(`Failed to get status for capture ID ${captureId}`, error);
    return null;
  }
}

// Function to get all captures
async function getAllCaptures() {
  section('Getting All Captures');
  
  try {
    const response = await axios.get(`${VIDEO_ENDPOINT}/capture`);
    
    if (response.data.captures && response.data.captures.length > 0) {
      success(`Found ${response.data.captures.length} captures`, response.data);
    } else {
      console.log(colors.yellow + '⚠ ' + colors.reset + 'No captures found');
    }
    
    return response.data;
  } catch (error) {
    failure('Failed to get captures', error);
    return null;
  }
}

// Function to stop a video capture
async function stopCapture(captureId) {
  section(`Stopping Capture (ID: ${captureId})`);
  
  try {
    const response = await axios.delete(`${VIDEO_ENDPOINT}/capture/${captureId}`);
    
    success('Capture stopped', response.data);
    return response.data;
  } catch (error) {
    failure(`Failed to stop capture ID ${captureId}`, error);
    return null;
  }
}

// Function to list video files
async function listVideoFiles() {
  section('Listing Video Files');
  
  try {
    const response = await axios.get(`${VIDEO_ENDPOINT}/files`);
    
    if (response.data.files && response.data.files.length > 0) {
      success(`Found ${response.data.files.length} video files`, response.data);
    } else {
      console.log(colors.yellow + '⚠ ' + colors.reset + 'No video files found');
    }
    
    return response.data;
  } catch (error) {
    failure('Failed to list video files', error);
    return null;
  }
}

// Main test function
async function runTests() {
  console.log(colors.bright + colors.magenta + '\nVIDEO CAPTURE MODULE TEST' + colors.reset);
  console.log(colors.magenta + new Date().toISOString() + colors.reset + '\n');
  
  const testResults = {
    captureId: null,
    captureStarted: false,
    status: null,
    allCaptures: null,
    stopped: null,
    videoFiles: null
  };
  
  // Step 1: Start a video capture
  testResults.captureId = await startVideoCapture();
  testResults.captureStarted = !!testResults.captureId;
  
  // Only continue with other tests if capture was started
  if (testResults.captureStarted) {
    // Step 2: Get capture status
    testResults.status = await getCaptureStatus(testResults.captureId);
    
    // Step 3: Get all captures
    testResults.allCaptures = await getAllCaptures();
    
    // Step 4: Wait for a moment to allow capture to proceed
    console.log(`\n${colors.yellow}Waiting for 2 seconds to allow capture to process...${colors.reset}`);
    await wait(2000);
    
    // Step 5: Get updated status
    testResults.status = await getCaptureStatus(testResults.captureId);
    
    // Step 6: Stop the capture if it's still running
    if (testResults.status && !testResults.status.completed) {
      testResults.stopped = await stopCapture(testResults.captureId);
    } else {
      console.log(colors.yellow + 'Capture already completed, skipping stop test.' + colors.reset);
    }
    
    // Step 7: Wait for files to be written
    console.log(`\n${colors.yellow}Waiting for 1 second to ensure files are written...${colors.reset}`);
    await wait(1000);
    
    // Step 8: List video files
    testResults.videoFiles = await listVideoFiles();
  } else {
    console.log(colors.yellow + 'Skipping remaining tests as capture failed to start.' + colors.reset);
  }
  
  // Print summary
  section('TEST SUMMARY');
  console.log(colors.bright + 'Capture Started: ' + (testResults.captureStarted ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  
  if (testResults.captureStarted) {
    console.log(colors.bright + 'Capture ID: ' + colors.cyan + testResults.captureId + colors.reset);
  }
  
  console.log(colors.bright + 'Status Check: ' + (testResults.status ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  
  if (testResults.status) {
    console.log(`  └─ Path: ${colors.cyan}${testResults.status.path}${colors.reset}`);
    console.log(`  └─ Completed: ${testResults.status.completed ? colors.green + 'Yes' : colors.yellow + 'No'}${colors.reset}`);
    if (testResults.status.error) {
      console.log(`  └─ Error: ${colors.red}${testResults.status.error}${colors.reset}`);
    }
  }
  
  console.log(colors.bright + 'All Captures List: ' + (testResults.allCaptures ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  if (testResults.allCaptures && testResults.allCaptures.captures) {
    console.log(`  └─ Captures found: ${testResults.allCaptures.captures.length}`);
  }
  
  console.log(colors.bright + 'Stop Capture: ' + 
    (!testResults.captureStarted ? colors.yellow + 'SKIPPED' :
      testResults.stopped ? colors.green + 'SUCCESS' :
      testResults.status && testResults.status.completed ? colors.yellow + 'SKIPPED (already completed)' :
      colors.red + 'FAILED') + colors.reset);
  
  console.log(colors.bright + 'Video Files List: ' + (testResults.videoFiles ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  if (testResults.videoFiles && testResults.videoFiles.files) {
    console.log(`  └─ Files found: ${testResults.videoFiles.files.length}`);
    if (testResults.videoFiles.files.length > 0) {
      console.log(`  └─ Files: ${colors.cyan}${testResults.videoFiles.files.join(', ')}${colors.reset}`);
    }
  }
  
  // Check if our test file was created
  if (testResults.videoFiles && 
      testResults.videoFiles.files && 
      testResults.videoFiles.files.includes(TEST_VIDEO_FILENAME)) {
    console.log('\n' + colors.green + '✓ ' + colors.reset + 
                `Test file "${TEST_VIDEO_FILENAME}" was successfully created!`);
  } else if (testResults.captureStarted) {
    console.log('\n' + colors.yellow + '⚠ ' + colors.reset + 
                `Test file "${TEST_VIDEO_FILENAME}" was not found in the file list. ` +
                `It may still be processing or there might be an issue with file permissions.`);
  }
}

// Run all tests
runTests().catch(error => {
  console.error(colors.red + 'Test execution failed:' + colors.reset, error);
});