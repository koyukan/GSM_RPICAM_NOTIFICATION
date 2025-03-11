#!/usr/bin/with-contenv bashio

bashio::log.info "Starting GSM RPICAM HASS server..."

# Create necessary directories
CONFIG_DIR="/data"
CREDENTIALS_FILE="${CONFIG_DIR}/google-credentials.json"
VIDEO_DIR=$(bashio::config 'video_directory')

# Ensure video directory exists
if [ ! -d "$VIDEO_DIR" ]; then
    bashio::log.info "Creating video directory: ${VIDEO_DIR}"
    mkdir -p "$VIDEO_DIR"
    chmod 755 "$VIDEO_DIR"
fi

# Handle Google credentials
if bashio::config.has_value 'google_credentials'; then
    bashio::log.info "Setting up Google service account credentials..."
    echo "$(bashio::config 'google_credentials')" > "${CREDENTIALS_FILE}"
    chmod 600 "${CREDENTIALS_FILE}"
else
    bashio::log.warning "No Google credentials provided. Google Drive uploads will not work."
    echo "{}" > "${CREDENTIALS_FILE}"
fi

# Set environment variables
export NODE_ENV="production"
export PORT="3000"
export GOOGLE_APPLICATION_CREDENTIALS="${CREDENTIALS_FILE}"
export GOOGLE_DRIVE_FOLDER_ID="$(bashio::config 'folder_id')"
export VIDEO_DIRECTORY="${VIDEO_DIR}"
export SMS_SEND_EARLY_NOTIFICATION="$(bashio::config 'send_early_notification')"
export SMS_INCLUDE_LOCATION="$(bashio::config 'include_location')"
export GPS_WAIT_FOR_LOCATION="$(bashio::config 'wait_for_gps')"
export GPS_LOCATION_TIMEOUT="$(bashio::config 'gps_timeout')"
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"

# Set debug flag if specified in add-on configuration
if bashio::config.true 'debug_mode'; then
    export DEBUG="true"
    bashio::log.info "Debug mode enabled"
fi

# Check for USB devices
bashio::log.info "Checking for GSM modem USB device..."
ls -l /dev/ttyUSB* || bashio::log.warning "No USB devices found at /dev/ttyUSB*"

# Run D-Bus and ModemManager setup script
bashio::log.info "Setting up D-Bus and ModemManager..."
bash /app/scripts/dbus-setup.sh

# Check for camera
bashio::log.info "Checking for camera..."
if [ -e /dev/video0 ]; then
    bashio::log.info "Camera device found at /dev/video0"
    bashio::log.info "Permissions for camera devices:"
    ls -la /dev/video0 || true

    
else
    bashio::log.warning "No camera device found at /dev/video0. Video capture may not work."
    # Check if the bcm2835-v4l2 module needs to be loaded
    if [ -f "/proc/device-tree/model" ] && grep -q "Raspberry Pi" "/proc/device-tree/model"; then
        bashio::log.info "Attempting to load bcm2835-v4l2 module for Raspberry Pi camera..."
        modprobe bcm2835-v4l2 || true
        sleep 2
        if [ -e /dev/video0 ]; then
            bashio::log.info "Camera device now available at /dev/video0"
        else
            bashio::log.warning "Still no camera device after loading module."
        fi
    fi
fi

# Configure camera timeout
bashio::log.info "Configuring camera timeout..."
CONFIG_FILE="/usr/share/libcamera/pipeline/rpi/vc4/rpi_apps.yaml"
if [ -f "$CONFIG_FILE" ]; then
    # Make a backup of the original file
    cp -f "$CONFIG_FILE" "${CONFIG_FILE}.backup"
fi

# Copy the timeout.yaml to the libcamera config location
if [ -f "/app/timeout.yaml" ]; then
    bashio::log.info "Using custom timeout.yaml"
    cp -f "/app/timeout.yaml" "$CONFIG_FILE"
    bashio::log.info "Camera timeout configuration applied successfully"
else
    bashio::log.warning "Could not find timeout.yaml"
fi

# Check rpicam-vid command
if command -v rpicam-vid &> /dev/null; then
    bashio::log.info "rpicam-vid command found"
else
    bashio::log.warning "rpicam-vid command not found. This add-on requires the Raspberry Pi camera stack."
fi

# Make sure Python scripts are executable
if [ -d "/app/python" ]; then
    bashio::log.info "Setting permissions for Python scripts..."
    chmod -R 755 /app/python
    
    # Check if video_handler.py exists
    if [ -f "/app/python/video_handler.py" ]; then
        chmod +x "/app/python/video_handler.py"
        bashio::log.info "Found and made executable: video_handler.py"
    fi
else
    bashio::log.warning "Python script directory not found at /app/python"
fi

# Start the application
bashio::log.info "Starting application..."
cd /app

# Copy the config.js file to the proper location if it's not already there
if [ -f "/app/config.ts" ] && [ ! -f "/app/config.js" ]; then
    bashio::log.info "Generating config.js from config.ts..."
    npx -y tsc /app/config.ts --outDir /app || true
fi

# Check where the build output is located
if [ -f "/app/dist/index.js" ]; then
    bashio::log.info "Found application at /app/dist/index.js"
    NODE_ENV=production node -r ./config.js ./dist
elif [ -f "/app/build/index.js" ]; then
    bashio::log.info "Found application at /app/build/index.js"
    NODE_ENV=production node -r ./config.js ./build
else
    # List all files to help diagnose
    bashio::log.warning "Could not find application entry point. Listing directories:"
    ls -la /app
    ls -la /app/dist || true
    ls -la /app/build || true
    
    # Try to run using the main field from package.json
    MAIN_FILE=$(node -e "console.log(require('./package.json').main || '')")
    if [ -n "$MAIN_FILE" ] && [ -f "/app/$MAIN_FILE" ]; then
        bashio::log.info "Found main file defined in package.json: $MAIN_FILE"
        node "/app/$MAIN_FILE"
    else
        bashio::log.error "Could not find application entry point. Application will not start."
        exit 1
    fi
fi