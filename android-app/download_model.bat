@echo off
echo ========================================
echo MediaPipe Face Landmarker Model Setup
echo ========================================
echo.

REM Create assets directory
if not exist "app\src\main\assets" (
    echo Creating assets directory...
    mkdir app\src\main\assets
)

echo Downloading MediaPipe Face Landmarker model...
echo This may take a minute (file is ~10MB)...
echo.

REM Download using PowerShell
powershell -Command "& {Invoke-WebRequest -Uri 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task' -OutFile 'app\src\main\assets\face_landmarker.task'}"

REM Check if file exists
if exist "app\src\main\assets\face_landmarker.task" (
    echo.
    echo ✓ Download successful!
    echo File saved to: app\src\main\assets\face_landmarker.task
    echo.
    echo You can now open the project in Android Studio.
) else (
    echo.
    echo ✗ Download failed!
    echo.
    echo Please download manually:
    echo 1. Open this URL in your browser:
    echo    https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
    echo.
    echo 2. Save the file as:
    echo    app\src\main\assets\face_landmarker.task
    echo.
)

pause
