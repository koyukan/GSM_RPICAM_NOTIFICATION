#!/bin/bash
# fix-pi-camera.sh - Comprehensive fix for Raspberry Pi camera permission issues
# Run with: sudo bash fix-pi-camera.sh username

set -e # Exit on error

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root. Please use sudo."
  exit 1
fi

# Get the username to grant permissions to
if [ -z "$1" ]; then
  echo "Usage: $0 <username>"
  echo "Example: $0 hass"
  exit 1
fi

USERNAME="$1"
echo "🔧 Fixing camera permissions for user: $USERNAME"

# Add user to all potentially relevant groups
echo "➕ Adding user to camera-related groups..."
usermod -a -G video,input,i2c,gpio,spi "$USERNAME"

# Fix DMA heap device permissions
echo "🔧 Creating udev rules for DMA heap devices..."
cat > /etc/udev/rules.d/90-dma-heap.rules << EOF
SUBSYSTEM=="dma_heap", GROUP="video", MODE="0660"
KERNEL=="dma_heap", GROUP="video", MODE="0660"
KERNEL=="*dma*", GROUP="video", MODE="0660"
EOF

# Fix video and media device permissions
echo "🔧 Creating udev rules for camera devices..."
cat > /etc/udev/rules.d/99-camera.rules << EOF
SUBSYSTEM=="video4linux", GROUP="video", MODE="0660"
SUBSYSTEM=="media", GROUP="video", MODE="0660"
KERNEL=="video*", GROUP="video", MODE="0660"
KERNEL=="media*", GROUP="video", MODE="0660"
EOF

# Fix V4L permissions
echo "🔧 Creating udev rules for V4L devices..."
cat > /etc/udev/rules.d/99-v4l.rules << EOF
KERNEL=="vchiq",GROUP="video",MODE="0660"
KERNEL=="vcsm-cma",GROUP="video",MODE="0660"
SUBSYSTEM=="v4l2loopback", GROUP="video", MODE="0660"
EOF

# Fix i2c permissions
echo "🔧 Creating udev rules for I2C devices..."
cat > /etc/udev/rules.d/99-i2c.rules << EOF
SUBSYSTEM=="i2c-dev", GROUP="i2c", MODE="0660"
KERNEL=="i2c-*", GROUP="i2c", MODE="0660"
EOF

# Reload udev rules
echo "🔄 Reloading udev rules..."
udevadm control --reload-rules
udevadm trigger

# Fix permissions for existing devices
echo "🔧 Setting permissions on existing devices..."
# DMA heap devices
for dev in /dev/dma_heap /dev/*dma*; do
  if [ -e "$dev" ]; then
    echo "   Fixing permissions for $dev"
    chmod 0660 "$dev"
    chgrp video "$dev"
  fi
done

# Video devices
for dev in /dev/video* /dev/media*; do
  if [ -e "$dev" ]; then
    echo "   Fixing permissions for $dev"
    chmod 0660 "$dev"
    chgrp video "$dev"
  fi
done

# Special devices
for dev in /dev/vchiq /dev/vcsm-cma; do
  if [ -e "$dev" ]; then
    echo "   Fixing permissions for $dev"
    chmod 0660 "$dev"
    chgrp video "$dev"
  fi
done

# I2C devices
for dev in /dev/i2c-*; do
  if [ -e "$dev" ]; then
    echo "   Fixing permissions for $dev"
    chmod 0660 "$dev"
    chgrp i2c "$dev"
  fi
done

# Check if video module is loaded
echo "📋 Checking video modules..."
if ! lsmod | grep -q "^bcm2835_v4l2"; then
  echo "⚠️ bcm2835_v4l2 module not loaded, loading it now..."
  modprobe bcm2835_v4l2
  
  # Add to /etc/modules to load at boot
  if ! grep -q "bcm2835_v4l2" /etc/modules; then
    echo "bcm2835_v4l2" >> /etc/modules
    echo "✅ Added bcm2835_v4l2 to /etc/modules for automatic loading at boot"
  fi
fi

# Check if camera is enabled in config.txt
echo "📋 Checking Raspberry Pi config..."
if [ -f /boot/config.txt ]; then
  if ! grep -q "^start_x=1" /boot/config.txt && ! grep -q "^camera_auto_detect=1" /boot/config.txt; then
    echo "⚠️ Camera not enabled in /boot/config.txt, enabling it now..."
    # Backup config first
    cp /boot/config.txt /boot/config.txt.bak
    
    # Check if we need legacy or new config
    if grep -q "camera_auto_detect" /boot/config.txt; then
      # New style Raspberry Pi OS
      sed -i 's/^camera_auto_detect=0/camera_auto_detect=1/' /boot/config.txt
      if ! grep -q "camera_auto_detect" /boot/config.txt; then
        echo "camera_auto_detect=1" >> /boot/config.txt
      fi
    else
      # Legacy style config
      sed -i 's/^start_x=0/start_x=1/' /boot/config.txt
      if ! grep -q "start_x" /boot/config.txt; then
        echo "start_x=1" >> /boot/config.txt
      fi
      
      # Make sure gpu_mem is at least 128
      if ! grep -q "gpu_mem" /boot/config.txt; then
        echo "gpu_mem=128" >> /boot/config.txt
      else
        # If gpu_mem is set but less than 128, increase it
        gpu_mem=$(grep "gpu_mem=" /boot/config.txt | head -n1 | cut -d'=' -f2)
        if [ "$gpu_mem" -lt 128 ]; then
          sed -i 's/gpu_mem=[0-9]*/gpu_mem=128/' /boot/config.txt
          echo "✅ Updated gpu_mem to 128MB"
        fi
      fi
    fi
    echo "✅ Camera enabled in /boot/config.txt"
  else
    echo "✅ Camera already enabled in /boot/config.txt"
  fi
fi

# Create a test script
echo "📝 Creating test script..."
cat > /home/$USERNAME/test-camera.sh << EOF
#!/bin/bash
# Test script for camera access

echo "Testing camera access with rpicam-hello..."
rpicam-hello

echo -e "\nTesting camera access with rpicam-vid..."
rpicam-vid -t 3000 -o /tmp/test.h264

echo -e "\nIf no errors appeared above and you can see camera output, permissions are working!"
echo "The test video was saved to /tmp/test.h264"
EOF

# Make it executable and owned by the user
chmod +x /home/$USERNAME/test-camera.sh
chown $USERNAME:$USERNAME /home/$USERNAME/test-camera.sh

echo "✅ Permissions fixed for user $USERNAME!"
echo "👉 To test camera access, please reboot first, then run:"
echo "   ./test-camera.sh"
echo ""
echo "⚠️ IMPORTANT: You MUST reboot the system for all changes to take effect!"
echo "   Run 'sudo reboot' to reboot the system"

exit 0