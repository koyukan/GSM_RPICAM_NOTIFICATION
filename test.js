const axios = require('axios');

async function uploadFile() {
  try {
    const response = await axios.post('http://localhost:3000/api/drive/upload/path', {
      filePath: 'videos/timeline.mp4',
      fileName: 'my-video.mp4'
    });
    
    console.log('Upload successful:', response.data);
    console.log('Share link:', response.data.file.webViewLink);
  } catch (error) {
    console.error('Upload failed:', error.response?.data || error.message);
  }
}

uploadFile();