# Use the official Home Assistant Debian base image
FROM ghcr.io/home-assistant/aarch64-base-debian:bookworm

# Set working directory
WORKDIR /app

# Add Raspberry Pi repository
RUN apt-get update && apt-get install -y --no-install-recommends gnupg
RUN echo "deb http://archive.raspberrypi.org/debian/ bookworm main" > /etc/apt/sources.list.d/raspi.list \
    && apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 82B129927FA3303E

# Install required packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Camera dependencies
    python3-pip \
    python3-picamera2 \
    ffmpeg \
    # GSM dependencies
    modemmanager \
    libqmi-utils \
    usbutils \
    ppp \
    usb-modeswitch \
    dbus \
    # Node.js dependencies
    curl \
    build-essential \
    # Debug utilities
    lsof \
    procps \
    net-tools \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && apt-get autoremove \
    && rm -rf /var/cache/apt/archives/* \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt

# Copy application files
COPY python/ /app/python/
COPY timeout.yaml /app/timeout.yaml

# Create D-Bus setup script
RUN mkdir -p /app/scripts
RUN echo '#!/bin/bash\n\
\n\
# Ensure we are using the hosts D-Bus\n\
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"\n\
\n\
# Check if we have access to the hosts D-Bus\n\
if [ -e /run/dbus/system_bus_socket ]; then\n\
    echo "Host D-Bus socket found at /run/dbus/system_bus_socket"\n\
    \n\
    # Test D-Bus access\n\
    if dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames > /dev/null 2>&1; then\n\
        echo "Successfully connected to host D-Bus"\n\
    else\n\
        echo "WARNING: Could not connect to host D-Bus, permissions issue?"\n\
        ls -la /run/dbus/system_bus_socket\n\
        echo "Current user and groups:"\n\
        id\n\
    fi\n\
else\n\
    echo "Host D-Bus socket not found at expected location"\n\
    \n\
    if [ -e /var/run/dbus/system_bus_socket ]; then\n\
        echo "Found D-Bus socket at alternate location /var/run/dbus/system_bus_socket"\n\
        echo "Creating symlink..."\n\
        mkdir -p /run/dbus\n\
        ln -sf /var/run/dbus/system_bus_socket /run/dbus/system_bus_socket\n\
    else\n\
        echo "No D-Bus socket found. Will attempt to use own D-Bus daemon."\n\
        mkdir -p /run/dbus\n\
        dbus-daemon --system\n\
        sleep 2\n\
    fi\n\
fi\n\
\n\
# Check if ModemManager is already running on the system\n\
if pgrep ModemManager > /dev/null; then\n\
    echo "ModemManager is already running on the system"\n\
    \n\
    # Check if its detecting modems\n\
    mmcli -L || true\n\
else\n\
    echo "Starting ModemManager..."\n\
    # Start ModemManager in debug mode and in the background\n\
    ModemManager --debug &\n\
    sleep 3\n\
    \n\
    # Check if it started successfully\n\
    if pgrep ModemManager > /dev/null; then\n\
        echo "ModemManager started successfully"\n\
        mmcli -L || true\n\
    else\n\
        echo "Failed to start ModemManager. Will try with different options..."\n\
        # Try with explicit user\n\
        ModemManager --debug --user=root &\n\
        sleep 3\n\
        mmcli -L || true\n\
    fi\n\
fi\n\
\n\
# Fix USB device permissions\n\
echo "Setting USB device permissions..."\n\
for device in /dev/ttyUSB*; do\n\
    if [ -e "$device" ]; then\n\
        echo "Setting permissions for $device"\n\
        chmod 666 "$device" || echo "Failed to set permissions for $device"\n\
    fi\n\
done' > /app/scripts/dbus-setup.sh

RUN chmod +x /app/scripts/dbus-setup.sh

# Copy Node.js application files
COPY . .

# Install Node.js dependencies and build the application
RUN npm ci && \
    npm run build && \
    npm cache clean --force

# Home Assistant add-on setup
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]