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
COPY <<'EOF' /app/scripts/dbus-setup.sh
#!/bin/bash

# Ensure we're using the host's D-Bus
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"

# Check if we have access to the host's D-Bus
if [ -e /run/dbus/system_bus_socket ]; then
    echo "Host D-Bus socket found at /run/dbus/system_bus_socket"
    
    # Test D-Bus access
    if dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames > /dev/null 2>&1; then
        echo "Successfully connected to host D-Bus"
    else
        echo "WARNING: Could not connect to host D-Bus, permissions issue?"
        ls -la /run/dbus/system_bus_socket
        echo "Current user and groups:"
        id
    fi
else
    echo "Host D-Bus socket not found at expected location"
    
    if [ -e /var/run/dbus/system_bus_socket ]; then
        echo "Found D-Bus socket at alternate location /var/run/dbus/system_bus_socket"
        echo "Creating symlink..."
        mkdir -p /run/dbus
        ln -sf /var/run/dbus/system_bus_socket /run/dbus/system_bus_socket
    else
        echo "No D-Bus socket found. Will attempt to use own D-Bus daemon."
        mkdir -p /run/dbus
        dbus-daemon --system
        sleep 2
    fi
fi

# Check if ModemManager is already running on the system
if pgrep ModemManager > /dev/null; then
    echo "ModemManager is already running on the system"
    
    # Check if it's detecting modems
    mmcli -L || true
else
    echo "Starting ModemManager..."
    # Start ModemManager in debug mode and in the background
    ModemManager --debug &
    sleep 3
    
    # Check if it started successfully
    if pgrep ModemManager > /dev/null; then
        echo "ModemManager started successfully"
        mmcli -L || true
    else
        echo "Failed to start ModemManager. Will try with different options..."
        # Try with explicit user
        ModemManager --debug --user=root &
        sleep 3
        mmcli -L || true
    fi
fi

# Fix USB device permissions
echo "Setting USB device permissions..."
for device in /dev/ttyUSB*; do
    if [ -e "$device" ]; then
        echo "Setting permissions for $device"
        chmod 666 "$device" || echo "Failed to set permissions for $device"
    fi
done
EOF

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