# Use Node.js 22 with Debian Bookworm as base image
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
# Copy Python requirements and install dependencies
# ------------------------------------------------------------------------------------------------
COPY requirements.txt /app/
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# ------------------------------------------------------------------------------------------------
# Copy application files
# ------------------------------------------------------------------------------------------------
# Copy the Python camera files and timeout configuration
COPY python/ /app/python/
COPY timeout.yaml /app/timeout.yaml

# Copy Node.js application files
COPY . .

# Install Node.js dependencies and build the application
RUN npm ci && \
    npm run build && \
    npm cache clean --force

# ------------------------------------------------------------------------------------------------
# Copy run script and make it executable
# ------------------------------------------------------------------------------------------------
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]