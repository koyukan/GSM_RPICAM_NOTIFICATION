#use HASS base-nodejs as base
FROM ghcr.io/hassio-addons/base-nodejs:7b01614 

# Set working directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies and build the application
RUN npm ci && \
    npm run build && \
    npm cache clean --force

# Copy run script and make it executable
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]