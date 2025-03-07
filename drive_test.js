const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const DRIVE_ENDPOINT = `${BASE_URL}/drive`;
const TEST_FILE_PATH = 'videos/timeline.mp4';
const TEST_FILE_NAME = 'my-video.mp4';

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

// Start upload async
async function startAsyncUpload() {
  section('Starting Asynchronous Upload');
  
  // Check if test file exists
  if (!fs.existsSync(TEST_FILE_PATH)) {
    console.log(colors.yellow + `Test file ${TEST_FILE_PATH} doesn't exist. Creating a dummy file...` + colors.reset);
    
    // Create directory if it doesn't exist
    const dir = path.dirname(TEST_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create a 10MB dummy file for testing
    const buffer = Buffer.alloc(10 * 1024 * 1024, 'a');
    fs.writeFileSync(TEST_FILE_PATH, buffer);
    console.log(colors.green + `Created dummy 10MB file at ${TEST_FILE_PATH}` + colors.reset);
  }
  
  try {
    const response = await axios.post(`${DRIVE_ENDPOINT}/start`, {
      filePath: TEST_FILE_PATH,
      fileName: TEST_FILE_NAME
    });
    
    success('Async upload started successfully', response.data);
    return response.data.uploadId;
  } catch (error) {
    failure('Failed to start async upload', error);
    return null;
  }
}

// Check upload status
async function checkUploadStatus(uploadId) {
  section(`Checking Upload Status (ID: ${uploadId})`);
  
  try {
    const response = await axios.get(`${DRIVE_ENDPOINT}/status/${uploadId}`);
    success('Retrieved upload status', response.data);
    return response.data;
  } catch (error) {
    failure(`Failed to get status for upload ID ${uploadId}`, error);
    return null;
  }
}

// Poll for upload completion
async function pollUploadStatus(uploadId, maxPolls = 30, pollInterval = 2000) {
  section(`Polling Upload Status Until Completion (ID: ${uploadId})`);
  console.log(`Will poll every ${pollInterval/1000} seconds for up to ${maxPolls} times...`);
  
  let polls = 0;
  let status = null;
  
  while (polls < maxPolls) {
    polls++;
    
    status = await checkUploadStatus(uploadId);
    if (!status) {
      failure(`Failed to get status on poll ${polls}`);
      return null;
    }
    
    console.log(`Poll ${polls}: Status is "${status.status}", Progress: ${status.percentComplete}%`);
    
    if (status.status === 'completed') {
      success('Upload completed!', {
        fileId: status.fileId,
        webViewLink: status.webViewLink,
        directDownloadLink: status.directDownloadLink
      });
      return status;
    } else if (status.status === 'failed') {
      failure(`Upload failed: ${status.error}`);
      return status;
    } else if (status.status === 'canceled') {
      console.log(colors.yellow + 'Upload was canceled' + colors.reset);
      return status;
    }
    
    // Progress bar
    const progressBar = '[' + '='.repeat(Math.floor(status.percentComplete / 5)) + 
                         ' '.repeat(20 - Math.floor(status.percentComplete / 5)) + ']';
    console.log(`${progressBar} ${status.percentComplete}% (${Math.round(status.bytesUploaded / 1024 / 1024 * 100) / 100}MB / ${Math.round(status.bytesTotal / 1024 / 1024 * 100) / 100}MB)`);
    
    // Wait before next poll
    if (polls < maxPolls) {
      console.log(colors.yellow + `Waiting ${pollInterval/1000} seconds before next poll...` + colors.reset);
      await wait(pollInterval);
    }
  }
  
  failure(`Maximum polls (${maxPolls}) reached without completion`);
  return status;
}

// List all uploads
async function listAllUploads() {
  section('Listing All Uploads');
  
  try {
    const response = await axios.get(`${DRIVE_ENDPOINT}/all`);
    
    if (response.data.uploads && response.data.uploads.length > 0) {
      success(`Found ${response.data.uploads.length} uploads`, response.data);
    } else {
      console.log(colors.yellow + 'No uploads found' + colors.reset);
    }
    
    return response.data;
  } catch (error) {
    failure('Failed to list uploads', error);
    return null;
  }
}

// Try legacy upload method
async function tryLegacyUpload() {
  section('Testing Legacy Upload (Synchronous)');
  
  try {
    console.log('This may take a while for large files...');
    
    const response = await axios.post(`${DRIVE_ENDPOINT}/upload/path`, {
      filePath: TEST_FILE_PATH,
      fileName: 'legacy-' + TEST_FILE_NAME
    });
    
    success('Legacy upload completed successfully', response.data);
    console.log('Share link:', response.data.file.webViewLink);
    console.log('Direct download link:', response.data.file.directDownloadLink);
    
    return response.data;
  } catch (error) {
    failure('Legacy upload failed', error);
    return null;
  }
}

// Cancel an upload
async function cancelUpload(uploadId) {
  section(`Canceling Upload (ID: ${uploadId})`);
  
  try {
    const response = await axios.delete(`${DRIVE_ENDPOINT}/cancel/${uploadId}`);
    success('Upload canceled successfully', response.data);
    return response.data;
  } catch (error) {
    failure(`Failed to cancel upload ID ${uploadId}`, error);
    return null;
  }
}

// Main function
async function runTest() {
  console.log(colors.bright + colors.cyan + '\nGOOGLE DRIVE SERVICE TEST' + colors.reset);
  console.log(colors.cyan + new Date().toISOString() + colors.reset + '\n');
  
  // Step 1: List all existing uploads
  await listAllUploads();
  
  // Step 2: Start an async upload
  const uploadId = await startAsyncUpload();
  
  if (!uploadId) {
    failure('Test cannot continue without upload ID');
    return;
  }
  
  // Step 3: Poll for upload completion
  const finalStatus = await pollUploadStatus(uploadId);
  
  // Step 4: List all uploads again to see our completed upload
  await listAllUploads();
  
  // Step 5: Start another upload to test cancellation
  console.log('\n' + colors.bright + 'Testing upload cancellation...' + colors.reset);
  const cancelTestId = await startAsyncUpload();
  
  if (cancelTestId) {
    // Wait a moment to let the upload start
    await wait(2000);
    
    // Get status before cancellation
    await checkUploadStatus(cancelTestId);
    
    // Cancel the upload
    await cancelUpload(cancelTestId);
    
    // Verify cancellation
    await checkUploadStatus(cancelTestId);
  }
  
  // Step 6: Test legacy upload method
  await tryLegacyUpload();
  
  section('TEST SUMMARY');
  
  if (finalStatus) {
    if (finalStatus.status === 'completed') {
      console.log(colors.bright + 'Upload Test: ' + colors.green + 'SUCCESS' + colors.reset);
      console.log('File ID: ' + colors.cyan + finalStatus.fileId + colors.reset);
      console.log('Web View Link: ' + colors.cyan + finalStatus.webViewLink + colors.reset);
      console.log('Direct Download Link: ' + colors.cyan + finalStatus.directDownloadLink + colors.reset);
    } else {
      console.log(colors.bright + 'Upload Test: ' + colors.red + 'FAILED' + colors.reset);
      console.log('Final status: ' + colors.yellow + finalStatus.status + colors.reset);
      if (finalStatus.error) {
        console.log('Error: ' + colors.red + finalStatus.error + colors.reset);
      }
    }
  } else {
    console.log(colors.bright + 'Upload Test: ' + colors.red + 'FAILED' + colors.reset);
    console.log('Could not retrieve final status');
  }
}

// Run the test
runTest().catch(error => {
  console.error(colors.red + 'Test execution failed:' + colors.reset, error);
});