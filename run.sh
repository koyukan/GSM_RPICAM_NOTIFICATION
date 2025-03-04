#!/usr/bin/with-contenv bashio

bashio::log.info "Starting GSM RPICAM HASS server..."

# Add error handling
if ! npm start; then
    bashio::log.error "Failed to start GSM RPICAM HASS server"
    exit 1
fi