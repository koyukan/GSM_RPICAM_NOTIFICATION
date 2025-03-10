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

# Set debug flag if specified in add-on configuration
if bashio::config.true 'debug_mode'; then
    export DEBUG="true"
    bashio::log.info "Debug mode enabled"
fi

# Check for USB devices
bashio::log.info "Checking for GSM modem USB device..."
ls -l /dev/ttyUSB*
if [ $? -ne 0 ]; then
    bashio::log.warning "No USB devices found at /dev/ttyUSB*. GSM functionality may not work correctly."
fi

# Start D-Bus system bus if not already running
if [ ! -e /var/run/dbus/pid ]; then
    bashio::log.info "Starting D-Bus system daemon..."
    dbus-daemon --system
    sleep 2
fi

# Start ModemManager
bashio::log.info "Starting ModemManager in debug mode..."
ModemManager --debug &
sleep 2

# Check for camera
bashio::log.info "Checking for camera..."
if [ -e /dev/video0 ]; then
    bashio::log.info "Camera device found at /dev/video0"
else
    bashio::log.warning "No camera device found at /dev/video0. Video capture may not work."
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

# Test GSM module connection
bashio::log.info "Testing GSM module connection..."
mmcli -L
if [ $? -ne 0 ]; then
    bashio::log.warning "GSM modem not detected with mmcli. SMS and GPS features may not work correctly."
else
    bashio::log.info "GSM modem detected!"
    
    # If wait for GPS is enabled, try to get a location lock
    if bashio::config.true 'wait_for_gps'; then
        bashio::log.info "Waiting for GPS location lock (timeout: $(bashio::config 'gps_timeout') seconds)..."
        # Initialize modem first modem in list
        MODEM_INDEX=$(mmcli -L | grep -o "/org/freedesktop/ModemManager1/Modem/[0-9]" | head -1 | grep -o "[0-9]$")
        
        if [ -n "$MODEM_INDEX" ]; then
            # Enable the modem
            mmcli -m "$MODEM_INDEX" -e
            
            # Enable location
            mmcli -m "$MODEM_INDEX" --location-enable-gps-raw --location-enable-gps-nmea
            
            # Wait for GPS lock with timeout
            TIMEOUT=$(bashio::config 'gps_timeout')
            count=0
            location_found=false
            
            while [ $count -lt $TIMEOUT ]; do
                location_output=$(mmcli -m "$MODEM_INDEX" --location-get)
                if echo "$location_output" | grep -q "latitude" && ! echo "$location_output" | grep -q "latitude: --"; then
                    lat=$(echo "$location_output" | grep "latitude" | awk '{print $2}')
                    lon=$(echo "$location_output" | grep "longitude" | awk '{print $2}')
                    bashio::log.info "GPS location acquired: $lat, $lon"
                    location_found=true
                    break
                fi
                
                bashio::log.info "Waiting for GPS lock... ($count/$TIMEOUT seconds)"
                count=$((count + 5))
                sleep 5
            done
            
            if [ "$location_found" = false ]; then
                bashio::log.warning "Could not acquire GPS location within timeout period. Continuing without location lock."
            fi
        else
            bashio::log.warning "No modem index found. Cannot initialize GPS."
        fi
    fi
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
node build/index.js