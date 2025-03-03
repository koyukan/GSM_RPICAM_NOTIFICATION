import supertest from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import app from '@src/server';
import HttpStatusCodes from '@src/common/HttpStatusCodes';
import Paths from 'spec/support/Paths';
import { getBoolEnv } from '@src/util/env';

// Type for API responses
interface UploadResponse {
  message: string;
  file: {
    id: string;
    name: string;
    webViewLink?: string;
    webContentLink?: string;
    directDownloadLink?: string;
  };
}

/**
 * Tests for Google Drive service
 * 
 * Note: These tests are designed to be skipped by default since they require
 * actual Google Drive authentication and will upload real files.
 * To run these tests, add a valid service account credentials file
 * and set proper environment variables.
 */
describe('GoogleDriveRouter', () => {
  const agent = supertest.agent(app);
  let tempFilePath: string;

  // Create a test file
  beforeEach(() => {
    // Skip test setup if tests are being skipped
    if (getBoolEnv('SKIP_GOOGLE_DRIVE_TESTS', true)) return;

    const tempDir = path.join(os.tmpdir(), 'drive-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    tempFilePath = path.join(tempDir, `test-file-${Date.now()}.txt`);
    fs.writeFileSync(tempFilePath, 'This is a test file for Google Drive upload');
  });

  // Clean up test file
  afterEach(() => {
    // Skip cleanup if tests are being skipped
    if (getBoolEnv('SKIP_GOOGLE_DRIVE_TESTS', true)) return;

    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  });

  // Test upload file from path
  describe(`"POST:${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadPath}"`, () => {
    // Skip tests by default
    beforeEach(() => {
      if (getBoolEnv('SKIP_GOOGLE_DRIVE_TESTS', true)) {
        pending('Skipping Google Drive tests. Set SKIP_GOOGLE_DRIVE_TESTS=false to run these tests.');
      }
    });

    it(`should return a status code of "${HttpStatusCodes.OK}" and file info if the upload was successful.`, async () => {
      const response = await agent
        .post(`${Paths.Base}${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadPath}`)
        .send({ 
          filePath: tempFilePath,
          fileName: 'test-upload.txt',
        });

      expect(response.status).toBe(HttpStatusCodes.OK);
      
      const responseBody = response.body as UploadResponse;
      
      expect(responseBody.message).toContain('successfully');
      expect(responseBody.file).toBeDefined();
      expect(responseBody.file.id).toBeDefined();
      expect(responseBody.file.webViewLink).toBeDefined();
    });

    it(`should return a status code of "${HttpStatusCodes.BAD_REQUEST}" if no file path is provided.`, async () => {
      const response = await agent
        .post(`${Paths.Base}${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadPath}`)
        .send({});

      expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
    });

    it(`should return a status code of "${HttpStatusCodes.NOT_FOUND}" if the file path does not exist.`, async () => {
      const response = await agent
        .post(`${Paths.Base}${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadPath}`)
        .send({ 
          filePath: '/non/existent/path.txt',
        });

      expect(response.status).toBe(HttpStatusCodes.NOT_FOUND);
    });
  });

  // Test upload file from form
  describe(`"POST:${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadFile}"`, () => {
    // Skip tests by default
    beforeEach(() => {
      if (getBoolEnv('SKIP_GOOGLE_DRIVE_TESTS', true)) {
        pending('Skipping Google Drive tests. Set SKIP_GOOGLE_DRIVE_TESTS=false to run these tests.');
      }
    });

    it(`should return a status code of "${HttpStatusCodes.OK}" and file info if the upload was successful.`, async () => {
      const response = await agent
        .post(`${Paths.Base}${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadFile}`)
        .attach('file', tempFilePath)
        .field('fileName', 'test-form-upload.txt');

      expect(response.status).toBe(HttpStatusCodes.OK);
      
      const responseBody = response.body as UploadResponse;
      
      expect(responseBody.message).toContain('successfully');
      expect(responseBody.file).toBeDefined();
      expect(responseBody.file.id).toBeDefined();
      expect(responseBody.file.webViewLink).toBeDefined();
    });

    it(`should return a status code of "${HttpStatusCodes.BAD_REQUEST}" if no file is provided.`, async () => {
      const response = await agent
        .post(`${Paths.Base}${Paths.GoogleDrive.Base}${Paths.GoogleDrive.UploadFile}`)
        .field('fileName', 'missing-file.txt');

      expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
    });
  });
});