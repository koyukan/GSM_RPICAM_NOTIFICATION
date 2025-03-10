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
    # Node.js dependencies
    curl \
    build-essential \
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