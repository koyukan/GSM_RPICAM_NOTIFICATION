export default {
  Base: '/api',
  Users: {
    Base: '/users',
    Get: '/all',
    Add: '/add',
    Update: '/update',
    Delete: '/delete/:id',
  },
  GoogleDrive: {
    Base: '/drive',
    UploadPath: '/upload/path',
    UploadFile: '/upload/file',
    Start: '/start',
    Status: '/status/:id',
    All: '/all',
    Cancel: '/cancel/:id',
  },
  GSM: {
    Base: '/gsm',
    Initialize: '/init',
    Status: '/status',
    Location: '/location',
    SMS: '/sms',
    ReadSMS: '/sms/:id',
  },
  Video: {
    Base: '/video',
    Capture: '/capture',
    CaptureById: '/capture/:id',
    Files: '/files',
  },
  Trigger: {
    Base: '/trigger',
    Start: '/start',
    Status: '/:id',
    All: '/',
  },
} as const;