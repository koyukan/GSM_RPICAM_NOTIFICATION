# GSM RPICAM HASS Add-on

## Overview

This add-on integrates Raspberry Pi camera functionality with GSM capabilities to provide security monitoring for remote locations with limited internet connectivity. When triggered, it captures video, uploads it to Google Drive, and sends SMS notifications with GPS location information.

## Features

- **Video Capture**: Record video from Raspberry Pi Camera Module
- **Google Drive Integration**: Upload videos to Google Drive for storage
- **SMS Notifications**: Send alerts via SMS with video links
- **GPS Location**: Include GPS coordinates in notifications
- **Resumable Uploads**: Handle slow or unreliable connections
- **Early Notifications**: Option to send alerts before upload completes
- **Progress Tracking**: Monitor upload progress in real-time

## Installation

1. Add this repository to your Home Assistant instance
2. Install the "GSM RPICAM HASS" add-on
3. Configure the add-on as described below
4. Start the add-on

## Requirements

- Raspberry Pi with Home Assistant OS
- Raspberry Pi Camera Module
- GSM modem with SIM card (supports SMS and GPS)
- Google account with Google Drive
- Google Cloud Platform project with Drive API enabled

## Configuration

```yaml
google_credentials: ""           # Google service account credentials JSON
folder_id: "videos"              # Google Drive folder ID
video_directory: "/share/gsm_rpicam_videos"  # Local video storage path
debug_mode: false                # Enable detailed logging
send_early_notification: true    # Send SMS before upload completes
include_location: true           # Include GPS location in SMS
wait_for_gps: false              # Wait for GPS location at startup
gps_timeout: 30                  # Max seconds to wait for GPS fix
```

### Google Drive Setup

1. Create a Google Cloud Platform project
2. Enable the Google Drive API
3. Create a service account with Drive access
4. Download service account credentials JSON
5. Copy the contents of the JSON file into the `google_credentials` field
6. Create a folder in Google Drive and get its ID from the URL
7. Add the folder ID to the `folder_id` field

## Usage

### API Endpoints

The add-on exposes the following API endpoints:

- `POST /api/trigger/start`: Start recording and upload process
  ```json
  {
    "phoneNumber": "+1234567890",
    "videoDuration": 10000,
    "sendEarlyNotification": true,
    "videoFilename": "custom_name.h264"
  }
  ```

- `GET /api/trigger/:id`: Get status of a specific trigger
- `GET /api/trigger/upload/:id`: Get detailed status of a specific upload
- `GET /api/trigger/uploads`: List all uploads
- `DELETE /api/trigger/upload/:id`: Cancel an ongoing upload

### Automation Examples

#### Trigger on Motion Detection

```yaml
automation:
  - alias: "Motion Detection Recording"
    trigger:
      platform: state
      entity_id: binary_sensor.motion_sensor
      to: 'on'
    action:
      - service: rest_command.start_recording
        data:
          phoneNumber: "+1234567890"
          videoDuration: 15000
```

#### Define REST Command

```yaml
rest_command:
  start_recording:
    url: http://localhost:8000/api/trigger/start
    method: POST
    content_type: 'application/json'
    payload: '{"phoneNumber":"{{ phoneNumber }}","videoDuration":{{ videoDuration }}}'
```

## GPS Location Format

When GPS data is available, the add-on includes a Google Maps link in SMS notifications:

```
Alert: Motion detected. View recording at: [RECORDING_LINK]

Location: https://www.google.com/maps/search/?api=1&query=12.3456,-65.4321
```

If GPS data is not available, the message will indicate:

```
Location: Not available
```

## Advanced Configuration Options

### Early Notifications

When `send_early_notification` is enabled, the SMS is sent as soon as the video is recorded, before the upload starts. This ensures the user receives a notification even if the upload takes a long time or fails:

```
Alert: Motion detected. Video is being uploaded, link will be active soon.

Location: https://www.google.com/maps/search/?api=1&query=12.3456,-65.4321
```

### GPS Configuration

- `include_location`: Include GPS coordinates in SMS notifications
- `wait_for_gps`: Wait for a valid GPS fix during startup
- `gps_timeout`: Maximum seconds to wait for GPS (1-120)

## Troubleshooting

### SMS Issues

If SMS notifications are not working:

1. Check the GSM modem is properly connected
2. Verify the SIM card has credit and is activated
3. Check that `/dev/ttyUSB0` is available
4. Ensure the modem supports the `mmcli` command

### Upload Issues

If uploads are failing:

1. Verify Google credentials are correct
2. Check that internet connection is available
3. Check add-on logs for specific error messages
4. Try a smaller video duration for testing

### GPS Issues

If GPS location is not available:

1. Ensure the GSM modem supports GPS functionality
2. Move the device to a location with better GPS reception
3. Allow more time for GPS acquisition
4. Check if the SIM plan includes GPS/location services

## Technical Details

### File Structure

- Videos are stored in the configured `video_directory`
- Each trigger creates a uniquely named video file
- Upload status is tracked in memory and available via API
- Google Drive credentials are securely stored in `/data/google-credentials.json`

### Resource Usage

- CPU: Moderate during video recording and file processing
- Memory: Typically 100-200MB depending on configuration
- Storage: Depends on video length and quality

### Network Usage

- Upload bandwidth: Depends on video size
- GSM data: Minimal, used only for upload
- SMS: One message per trigger event

## Support

For issues, questions, or feature requests, please create an issue in the GitHub repository.

## License

This add-on is licensed under the [MIT License](LICENSE).

## Acknowledgments

- Based on the [Home Assistant Add-on SDK](https://developers.home-assistant.io/docs/add-ons)
- Uses the [ModemManager](https://www.freedesktop.org/wiki/Software/ModemManager/) CLI for GSM functionality
- Utilizes the [Google Drive API](https://developers.google.com/drive) for cloud storage