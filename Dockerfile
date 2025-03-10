# Use Debian Bookworm with Node.js as base image
FROM node:22-bookworm

# Set working directory
WORKDIR /app

# ------------------------------------------------------------------------------------------------
# Install GSM/ModemManager dependencies
# ------------------------------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    modemmanager \
    libqmi-utils \
    usbutils \
    ppp \
    usb-modeswitch \
    dbus \
    sudo \
    gnupg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set up D-Bus system bus
RUN mkdir -p /run/dbus && \
    dbus-uuidgen > /var/lib/dbus/machine-id

# ------------------------------------------------------------------------------------------------
# Install Raspberry Pi camera dependencies
# ------------------------------------------------------------------------------------------------
# Add Raspberry Pi repository
RUN echo "deb http://archive.raspberrypi.org/debian/ bookworm main" > /etc/apt/sources.list.d/raspi.list \
    && apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 82B129927FA3303E \
    && apt-get update

# Install Python and picamera2
RUN apt-get install -y --no-install-recommends \
    python3-pip \
    python3-picamera2 \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------------------------------------
# Create camera wrapper script
# ------------------------------------------------------------------------------------------------
RUN echo '#!/bin/bash' > /app/start_camera.sh && \
    echo 'echo "=== Configuring camera timeout ===" && date' >> /app/start_camera.sh && \
    echo 'CONFIG_FILE="/usr/share/libcamera/pipeline/rpi/vc4/rpi_apps.yaml"' >> /app/start_camera.sh && \
    echo 'if [ -f "$CONFIG_FILE" ]; then' >> /app/start_camera.sh && \
    echo '    # Make a backup of the original file' >> /app/start_camera.sh && \
    echo '    cp -f "$CONFIG_FILE" "${CONFIG_FILE}.backup"' >> /app/start_camera.sh && \
    echo 'fi' >> /app/start_camera.sh && \
    echo '' >> /app/start_camera.sh && \
    echo '# Copy the timeout.yaml to the libcamera config location' >> /app/start_camera.sh && \
    echo 'if [ -f "/app/pi_camera_in_docker/timeout.yaml" ]; then' >> /app/start_camera.sh && \
    echo '    echo "Using custom timeout.yaml from project directory"' >> /app/start_camera.sh && \
    echo '    cp -f "/app/pi_camera_in_docker/timeout.yaml" "$CONFIG_FILE"' >> /app/start_camera.sh && \
    echo '    echo "Configuration applied successfully"' >> /app/start_camera.sh && \
    echo 'else' >> /app/start_camera.sh && \
    echo '    echo "Warning: Could not find timeout.yaml in project directory"' >> /app/start_camera.sh && \
    echo 'fi' >> /app/start_camera.sh && \
    echo '' >> /app/start_camera.sh && \
    echo '# Run the application' >> /app/start_camera.sh && \
    echo 'echo "=== Starting camera application ===" && date' >> /app/start_camera.sh && \
    echo 'python3 /app/pi_camera_in_docker/main.py "$@"' >> /app/start_camera.sh && \
    chmod +x /app/start_camera.sh

# ------------------------------------------------------------------------------------------------
# Copy application files and install dependencies
# ------------------------------------------------------------------------------------------------
# Copy Python requirements first (if they exist)
COPY requirements.txt* /app/
RUN if [ -f "/app/requirements.txt" ]; then \
    pip3 install --no-cache-dir -r /app/requirements.txt; \
    fi

# Copy the Python camera application files
COPY pi_camera_in_docker* /app/pi_camera_in_docker/ || echo "No camera files found"

# Copy Node.js application files
COPY . .

# Install Node.js dependencies and build the application
RUN npm ci && \
    npm run build && \
    npm cache clean --force

# ------------------------------------------------------------------------------------------------
# Set up startup script that combines all functionality
# ------------------------------------------------------------------------------------------------
RUN echo '#!/bin/bash' > /run.sh && \
    echo '# Start D-Bus and ModemManager' >> /run.sh && \
    echo 'dbus-daemon --system && sleep 2 && ModemManager --debug &' >> /run.sh && \
    echo 'echo "Started ModemManager in debug mode"' >> /run.sh && \
    echo '' >> /run.sh && \
    echo '# Start camera service if files exist' >> /run.sh && \
    echo 'if [ -d "/app/pi_camera_in_docker" ] && [ -f "/app/pi_camera_in_docker/main.py" ]; then' >> /run.sh && \
    echo '    /app/start_camera.sh &' >> /run.sh && \
    echo '    echo "Started camera service"' >> /run.sh && \
    echo 'fi' >> /run.sh && \
    echo '' >> /run.sh && \
    echo '# Start the Node.js application' >> /run.sh && \
    echo 'echo "Starting Node.js application"' >> /run.sh && \
    echo 'node /app/build/index.js' >> /run.sh && \
    chmod +x /run.sh

# Start all services via our combined script
CMD [ "/run.sh" ]