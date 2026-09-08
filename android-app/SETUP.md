# 🚀 Quick Setup Guide - PulseVerify Android

## Step 1: Download MediaPipe Model ⚡

**Option A: Using the batch script (easiest)**
1. Open PowerShell or Command Prompt in the `android-app` folder
2. Run: `download_model.bat`
3. Wait for download to complete

**Option B: Manual download**
1. Open this URL in your browser:
   ```
   https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
   ```
2. Save the downloaded file to:
   ```
   android-app/app/src/main/assets/face_landmarker.task
   ```

The model file is about 10MB and is required for face detection.

---

## Step 2: Open in Android Studio 📱

1. **Launch Android Studio**
2. Click **File → Open**
3. Navigate to: `C:\Users\karti\OneDrive\Desktop\veyraX\android-app`
4. Click **OK**
5. **Wait for Gradle sync** (first time: 5-10 minutes)
   - You'll see "Gradle sync in progress..." at the bottom
   - Let it download all dependencies

---

## Step 3: Connect Your Android Phone 📲

### Enable Developer Mode:
1. Go to **Settings → About Phone**
2. Tap **Build Number** 7 times
3. You'll see "You are now a developer!"

### Enable USB Debugging:
1. Go to **Settings → System → Developer Options**
2. Turn on **USB Debugging**
3. Connect phone via USB cable
4. On phone, tap **Allow** when "Allow USB debugging?" appears

---

## Step 4: Run the App ▶️

1. In Android Studio, select your device from the dropdown (top toolbar)
2. Click the green **Run** button (▶️) or press **Shift+F10**
3. App will install and launch automatically

---

## Step 5: Test It! 🧪

1. Tap **"Start Verification"**
2. Allow camera permission
3. Face the camera - you'll see 3 colored boxes on your face:
   - 🔴 Red (Forehead)
   - 🔵 Cyan (Left Cheek)
   - 🟢 Light Cyan (Right Cheek)
4. Hold still for 3-5 seconds
5. Watch your trust score climb to 70-95%!

### Quick Tests:
- **Real face**: Should show VERIFIED (green) with 70-95% confidence
- **Photo of face**: Should show SUSPICIOUS (red) with <30% confidence
- **Hot-swap**: Start with real face, swap to photo → trust degrades

---

## ⚠️ Troubleshooting

**"face_landmarker.task not found" error**
→ Make sure the model file is in `app/src/main/assets/` folder

**Gradle sync fails**
→ Check internet connection, then: File → Invalidate Caches → Restart

**Device not showing in Android Studio**
→ Check USB debugging is enabled, try different USB cable

**"No face detected"**
→ Improve lighting, move closer to camera

---

## 📁 Project Files

```
android-app/
├── app/
│   ├── src/main/
│   │   ├── java/com/veyrax/pulseverify/  ← All Kotlin code
│   │   ├── res/                          ← UI layouts & resources
│   │   └── assets/
│   │       └── face_landmarker.task      ← Download this!
│   └── build.gradle.kts
├── download_model.bat                     ← Run this first
└── README.md                              ← Full documentation
```

---

## 🎯 Next Steps After Setup

1. Test with different people
2. Test photo vs real face
3. Test lighting conditions
4. Practice the hot-swap demo for hackathon
5. Read full README.md for hackathon demo strategy

---

## 💡 For iQOO Hackathon Demo

The app is ready to demonstrate:
- ✅ Real-time liveness detection
- ✅ Photo/replay attack detection
- ✅ Trust degradation detection
- ✅ 100% on-device processing
- ✅ Material Design UI

Check README.md for the complete 4-act demo script!

---

**Need help?** The full documentation is in `README.md`

**Good luck with the hackathon! 🚀**
