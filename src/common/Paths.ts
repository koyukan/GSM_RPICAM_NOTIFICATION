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
  },
  GSM: {
    Base: '/gsm',
    Initialize: '/init',
    Status: '/status',
    Location: '/location',
    SMS: '/sms',
    ReadSMS: '/sms/:id',
  },
} as const;