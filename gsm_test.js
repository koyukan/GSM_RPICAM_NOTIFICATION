const axios = require('axios');

// Configuration
const BASE_URL = 'http://192.168.2.174:8000/api';
const GSM_ENDPOINT = `${BASE_URL}/gsm`;
const TEST_PHONE_NUMBER = '+905559967545'; // Replace with a valid test phone number
const TEST_MESSAGE = 'Test message from API test script';

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

// Function to initialize GSM modem
async function initializeModem() {
  section('Initializing GSM Modem');
  try {
    const response = await axios.post(`${GSM_ENDPOINT}/init`);
    success('GSM modem initialized', response.data);
    return true;
  } catch (error) {
    failure('Failed to initialize GSM modem', error);
    return false;
  }
}

// Function to get modem status
async function getModemStatus() {
  section('Getting GSM Modem Status');
  try {
    const response = await axios.get(`${GSM_ENDPOINT}/status`);
    success('Retrieved modem status', response.data);
    return response.data;
  } catch (error) {
    failure('Failed to get modem status', error);
    return null;
  }
}

// Function to get GPS location
async function getGPSLocation() {
  section('Getting GPS Location');
  try {
    const response = await axios.get(`${GSM_ENDPOINT}/location`);
    
    if (response.data.location.available) {
      success('Retrieved location data', response.data);
    } else {
      console.log(colors.yellow + '⚠ ' + colors.reset + 'Location data not yet available');
      console.log('  ' + colors.cyan + 'Data:' + colors.reset, JSON.stringify(response.data, null, 2));
    }
    
    return response.data;
  } catch (error) {
    failure('Failed to get location data', error);
    return null;
  }
}

// Function to list SMS messages
async function listSMS() {
  section('Listing SMS Messages');
  try {
    const response = await axios.get(`${GSM_ENDPOINT}/sms`);
    
    if (response.data.ids.length > 0) {
      success(`Found ${response.data.ids.length} SMS messages`, response.data);
    } else {
      console.log(colors.yellow + '⚠ ' + colors.reset + 'No SMS messages found');
    }
    
    return response.data;
  } catch (error) {
    failure('Failed to list SMS messages', error);
    return null;
  }
}

// Function to read an SMS message
async function readSMS(smsId) {
  section(`Reading SMS Message (ID: ${smsId})`);
  try {
    const response = await axios.get(`${GSM_ENDPOINT}/sms/${smsId}`);
    success('Read SMS message', response.data);
    return response.data;
  } catch (error) {
    failure(`Failed to read SMS message with ID ${smsId}`, error);
    return null;
  }
}

// Function to send an SMS message
async function sendSMS(number, text) {
  section('Sending SMS Message');
  console.log(`Sending message to ${number}: "${text}"`);
  
  try {
    const response = await axios.post(`${GSM_ENDPOINT}/sms`, {
      number,
      text
    });
    
    success('SMS message sent', response.data);
    return response.data;
  } catch (error) {
    failure('Failed to send SMS message', error);
    return null;
  }
}

// Main test function
async function runTests() {
  console.log(colors.bright + colors.cyan + '\nGSM/GPS MODULE TEST' + colors.reset);
  console.log(colors.cyan + new Date().toISOString() + colors.reset + '\n');
  
  const testResults = {
    initialization: false,
    status: null,
    location: null,
    smsList: null,
    smsRead: null,
    smsSend: null
  };
  
  // Step 1: Initialize the modem
  testResults.initialization = await initializeModem();
  
  // Only continue with other tests if initialization was successful
  if (testResults.initialization) {
    // Step 2: Get modem status
    testResults.status = await getModemStatus();
    
    // Step 3: Get location
    testResults.location = await getGPSLocation();
    
    // Step 4: List SMS messages
    testResults.smsList = await listSMS();
    
    // Step 5: Read an SMS message if any exist
    if (testResults.smsList && testResults.smsList.ids.length > 0) {
      // Read the first SMS
      testResults.smsRead = await readSMS(testResults.smsList.ids[0]);
    } else {
      console.log(colors.yellow + 'Skipping SMS read test as no messages were found.' + colors.reset);
    }
    
    // Step 6: Send an SMS message
    testResults.smsSend = await sendSMS(TEST_PHONE_NUMBER, TEST_MESSAGE);
  } else {
    console.log(colors.yellow + 'Skipping remaining tests as modem initialization failed.' + colors.reset);
  }
  
  // Print summary
  section('TEST SUMMARY');
  console.log(colors.bright + 'Initialization: ' + (testResults.initialization ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  console.log(colors.bright + 'Status Check: ' + (testResults.status ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  console.log(colors.bright + 'GPS Location: ' + (testResults.location ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  
  if (testResults.location && testResults.location.location) {
    const loc = testResults.location.location;
    if (loc.available) {
      console.log(`  └─ Coordinates: ${loc.latitude}, ${loc.longitude}`);
    } else {
      console.log('  └─ ' + colors.yellow + 'Location data not yet available' + colors.reset);
    }
  }
  
  console.log(colors.bright + 'SMS List: ' + (testResults.smsList ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
  if (testResults.smsList) {
    console.log(`  └─ Messages found: ${testResults.smsList.ids.length}`);
  }
  
  console.log(colors.bright + 'SMS Read: ' + (testResults.smsRead ? colors.green + 'SUCCESS' : 
    testResults.smsList && testResults.smsList.ids.length === 0 ? colors.yellow + 'SKIPPED' : colors.red + 'FAILED') + colors.reset);
  
  console.log(colors.bright + 'SMS Send: ' + (testResults.smsSend ? colors.green + 'SUCCESS' : colors.red + 'FAILED') + colors.reset);
}

// Run all tests
runTests().catch(error => {
  console.error(colors.red + 'Test execution failed:' + colors.reset, error);
});