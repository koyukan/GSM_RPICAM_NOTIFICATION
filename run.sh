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

# Start the application
cd /app
bashio::log.info "Starting application..."
if ! npm start; then
    bashio::log.error "Failed to start GSM RPICAM HASS server"
    exit 1
fi