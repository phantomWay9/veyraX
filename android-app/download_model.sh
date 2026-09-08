#!/bin/bash

# MediaPipe Face Landmarker Model Download Script
# Run this script to download the required model file

echo "Downloading MediaPipe Face Landmarker model..."
echo "Target: app/src/main/assets/face_landmarker.task"
echo ""

# Create assets directory if it doesn't exist
mkdir -p app/src/main/assets

# Download the model
curl -L -o app/src/main/assets/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task

# Check if download was successful
if [ -f "app/src/main/assets/face_landmarker.task" ]; then
    file_size=$(du -h app/src/main/assets/face_landmarker.task | cut -f1)
    echo ""
    echo "✅ Download successful!"
    echo "File size: $file_size"
    echo "Location: app/src/main/assets/face_landmarker.task"
else
    echo ""
    echo "❌ Download failed!"
    echo ""
    echo "Please download manually:"
    echo "1. Visit: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
    echo "2. Save as: app/src/main/assets/face_landmarker.task"
fi
