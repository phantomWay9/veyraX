import React, { useRef, useEffect, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import './VideoCapture.css';
import {
  processLivenessFrame,
  createTemporalHistory,
  pushTemporalFrame,
  computeNormalizedLandmarks,
  calculateTrackingQuality,
  calculateLivenessScore,
  LIVENESS_CONFIG
} from '../utils/livenessDetection';

const VideoCapture = ({ onVerificationUpdate }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [faceMesh, setFaceMesh] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Ready');
  const animationFrameRef = useRef(null);

  // Temporal history for liveness detection
  const temporalHistoryRef = useRef(null);
  const trustHistoryRef = useRef([]);
  const frameCountRef = useRef(0);
  const startTimeRef = useRef(null);
  const lastLogTimeRef = useRef(0);
  const pendingLandmarksRef = useRef(null);
  const analysisFrameRef = useRef(null);
  const trackingQualityRef = useRef({ score: 0, reason: 'Waiting for a face.' });

  // Initialize MediaPipe Face Mesh
  useEffect(() => {
    let mounted = true;

    const initFaceMesh = async () => {
      try {
        setStatus('Loading face detection...');
        console.log('🔄 Initializing MediaPipe Face Mesh...');

        const mesh = new FaceMesh({
          locateFile: (file) => {
            const url = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
            console.log('📦 Loading MediaPipe file:', file);
            return url;
          }
        });

        console.log('⚙️ Configuring Face Mesh options...');
        mesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        mesh.onResults(onFaceMeshResults);

        if (mounted) {
          setFaceMesh(mesh);
          setStatus('Ready');
          console.log('✅ Face Mesh initialized successfully');
        }
      } catch (err) {
        console.error('❌ Face mesh init error:', err);
        if (mounted) {
          setError('Failed to initialize face detection: ' + err.message);
          setStatus('Error');
        }
      }
    };

    initFaceMesh();

    return () => {
      mounted = false;
    };
  }, []);

  // Start camera
  const startCamera = async () => {
    try {
      setError(null);
      setStatus('Requesting camera access...');

      // Simple constraints first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log('✅ Camera stream attached to video element');

        // Wait for video to be ready
        videoRef.current.onloadedmetadata = async () => {
          console.log('✅ Video metadata loaded, dimensions:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
          try {
            await videoRef.current.play();
            console.log('✅ Video playing');
            setIsActive(true);
            setStatus('Camera active');
            startTimeRef.current = Date.now();

            // Wait a bit for faceMesh to be ready, then start frame loop
            setTimeout(() => {
              if (faceMesh && videoRef.current) {
                console.log('🎬 Starting liveness detection...');
                processFrame();
              }
            }, 500);
          } catch (playErr) {
            console.error('❌ Video play error:', playErr);
            setError('Failed to start video: ' + playErr.message);
          }
        };
      }
    } catch (err) {
      console.error('Camera access error:', err);
      let errorMsg = 'Camera access denied';

      if (err.name === 'NotAllowedError') {
        errorMsg = 'Camera permission denied. Please allow camera access and refresh.';
      } else if (err.name === 'NotFoundError') {
        errorMsg = 'No camera found. Please connect a camera.';
      } else if (err.name === 'NotReadableError') {
        errorMsg = 'Camera is already in use by another application.';
      } else {
        errorMsg = err.message || 'Failed to access camera';
      }

      setError(errorMsg);
      setStatus('Error');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setStatus('Stopped');

    // Reset buffers
    temporalHistoryRef.current = null;
    trustHistoryRef.current = [];
    frameCountRef.current = 0;
    startTimeRef.current = null;
    lastLogTimeRef.current = 0;
  };

  // Process each frame
  const processFrame = async () => {
    if (!videoRef.current || !faceMesh) {
      console.log('⏸️ Frame loop stopped: missing video or faceMesh');
      return;
    }

    if (videoRef.current.paused || videoRef.current.ended) {
      console.log('⏸️ Frame loop stopped: video paused/ended');
      return;
    }

    try {
      if (videoRef.current.readyState >= 2) {
        await faceMesh.send({ image: videoRef.current });
      }
    } catch (err) {
      console.error('❌ Frame processing error:', err);
    }

    // Continue loop
    animationFrameRef.current = requestAnimationFrame(processFrame);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

// Handle face mesh results
  const onFaceMeshResults = (results) => {
    if (!canvasRef.current) {
      console.log('⚠️ No canvas ref in results handler');
      return;
    }

    if (!results.multiFaceLandmarks?.[0]) {
      // No face detected
      if (frameCountRef.current % 60 === 0) {
        console.log('⚠️ No face detected in frame', frameCountRef.current);
      }
      onVerificationUpdate({
        status: 'UNCERTAIN',
        confidence: 0,
        signalQuality: 0,
        roiConsistency: 0,
        captureQuality: 0,
        guidance: 'Place your face in the camera frame to begin.',
        trustHistory: trustHistoryRef.current,
        livenessFactors: []
      });
      drawFrame(results.image);
      return;
    }

    // Draw frame immediately (quick rendering)
    const canvas = canvasRef.current;
    const landmarks = results.multiFaceLandmarks[0];
    drawFrame(results.image, landmarks);

    // Store landmarks for async processing to avoid UI freezing
    if (!pendingLandmarksRef.current) {
      pendingLandmarksRef.current = {
        landmarks: landmarks,
        image: results.image,
        canvas: canvas
      };

      // Schedule processing for next animation frame (use separate ref!)
      if (analysisFrameRef.current) {
        cancelAnimationFrame(analysisFrameRef.current);
      }
      analysisFrameRef.current = requestAnimationFrame(() => {
        processStoredFrame();
      });
    }
  };

  const processStoredFrame = () => {
    if (!pendingLandmarksRef.current) return;

    const { landmarks, canvas } = pendingLandmarksRef.current;
    pendingLandmarksRef.current = null;

    if (frameCountRef.current === 0) {
      console.log('✅ Face detected! Starting liveness analysis...');
      console.log('📊 Landmark count:', landmarks.length);
      temporalHistoryRef.current = createTemporalHistory();
    }

    // Compute normalized landmarks
    const normalizedLandmarks = computeNormalizedLandmarks(landmarks);

    // Safety check - skip frame if landmarks couldn't be normalized
    if (!normalizedLandmarks) {
      console.warn('⚠️ Could not normalize landmarks, skipping frame');
      return;
    }

    trackingQualityRef.current = calculateTrackingQuality(landmarks);

    // Only calculate eye/pose measurements after landmark validation.
    const frameData = processLivenessFrame(
      landmarks,
      canvas.width,
      canvas.height
    );

    // Push to temporal history
    const blinkEvent = pushTemporalFrame(
      temporalHistoryRef.current,
      normalizedLandmarks,
      frameData
    );

    if (blinkEvent) {
      console.log('👁️ Blink detected at frame', frameCountRef.current);
    }

    frameCountRef.current++;

    // Process liveness every 10 frames (for performance)
    if (frameCountRef.current % 10 === 0 && temporalHistoryRef.current?.landmarks3D.length >= LIVENESS_CONFIG.minHistoryForAnalysis) {
      processLiveness();
    }
  };

  // Process liveness detection
  const processLiveness = () => {
    if (!temporalHistoryRef.current) return;

    const duration = startTimeRef.current ? Date.now() - startTimeRef.current : 0;

    // Calculate liveness score using temporal history
    const livenessResult = calculateLivenessScore(
      temporalHistoryRef.current,
      duration
    );

    const smoothedConfidence = livenessResult.confidence;

    // Update trust history with smoothed confidence
    trustHistoryRef.current.push({
      timestamp: Date.now(),
      confidence: smoothedConfidence
    });

    // Keep last 60 seconds of history
    const sixtySecondsAgo = Date.now() - 60000;
    trustHistoryRef.current = trustHistoryRef.current.filter(
      entry => entry.timestamp > sixtySecondsAgo
    );

    // Map debug state to status
    let status = 'UNCERTAIN';
    if (livenessResult.debug.state === 'VERIFIED') {
      status = 'VERIFIED';
    } else if (livenessResult.debug.state === 'SUSPICIOUS') {
      status = 'SUSPICIOUS';
    } else {
      status = 'UNCERTAIN';
    }

    // Calculate signal quality based on data sufficiency
    const historyQuality = Math.min(
      1,
      temporalHistoryRef.current.landmarks3D.length / LIVENESS_CONFIG.minHistoryForAnalysis
    );
    const captureQuality = trackingQualityRef.current.score;
    const signalQuality = historyQuality * captureQuality;

    // Throttled debug logging (every 3 seconds)
    const now = Date.now();
    if (now - lastLogTimeRef.current >= 3000) {
      lastLogTimeRef.current = now;
      console.log('═══════════════════════════════════════════════════════');
      console.log('📊 LIVENESS VERIFICATION DECISION');
      console.log('═══════════════════════════════════════════════════════');
      console.log('Status:', livenessResult.debug.state);
      console.log('Reason:', livenessResult.debug.reason);
      console.log('Confidence:', (smoothedConfidence * 100).toFixed(1) + '%');
      console.log('Raw Score:', livenessResult.rawScore.toFixed(1));
      console.log('───────────────────────────────────────────────────────');
      console.log('Liveness Evidence:', livenessResult.livenessEvidence);
      console.log('Strong Signals:', livenessResult.debug.strongSignals);
      console.log('───────────────────────────────────────────────────────');
      console.log('Blink:', livenessResult.debug.blink);
      console.log('Eye Movement:', livenessResult.debug.eyeMovement);
      console.log('Head Movement:', livenessResult.debug.headMovement);
      console.log('Depth:', livenessResult.debug.depth);
      console.log('Temporal Consistency:', livenessResult.debug.temporalConsistency);
      console.log('───────────────────────────────────────────────────────');
      console.log('Verification Gates:', livenessResult.debug.verificationGates);
      console.log('Sustained Strong Frames:', livenessResult.debug.sustainedStrongFrames);
      console.log('Confidence Stability (stdDev):', livenessResult.debug.confidenceStability);
      console.log('═══════════════════════════════════════════════════════');
    }

    onVerificationUpdate({
      status,
      confidence: smoothedConfidence,
      rawConfidence: livenessResult.rawScore / 100,
      signalQuality,
      roiConsistency: livenessResult.debug.trackingStable ? 1 : 0,
      captureQuality,
      guidance: trackingQualityRef.current.reason,
      trustHistory: [...trustHistoryRef.current],
      livenessFactors: livenessResult.factors,
      blinkCount: livenessResult.blinkCount,
      microMovement: livenessResult.microMovement,
      hasStrongLivenessSignal: livenessResult.hasStrongLivenessSignal,
      isStable: livenessResult.debug.confidenceStability < LIVENESS_CONFIG.stabilityThreshold
    });
  };

  // Draw video frame and landmarks
  const drawFrame = (image, landmarks = null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Set canvas dimensions to match image
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (landmarks) {
      // Draw ROI boxes
      drawROIBox(ctx, landmarks, 'forehead', '#6366f1');
      drawROIBox(ctx, landmarks, 'leftCheek', '#8b5cf6');
      drawROIBox(ctx, landmarks, 'rightCheek', '#a855f7');
    }

    ctx.restore();
  };

  // Draw ROI bounding box
  const drawROIBox = (ctx, landmarks, region, color) => {
    const indices = getROIIndices(region);
    const points = indices.map(i => ({
      x: landmarks[i].x * ctx.canvas.width,
      y: landmarks[i].y * ctx.canvas.height
    }));

    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

    ctx.fillStyle = color;
    ctx.font = '12px monospace';
    ctx.fillText(region, minX, minY - 5);
  };

  // Get MediaPipe landmark indices for each ROI
  const getROIIndices = (region) => {
    switch (region) {
      case 'forehead':
        return [10, 67, 109, 338, 297]; // Upper forehead region
      case 'leftCheek':
        return [266, 426, 436, 416, 376]; // Left cheek
      case 'rightCheek':
        return [36, 206, 216, 192, 147]; // Right cheek
      default:
        return [];
    }
  };

  return (
    <div className="video-capture">
      <div className="video-container">
        <video
          ref={videoRef}
          className="video-element"
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="canvas-overlay" />

        {!isActive && (
          <div className="video-placeholder">
            <div className="placeholder-icon">📹</div>
            <p>{status}</p>
          </div>
        )}

        {isActive && !faceMesh && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
            <p>Loading face detection...</p>
          </div>
        )}
      </div>

      <div className="controls">
        {!isActive ? (
          <button
            onClick={startCamera}
            className="btn-primary"
            disabled={!faceMesh || status === 'Error'}
          >
            {faceMesh ? 'Start Verification' : 'Loading...'}
          </button>
        ) : (
          <button onClick={stopCamera} className="btn-secondary">
            Stop
          </button>
        )}
      </div>

      {status && status !== 'Ready' && status !== 'Camera active' && !error && (
        <div className="status-message">
          <span>ℹ️</span>
          <p>{status}</p>
        </div>
      )}

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
};

export default VideoCapture;
