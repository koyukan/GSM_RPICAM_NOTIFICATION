# Start with Debian Bookworm as base image
FROM debian:bookworm

# Set working directory
WORKDIR /app

# ------------------------------------------------------------------------------------------------
# Install Raspberry Pi camera dependencies (using your proven approach)
# ------------------------------------------------------------------------------------------------
RUN apt update && apt install -y --no-install-recommends gnupg
RUN echo "deb http://archive.raspberrypi.org/debian/ bookworm main" > /etc/apt/sources.list.d/raspi.list \
  && apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 82B129927FA3303E
RUN apt update && apt -y upgrade

# ------------------------------------------------------------------------------------------------
# Install GSM/ModemManager and Node.js dependencies in one layer to keep image size down
# ------------------------------------------------------------------------------------------------
RUN apt update && apt install -y --no-install-recommends \
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
    sudo \
    # Node.js dependencies
    curl \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt install -y nodejs \
    && apt-get clean \
    && apt-get autoremove \
    && rm -rf /var/cache/apt/archives/* \
    && rm -rf /var/lib/apt/lists/*

# Set up D-Bus system bus
RUN mkdir -p /run/dbus && \
    dbus-uuidgen > /var/lib/dbus/machine-id

# ------------------------------------------------------------------------------------------------
# Install Python dependencies
# ------------------------------------------------------------------------------------------------
COPY requirements.txt /app/
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt

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