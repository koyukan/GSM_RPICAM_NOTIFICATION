const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const TRIGGER_ENDPOINT = `${BASE_URL}/trigger`;
const TEST_PHONE_NUMBER = '+905559967545'; // Replace with a valid test phone number
const TEST_DURATION = 5000; // 5 seconds

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

// Function to start a trigger flow
async function startTriggerFlow() {
  section('Starting Trigger Flow');
  console.log(`Initiating video capture (${TEST_DURATION}ms) and notification to ${TEST_PHONE_NUMBER}...`);
  
  try {
    const response = await axios.post(`${TRIGGER_ENDPOINT}/start`, {
      videoDuration: TEST_DURATION,
      phoneNumber: TEST_PHONE_NUMBER,
      customMessage: 'Test alert! View your video at: ',
    });
    
    success('Trigger flow started', response.data);
    return response.data.triggerId;
  } catch (error) {
    failure('Failed to start trigger flow', error);
    return null;
  }
}

// Function to check trigger status
async function checkTriggerStatus(triggerId) {
  section(`Checking Trigger Status (ID: ${triggerId})`);
  
  try {
    const response = await axios.get(`${TRIGGER_ENDPOINT}/${triggerId}`);
    
    success('Retrieved trigger status', response.data);
    return response.data;
  } catch (error) {
    failure(`Failed to get status for trigger ID ${triggerId}`, error);
    return null;
  }
}

// Function to poll trigger status until completion
async function pollTriggerStatus(triggerId, maxWaitTime = 120000) {
  section(`Polling Trigger Status Until Completion (ID: ${triggerId})`);
  
  const pollInterval = 5000; // 5 seconds
  let elapsedTime = 0;
  let status = null;
  
  console.log(`Will poll every ${pollInterval/1000} seconds for up to ${maxWaitTime/1000} seconds...`);
  
  while (elapsedTime < maxWaitTime) {
    status = await checkTriggerStatus(triggerId);
    
    if (!status) {
      failure('Failed to get trigger status');
      return null;
    }
    
    if (status.completed) {
      success('Trigger flow completed', status);
      return status;
    }
    
    console.log(colors.yellow + `Current step: ${status.currentStep}. Waiting ${pollInterval/1000} seconds...` + colors.reset);
    await wait(pollInterval);
    elapsedTime += pollInterval;
  }
  
  failure(`Timeout waiting for trigger ${triggerId} to complete`);
  return status;
}

// Main test function
async function runTests() {
  console.log(colors.bright + colors.cyan + '\nTRIGGER FLOW TEST' + colors.reset);
  console.log(colors.cyan + new Date().toISOString() + colors.reset + '\n');
  
  const triggerId = await startTriggerFlow();
  
  if (triggerId) {
    // Wait a moment before polling
    await wait(2000);
    
    // Monitor the process until completion
    const finalStatus = await pollTriggerStatus(triggerId);
    
    // Print final summary
    section('TEST SUMMARY');
    
    if (finalStatus) {
      if (finalStatus.error) {
        console.log(colors.bright + 'Trigger Flow: ' + colors.red + 'FAILED' + colors.reset);
        console.log(`  └─ Error: ${colors.red}${finalStatus.error}${colors.reset}`);
      } else if (finalStatus.completed) {
        console.log(colors.bright + 'Trigger Flow: ' + colors.green + 'SUCCESS' + colors.reset);
        
        if (finalStatus.videoStatus) {
          console.log(`  └─ Video: ${colors.green}Recorded${colors.reset} (${finalStatus.videoStatus.path})`);
        }
        
        if (finalStatus.uploadedFileLink) {
          console.log(`  └─ Upload: ${colors.green}Successful${colors.reset}`);
          console.log(`      └─ Link: ${colors.cyan}${finalStatus.uploadedFileLink}${colors.reset}`);
        }
        
        if (finalStatus.smsStatus === true) {
          console.log(`  └─ SMS: ${colors.green}Sent${colors.reset} to ${TEST_PHONE_NUMBER}`);
        } else {
          console.log(`  └─ SMS: ${colors.red}Failed${colors.reset}`);
        }
      } else {
        console.log(colors.bright + 'Trigger Flow: ' + colors.yellow + 'INCOMPLETE' + colors.reset);
        console.log(`  └─ Current step: ${colors.yellow}${finalStatus.currentStep}${colors.reset}`);
      }
    } else {
      console.log(colors.bright + 'Trigger Flow: ' + colors.red + 'UNKNOWN' + colors.reset);
      console.log(`  └─ Could not retrieve final status`);
    }
  }
}

// Run the test
runTests().catch(error => {
  console.error(colors.red + 'Test execution failed:' + colors.reset, error);
});