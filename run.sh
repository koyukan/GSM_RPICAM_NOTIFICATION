#!/bin/bash
# GSM RPICAM HASS add-on startup script

# Enable error handling
set -e

# Print section header
print_section() {
    echo ""
    echo "==============================================================" 
    echo "  $1"
    echo "=============================================================="
}

# Check if debug mode is enabled
if bashio::config.true 'debug_mode'; then
    export DEBUG="true"
    echo "Debug mode enabled"
    set -x  # Enable command tracing
fi

print_section "Setting up environment"

# Create necessary directories
CONFIG_DIR="/data"
CREDENTIALS_FILE="${CONFIG_DIR}/google-credentials.json"
VIDEO_DIR=$(bashio::config 'video_directory')

# Ensure video directory exists
if [ ! -d "$VIDEO_DIR" ]; then
    echo "Creating video directory: ${VIDEO_DIR}"
    mkdir -p "$VIDEO_DIR"
    chmod 755 "$VIDEO_DIR"
fi

# Handle Google credentials
if bashio::config.has_value 'google_credentials'; then
    echo "Setting up Google service account credentials..."
    echo "$(bashio::config 'google_credentials')" > "${CREDENTIALS_FILE}"
    chmod 600 "${CREDENTIALS_FILE}"
else
    echo "Warning: No Google credentials provided. Google Drive uploads will not work."
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

# ------------------------------------------------------------------------------------------------
# Set up GSM Modem
# ------------------------------------------------------------------------------------------------
print_section "Setting up GSM Modem"

# Start D-Bus system bus if not already running
if [ ! -e /var/run/dbus/pid ]; then
    echo "Starting D-Bus system daemon..."
    dbus-daemon --system
    sleep 2
fi

# Start ModemManager
echo "Starting ModemManager in debug mode..."
ModemManager --debug &
sleep 2

# Check for GSM modem
echo "Checking for GSM modems..."
mmcli -L
if [ $? -ne 0 ]; then
    echo "Warning: GSM modem not detected with mmcli. SMS and GPS features may not work correctly."
else
    echo "GSM modem detected!"
    
    # If wait for GPS is enabled, try to get a location lock
    if bashio::config.true 'wait_for_gps'; then
        echo "Waiting for GPS location lock (timeout: $(bashio::config 'gps_timeout') seconds)..."
        # Get first modem in list
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
                    echo "GPS location acquired: $lat, $lon"
                    location_found=true
                    break
                fi
                
                echo "Waiting for GPS lock... ($count/$TIMEOUT seconds)"
                count=$((count + 5))
                sleep 5
            done
            
            if [ "$location_found" = false ]; then
                echo "Warning: Could not acquire GPS location within timeout period. Continuing without location lock."
            fi
        else
            echo "Warning: No modem index found. Cannot initialize GPS."
        fi
    fi
fi

# ------------------------------------------------------------------------------------------------
# Set up Raspberry Pi Camera
# ------------------------------------------------------------------------------------------------
print_section "Setting up Raspberry Pi Camera"

# Configure camera timeout
echo "=== Configuring camera timeout ===" && date
CONFIG_FILE="/usr/share/libcamera/pipeline/rpi/vc4/rpi_apps.yaml"
if [ -f "$CONFIG_FILE" ]; then
    # Make a backup of the original file
    cp -f "$CONFIG_FILE" "${CONFIG_FILE}.backup"
fi

# Copy the timeout.yaml to the libcamera config location
if [ -f "/app/timeout.yaml" ]; then
    echo "Using custom timeout.yaml"
    cp -f "/app/timeout.yaml" "$CONFIG_FILE"
    echo "Configuration applied successfully"
else
    echo "Warning: Could not find timeout.yaml"
fi

# Check if camera device exists
if [ -e /dev/video0 ]; then
    echo "Camera device found at /dev/video0"
else
    echo "Warning: No camera device found at /dev/video0. Video capture may not work."
fi

# Check for additional camera interfaces
if [ -e /dev/vchiq ]; then
    echo "Raspberry Pi camera interface found at /dev/vchiq"
    # Fix permissions
    chmod 0660 /dev/vchiq
    chmod 0660 /dev/vcsm-cma 2>/dev/null || true
else
    echo "Warning: Raspberry Pi camera interface not found at /dev/vchiq. Legacy camera functionality may not work."
fi

# Make sure the Python script directory exists and has proper permissions
if [ -d "/app/python" ]; then
    echo "Setting permissions for Python scripts..."
    chmod -R 755 /app/python
    
    # Check if video_handler.py exists
    if [ -f "/app/python/video_handler.py" ]; then
        chmod +x "/app/python/video_handler.py"
        echo "Found and made executable: video_handler.py"
    fi
else
    echo "Warning: Python script directory not found at /app/python"
fi

# ------------------------------------------------------------------------------------------------
# Start the Node.js application
# ------------------------------------------------------------------------------------------------
print_section "Starting Node.js Application"

echo "Starting application at $(date)"
cd /app
node build/index.js