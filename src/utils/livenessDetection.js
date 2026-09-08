/**
 * VeyraX Liveness Detection - Temporal Evidence Pipeline
 *
 * Distinguishes live humans from static photographs, printed photos,
 * and video replays using multiple independent temporal signals.
 *
 * Core principle: Multiple independent signals + temporal consistency
 * + strong evidence requirements = reliable liveness decision.
 *
 * PHOTO -> MUST NOT BECOME LIVE
 */

// =============================================================================
// 1. CENTRALIZED TUNABLE CONSTANTS
// =============================================================================

export const LIVENESS_CONFIG = {
  // Temporal History
  historySize: 300,
  analysisWindow: 200,

  // Blink Detection (phase state machine)
  earClosedThreshold: 0.21,
  earOpenThreshold: 0.23,
  minBlinkFrames: 1,
  maxBlinkGapFrames: 6,
  minTimeBetweenBlinksMs: 300,

  // Temporal Movement (normalized, face size-relative)
  // Values below are measured in face-width-normalized coordinates.
  temporalMovementStrong: 0.008,
  temporalMovementPartial: 0.0015,
  temporalMovementNoise: 0.0005,
  temporalVelocityWindow: 8,

  // Head Pose
  poseMinHistory: 20,
  poseStrongDelta: 7,
  posePartialDelta: 1.2,
  poseNoise: 0.75,

  // Temporal Variance (multiple time-scales)
  varianceShortWindow: 30,
  varianceMediumWindow: 80,
  varianceLongWindow: 150,
  varianceStrong: 0.0006,
  variancePartial: 0.00015,
  varianceNoise: 0.0001,

  // Minimum History
  minHistoryForBlink: 12,
  minHistoryForMovement: 20,
  minHistoryForAnalysis: 45,
  minHistoryForVariance: 20,

  // Depth (from actual Z-coordinates)
  depthStrong: 0.005,
  depthPartial: 0.002,
  depthNoise: 0.001,

  // Landmark Coherence
  coherenceStrong: 0.65,
  coherencePartial: 0.40,
  coherenceNoise: 0.25,

  // Verification
  liveConfidenceThreshold: 0.65,
  spoofConfidenceThreshold: 0.25,
  minVerificationDuration: 5000,
  sustainedStrongFrames: 3,
  requiredStrongSignals: 2,
  requireBlinkForLive: true,

  // Temporal Smoothing
  smoothingAlpha: 0.3,
  stabilityWindow: 12,
  stabilityThreshold: 0.07,

  // Anti-Spoof
  staticFaceDuration: 4000,
  staticMovementCap: 0.05,
  staticCapScore: 15,

  // Scoring Weights
  scoring: {
    blink: 30,
    temporalMovement: 20,
    headMovement: 15,
    eyeVariance: 10,
    depth: 10,
    coherence: 10,
    consistency: 5,
  },
};

// =============================================================================
// 2. UTILITY FUNCTIONS
// =============================================================================

const calculateEyeAspectRatio = (eyeLandmarks) => {
  const [p1, p2, p3, p4, p5, p6] = eyeLandmarks;
  const vertical1 = Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2);
  const vertical2 = Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2);
  const horizontal = Math.sqrt((p1.x - p4.x) ** 2 + (p1.y - p4.y) ** 2);
  return horizontal === 0 ? 0 : (vertical1 + vertical2) / (2.0 * horizontal);
};

const getEyeLandmarks = (landmarks) => ({
  left: [33, 160, 158, 133, 153, 144].map((i) => landmarks[i]),
  right: [362, 385, 387, 263, 373, 380].map((i) => landmarks[i]),
});

const numericMedian = (arr) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const euclidean = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// =============================================================================
// 3. PHASE STATE MACHINE (Blink detection)
// =============================================================================

const PHASE = Object.freeze({
  OPEN: 0,
  CLOSING: 1,
  CLOSED: 2,
  OPENING: 3,
});

const createBlinkPhase = () => ({
  phase: PHASE.OPEN,
  consecutiveClosed: 0,
  consecutiveOpened: 0,
  framesInCurrentPhase: 0,
  lastPhaseChangeFrame: -1,
});

// =============================================================================
// 4. TEMPORAL HISTORY BUFFER
// =============================================================================

export const createTemporalHistory = () => ({
  ear: [],
  blinkTransitions: [],
  landmarks3D: [],
  noseProtrusion: [],
  foreheadRecession: [],
  faceWidth: [],
  faceHeight: [],
  yaw: [],
  pitch: [],
  roll: [],
  blinkPhase: createBlinkPhase(),
  blinkEvents: [],
  frameIndex: 0,
  verifiedStrongFrames: 0,
  previousRaw: null,
  smoothedConfidence: null,
  confidenceHistory: [],
});

export const pushTemporalFrame = (history, normalizedLandmarks, frameData) => {
  const { ear, pose } = frameData;
  const { faceWidth, noseProtrusion, foreheadRecession } = normalizedLandmarks;

  const push = (arr, v) => {
    arr.push(v);
    if (arr.length > LIVENESS_CONFIG.historySize) arr.shift();
  };

  push(history.ear, ear);
  // Keep landmark frames in the same shape consumed by the temporal
  // analysers (`frame.landmarks.noseTip`, etc.). Storing the landmark map
  // directly made `frame.landmarks` undefined during score calculation.
  push(history.landmarks3D, { landmarks: normalizedLandmarks.landmarks });
  push(history.noseProtrusion, noseProtrusion);
  push(history.foreheadRecession, foreheadRecession);
  push(history.faceWidth, faceWidth);
  push(history.faceHeight, normalizedLandmarks.faceHeight);
  push(history.yaw, pose.yaw);
  push(history.pitch, pose.pitch);
  push(history.roll, pose.roll);

  history.frameIndex++;

  const trans = detectBlinkTransition(history, ear, LIVENESS_CONFIG);
  if (trans) {
    history.blinkTransitions.push(trans);
    if (history.blinkTransitions.length > LIVENESS_CONFIG.historySize)
      history.blinkTransitions.shift();
  }

  return trans;
};

// =============================================================================
// 5. BLINK DETECTION (Phase State Machine)
// =============================================================================

function detectBlinkTransition(history, ear, config) {
  const bs = history.blinkPhase;
  bs.framesInCurrentPhase++;

  switch (bs.phase) {
    case PHASE.OPEN:
      if (ear < config.earClosedThreshold) {
        bs.consecutiveClosed++;
        if (bs.consecutiveClosed >= 1) {
          bs.phase = PHASE.CLOSING;
          bs.framesInCurrentPhase = 0;
        }
      } else {
        bs.consecutiveClosed = 0;
      }
      break;

    case PHASE.CLOSING:
      if (ear < config.earClosedThreshold) {
        bs.consecutiveClosed++;
        if (bs.consecutiveClosed >= config.minBlinkFrames) {
          bs.phase = PHASE.CLOSED;
          bs.framesInCurrentPhase = 0;
        }
      } else {
        bs.consecutiveClosed = 0;
        bs.phase = PHASE.OPEN;
        bs.framesInCurrentPhase = 0;
      }
      break;

    case PHASE.CLOSED:
      if (ear >= config.earOpenThreshold) {
        bs.consecutiveOpened++;
        if (bs.consecutiveOpened >= 1) {
          bs.phase = PHASE.OPENING;
          bs.framesInCurrentPhase = 0;
        }
      } else {
        bs.consecutiveOpened = 0;
        if (bs.consecutiveClosed > config.minBlinkFrames * 4) {
          bs.phase = PHASE.OPEN;
          bs.framesInCurrentPhase = 0;
          bs.consecutiveClosed = 0;
        }
      }
      break;

    case PHASE.OPENING:
      if (ear >= config.earOpenThreshold) {
        bs.consecutiveOpened++;
        if (bs.consecutiveOpened >= config.minBlinkFrames) {
          const evt = {
            type: 'blink',
            timestamp: Date.now(),
            frameIndex: history.frameIndex,
          };
          const prevEvt =
            history.blinkEvents[history.blinkEvents.length - 1];
          if (
            !prevEvt ||
            evt.timestamp - prevEvt.timestamp > config.minTimeBetweenBlinksMs
          ) {
            history.blinkEvents.push(evt);
          }
          bs.phase = PHASE.OPEN;
          bs.framesInCurrentPhase = 0;
          bs.consecutiveClosed = 0;
          bs.consecutiveOpened = 0;
          return evt;
        }
      } else {
        bs.consecutiveOpened = 0;
        bs.consecutiveClosed++;
        bs.phase = PHASE.CLOSED;
        bs.framesInCurrentPhase = 0;
      }
      break;

    default:
      bs.phase = PHASE.OPEN;
      bs.framesInCurrentPhase = 0;
  }
  return null;
}

// =============================================================================
// 6. NORMALIZED LANDMARK COMPUTATION
// =============================================================================

export const computeNormalizedLandmarks = (landmarks) => {
  // Safety check - ensure landmarks exist and have required indices
  if (!landmarks || !Array.isArray(landmarks) || landmarks.length < 468) {
    console.warn('Invalid landmarks data provided to computeNormalizedLandmarks');
    return null;
  }

  // Check critical landmark points exist
  const requiredIndices = [1, 10, 33, 61, 133, 152, 234, 263, 291, 362, 454];
  const hasAllLandmarks = requiredIndices.every(idx =>
    landmarks[idx] &&
    typeof landmarks[idx].x === 'number' &&
    typeof landmarks[idx].y === 'number'
  );

  if (!hasAllLandmarks) {
    console.warn('Missing required landmark indices');
    return null;
  }

  const noseTip = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const forehead = landmarks[10];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const chin = landmarks[152];

  const faceWidth = euclidean(leftCheek, rightCheek);
  const faceHeight = euclidean(forehead, chin);

  const center = {
    x: (leftCheek.x + rightCheek.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };

  const nrm = (pt) => ({
    x: (pt.x - center.x) / (faceWidth || 1),
    y: (pt.y - center.y) / (faceWidth || 1),
  });

  const normalizedLandmarks = {
    leftEyeCenter: nrm({
      x: (leftEye.x + landmarks[133].x) / 2,
      y: (leftEye.y + landmarks[133].y) / 2,
    }),
    rightEyeCenter: nrm({
      x: (rightEye.x + landmarks[362].x) / 2,
      y: (rightEye.y + landmarks[362].y) / 2,
    }),
    noseTip: nrm(noseTip),
    mouthCenter: nrm({
      x: (leftMouth.x + rightMouth.x) / 2,
      y: (leftMouth.y + rightMouth.y) / 2,
    }),
    jawLeft: nrm(leftCheek),
    jawRight: nrm(rightCheek),
    forehead: nrm(forehead),
  };

  return {
    landmarks: normalizedLandmarks,
    faceWidth,
    faceHeight,
    noseProtrusion: noseTip.z || 0,
    foreheadRecession: forehead.z || 0,
  };
};

// Landmarks can exist even when a face is too small, cropped, or off-centre
// for trustworthy liveness analysis. Report capture quality separately so it
// is not confused with a failed human check.
export const calculateTrackingQuality = (landmarks) => {
  const leftCheek = landmarks?.[234];
  const rightCheek = landmarks?.[454];
  const forehead = landmarks?.[10];
  const chin = landmarks?.[152];
  if (![leftCheek, rightCheek, forehead, chin].every((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  )) {
    return { score: 0, reason: 'Keep your full face in the camera frame.' };
  }

  const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
  const faceHeight = Math.abs(chin.y - forehead.y);
  const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
  const faceCenterY = (forehead.y + chin.y) / 2;
  const centreDistance = Math.hypot(faceCenterX - 0.5, faceCenterY - 0.5);
  const sizeScore = clamp((Math.min(faceWidth, faceHeight) - 0.18) / 0.18, 0, 1);
  const centeringScore = clamp(1 - centreDistance / 0.32, 0, 1);
  const score = 0.7 * sizeScore + 0.3 * centeringScore;

  let reason = 'Face tracking is ready. Stay comfortable and blink naturally.';
  if (sizeScore < 0.55) reason = 'Move a little closer so your face fills the guide.';
  else if (centeringScore < 0.55) reason = 'Center your face in the camera.';

  return { score, reason, faceWidth, faceHeight };
};

// =============================================================================
// 7. TEMPORAL MOVEMENT ANALYSIS
// =============================================================================

export const analyzeTemporalMovement = (history, config) => {
  const n = history.landmarks3D.length;
  if (n < 5) return { strength: 0, coherent: false, avgMagnitude: 0 };

  const win = Math.min(config.temporalVelocityWindow, n - 1);
  const lastFrame = history.landmarks3D[n - 1];
  // Safety check
  if (!lastFrame || !lastFrame.landmarks) {
    return { strength: 0, coherent: false, avgMagnitude: 0 };
  }

  const vels = [];
  for (let i = Math.max(0, n - win); i < n - 1; i++) {
    const curr = lastFrame.landmarks;
    const prev = history.landmarks3D[i]?.landmarks;

    // Safety check for prev
    if (!prev || !curr) continue;

    let sx = 0;
    let sy = 0;
    let cnt = 0;
    for (const k of Object.keys(curr)) {
      if (prev[k]) {
        sx += Math.abs(curr[k].x - prev[k].x);
        sy += Math.abs(curr[k].y - prev[k].y);
        cnt++;
      }
    }
    if (cnt === 0) continue;

    const s = Math.sqrt(sx * sx + sy * sy) / cnt;
    // `computeNormalizedLandmarks` has already made this face-size-relative.
    // Dividing a second time by face width made scores depend on how close the
    // person was to the camera.
    vels.push(s);
  }

  const avgMag = vels.length
    ? vels.reduce((a, b) => a + b, 0) / vels.length
    : 0;

  if (vels.length < 2)
    return { strength: avgMag, coherent: false, avgMagnitude: avgMag };

  let dirMatch = 0;
  for (let i = Math.max(0, n - win); i < n - 2; i++) {
    const curr = lastFrame.landmarks;
    const p1 = history.landmarks3D[i]?.landmarks;
    const p2 = history.landmarks3D[i + 1]?.landmarks;
    if (!p1?.noseTip || !p2?.noseTip || !curr?.noseTip) continue;
    const dx1 = curr.noseTip.x - p1.noseTip.x;
    const dx2 = p2.noseTip.x - p1.noseTip.x;
    const dy1 = curr.noseTip.y - p1.noseTip.y;
    const dy2 = p2.noseTip.y - p1.noseTip.y;
    if (
      (dx1 * dx2 > 0 && Math.abs(dx1) > 0.001) ||
      (dy1 * dy2 > 0 && Math.abs(dy1) > 0.001)
    )
      dirMatch++;
  }

  const coherence =
    dirMatch / Math.max(1, Math.min(win, n - 1) - 1);

  return {
    strength: avgMag,
    coherent: coherence > 0.3,
    avgMagnitude: avgMag,
    coherenceScore: coherence,
  };
};

// =============================================================================
// 8. HEAD POSE DIRECTIONAL CHANGE
// =============================================================================

export const analyzeHeadPoseMovement = (history, config) => {
  const n = history.yaw.length;
  if (n < config.poseMinHistory)
    return { strength: 0, hasDirectionalChange: false };

  const recent = Math.min(80, Math.floor(n * 0.6));
  const older = Math.min(80, Math.floor(n * 0.3));
  if (recent + older >= n)
    return { strength: 0, hasDirectionalChange: false };

  const slice = (arr, s, e) =>
    arr.slice(Math.max(0, s), Math.min(arr.length, e));
  const avg = (arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const yR = avg(slice(history.yaw, n - recent, n));
  const pR = avg(slice(history.pitch, n - recent, n));
  const yO = avg(slice(history.yaw, n - recent - older, n - recent));
  const pO = avg(slice(history.pitch, n - recent - older, n - recent));

  const yawDelta = Math.abs(yR - yO);
  const pitchDelta = Math.abs(pR - pO);
  const delta = Math.sqrt(yawDelta * yawDelta + pitchDelta * pitchDelta);

  let signChanges = 0;
  const half = Math.floor((n - recent) / 2);
  if (half >= 3) {
    const fSlice = slice(history.yaw, 0, half);
    const sSlice = slice(history.yaw, half, n - recent);
    const fMean = avg(fSlice);
    const sMean = avg(sSlice);
    if ((fMean > 0 && sMean < -0.5) || (fMean < -0.5 && sMean > 0))
      signChanges++;
  }

  const hasDirectionalChange =
    delta >= config.posePartialDelta ||
    (signChanges > 0 && delta >= config.poseNoise);

  return {
    strength: clamp(delta / 15, 0, 1),
    hasDirectionalChange,
    delta,
    signChanges,
  };
};

// =============================================================================
// 9. TEMPORAL EYE VARIANCE
// =============================================================================

export const analyzeTemporalEyeVariance = (history, config) => {
  const ear = history.ear;
  const n = ear.length;
  if (n < config.minHistoryForVariance)
    return { strength: 0, consistent: false };

  const windowSize = Math.min(config.varianceShortWindow, n);
  const w = ear.slice(n - windowSize);
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const variance =
    w.reduce((a, v) => a + (v - mean) ** 2, 0) / w.length;

  const hasBlinks = history.blinkEvents.length > 0;
  let consistent = false;

  if (hasBlinks && n >= config.varianceMediumWindow) {
    const m = Math.min(
      config.varianceMediumWindow,
      Math.floor(n / 2)
    );
    const fMean = ear.slice(0, m).reduce((a, b) => a + b, 0) / m;
    const sMean =
      ear.slice(n - m).reduce((a, b) => a + b, 0) / m;
    consistent =
      Math.abs(fMean - sMean) < 0.15 &&
      variance > config.varianceNoise;
  } else if (n >= config.varianceLongWindow) {
    const quarter = Math.floor(n / 4);
    const stdOfQ = [];
    for (let i = 0; i < 4; i++) {
      const q = ear.slice(i * quarter, (i + 1) * quarter);
      const qm = q.reduce((a, b) => a + b, 0) / q.length;
      stdOfQ.push(
        Math.sqrt(
          q.reduce((a, v) => a + (v - qm) ** 2, 0) / q.length
        )
      );
    }
    const avgStd =
      stdOfQ.reduce((a, b) => a + b, 0) / stdOfQ.length;
    consistent = avgStd > config.varianceNoise && avgStd < 0.08;
  }

  const effectiveVariance = hasBlinks ? variance * 1.2 : variance;
  return {
    strength: clamp(effectiveVariance / 0.002, 0, 1),
    consistent,
    variance: effectiveVariance,
  };
};

// =============================================================================
// 10. LANDMARK STABILITY
// =============================================================================

export const analyzeLandmarkStability = (history, windowSize = 40) => {
  const lm = history.landmarks3D;
  if (lm.length < 10) return { stable: true, avgStd: 0 };

  const n = Math.min(windowSize, lm.length);
  const w = lm.slice(-n);

  // Safety check
  if (!w[0] || !w[0].landmarks) {
    return { stable: true, avgStd: 0 };
  }

  const stds = [];

  for (const k of Object.keys(w[0].landmarks)) {
    const xs = w.map((f) => f.landmarks?.[k]?.x).filter(v => v !== undefined);
    const ys = w.map((f) => f.landmarks?.[k]?.y).filter(v => v !== undefined);

    if (xs.length === 0 || ys.length === 0) continue;

    const fx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const fy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sx = Math.sqrt(
      xs.reduce((a, v) => a + (v - fx) ** 2, 0) / xs.length
    );
    const sy = Math.sqrt(
      ys.reduce((a, v) => a + (v - fy) ** 2, 0) / ys.length
    );
    stds.push(sx + sy);
  }

  const avgStd = stds.reduce((a, b) => a + b, 0) / stds.length;
  return { stable: avgStd < 0.012, avgStd };
};

// =============================================================================
// 11. LANDMARK COHERENCE
// =============================================================================

export const analyzeLandmarkCoherence = (history, config) => {
  const lm = history.landmarks3D;
  if (lm.length < 10) return { coherent: true, strength: 0.5 };

  const now = lm[lm.length - 1];
  const prev = lm[Math.max(0, lm.length - 10)];
  // Safety checks
  if (!now || !now.landmarks || !prev || !prev.landmarks) {
    return { coherent: true, strength: 0.5 };
  }

  const disp = {};
  let totalMag = 0;
  let cnt = 0;
  for (const k of Object.keys(now.landmarks)) {
    if (!prev.landmarks[k]) continue;

    const dx = now.landmarks[k].x - prev.landmarks[k].x;
    const dy = now.landmarks[k].y - prev.landmarks[k].y;
    disp[k] = { x: dx, y: dy };
    totalMag += Math.sqrt(dx * dx + dy * dy);
    cnt++;
  }
  const avgMag = cnt ? totalMag / cnt : 0;

  let aligned = 0;
  const faceKeys = [
    'leftEyeCenter',
    'rightEyeCenter',
    'forehead',
    'jawLeft',
    'jawRight',
  ];
  for (const k of faceKeys) {
    if (disp[k] && avgMag > 0.001) {
      const dm = Math.sqrt(disp[k].x ** 2 + disp[k].y ** 2);
      const dot =
        disp[k].x * (now.landmarks.noseTip.x - prev.landmarks.noseTip.x) +
        disp[k].y * (now.landmarks.noseTip.y - prev.landmarks.noseTip.y);
      if (dot > 0 || dm < 0.002) aligned++;
    } else {
      aligned++;
    }
  }

  const ratio = aligned / faceKeys.length;
  return {
    coherent: ratio > config.coherenceNoise,
    strength: clamp(ratio, 0, 1),
    alignmentRatio: ratio,
  };
};

// =============================================================================
// 12. 3D DEPTH ANALYSIS (from actual Z-coordinates)
// =============================================================================

export const analyze3DDepth = (landmarks) => {
  const noseTip = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const forehead = landmarks[10];

  const noseZ = noseTip.z || 0;
  const leftCheekZ = leftCheek.z || 0;
  const rightCheekZ = rightCheek.z || 0;
  const foreheadZ = forehead.z || 0;

  const noseDepth = Math.abs(noseZ - (leftCheekZ + rightCheekZ) / 2);
  const foreheadDepth = Math.abs(foreheadZ - noseZ);
  const depthScore = (noseDepth + foreheadDepth) * 100;

  return {
    depthScore,
    noseProtrusion: noseDepth,
    foreheadRecession: foreheadDepth,
    is3D: depthScore > 5,
  };
};

// =============================================================================
// 13. ANALYZE ALL TEMPORAL SIGNALS
// =============================================================================

const sliceHistory = (arr, window) => {
  if (arr.length <= window) return arr;
  return arr.slice(arr.length - window);
};

export const analyzeAllSignals = (history) => {
  const config = LIVENESS_CONFIG;
  const valid =
    history.landmarks3D.length >= config.minHistoryForAnalysis;

  if (!valid) {
    return {
      valid: false,
      blink: { detected: false, count: 0, strength: 0 },
      temporalMovement: {
        detected: false,
        strength: 0,
        coherent: false,
      },
      headMovement: {
        detected: false,
        strength: 0,
        hasDirectionalChange: false,
      },
      eyeVariance: { detected: false, strength: 0, consistent: false },
      depth: {
        detected: false,
        strength: 0,
        noseProtrusion: 0,
        foreheadRecession: 0,
      },
      coherence: { detected: false, strength: 0, coherent: false },
      stability: { stable: true, avgStd: 0 },
    };
  }

  const blinkCount = history.blinkEvents.length;
  const blinkDetected = blinkCount >= 1;
  const lastBlink = history.blinkEvents[history.blinkEvents.length - 1];
  const timeSinceBlink = lastBlink
    ? Date.now() - lastBlink.timestamp
    : Infinity;
  const blinkStrength = blinkDetected
    ? clamp(blinkCount / 3, 0.5, 1)
    : 0;

  const tm = analyzeTemporalMovement(history, config);

  const headPose = analyzeHeadPoseMovement(history, config);

  const eyeVar = analyzeTemporalEyeVariance(history, config);

  const recentNP = sliceHistory(history.noseProtrusion, 20);
  const recentFR = sliceHistory(history.foreheadRecession, 20);
  const avgNP = recentNP.length
    ? recentNP.reduce((a, b) => a + b, 0) / recentNP.length
    : 0;
  const avgFR = recentFR.length
    ? recentFR.reduce((a, b) => a + b, 0) / recentFR.length
    : 0;
  const depthScore = (avgNP + avgFR) * 100;
  const depthDetected = depthScore > config.depthPartial * 100;
  const depthStrength = clamp(depthScore / 10, 0, 1);

  const coh = analyzeLandmarkCoherence(history, config);

  const stability = analyzeLandmarkStability(history);

  return {
    valid: true,
    blink: {
      detected: blinkDetected,
      count: blinkCount,
      strength: blinkStrength,
      timeSinceBlink,
    },
    temporalMovement: {
      detected: tm.strength > config.temporalMovementPartial,
      strength: tm.strength,
      coherent: tm.coherent,
      coherenceScore: tm.coherenceScore || 0,
    },
    headMovement: {
      detected: headPose.hasDirectionalChange,
      strength: headPose.strength,
      hasDirectionalChange: headPose.hasDirectionalChange,
    },
    eyeVariance: {
      detected:
        eyeVar.strength > config.variancePartial / 0.002 &&
        eyeVar.consistent,
      strength: eyeVar.strength,
      consistent: eyeVar.consistent,
    },
    depth: {
      detected: depthDetected,
      strength: depthStrength,
      noseProtrusion: avgNP,
      foreheadRecession: avgFR,
    },
    coherence: {
      detected: coh.strength > config.coherenceNoise,
      strength: coh.strength,
      coherent: coh.coherent,
    },
    stability: {
      stable: stability.stable,
      avgStd: stability.avgStd,
    },
  };
};

// =============================================================================
// 14. TEMPORAL CONSISTENCY ANALYSIS
// =============================================================================

const analyzeTemporalConsistency = (history) => {
  if (history.landmarks3D.length < 30) return 0;

  const recent = sliceHistory(history.landmarks3D, 20);
  const older = sliceHistory(history.landmarks3D, 40).slice(0, 20);
  if (older.length < 5 || recent.length < 5) return 0;

  // Safety check
  if (!recent[0] || !recent[0].landmarks || !older[0] || !older[0].landmarks) {
    return 0;
  }

  let totalChange = 0;
  let cnt = 0;
  for (const k of Object.keys(recent[0].landmarks)) {
    // Safety check for each landmark
    const recentValid = recent.every(f => f.landmarks && f.landmarks[k]);
    const olderValid = older.every(f => f.landmarks && f.landmarks[k]);

    if (!recentValid || !olderValid) continue;

    const rMean = {
      x:
        recent.reduce((s, f) => s + f.landmarks[k].x, 0) /
        recent.length,
      y:
        recent.reduce((s, f) => s + f.landmarks[k].y, 0) /
        recent.length,
    };
    const oMean = {
      x:
        older.reduce((s, f) => s + f.landmarks[k].x, 0) /
        older.length,
      y:
        older.reduce((s, f) => s + f.landmarks[k].y, 0) /
        older.length,
    };
    const dx = Math.abs(rMean.x - oMean.x);
    const dy = Math.abs(rMean.y - oMean.y);
    totalChange += Math.sqrt(dx * dx + dy * dy);
    cnt++;
  }

  const avgChange = cnt ? totalChange / cnt : 0;
  return clamp(avgChange / 0.04, 0, 1);
};

// =============================================================================
// 15. MAIN LIVENESS CALCULATION
// =============================================================================

export const calculateLivenessScore = (history, duration) => {
  const config = LIVENESS_CONFIG;
  const signals = analyzeAllSignals(history);

  if (!signals.valid) {
    return {
      confidence: 0,
      rawScore: 0,
      factors: [
        {
          name: 'Collecting Data...',
          score: 0,
          status: 'pending',
        },
      ],
      blinkCount: 0,
      timeSinceLastBlink: Infinity,
      microMovement: 0,
      depthScore: 0,
      hasStrongLivenessSignal: false,
      strongSignals: [],
      temporalConsistency: 0,
      livenessEvidence: [],
      debug: { state: 'INITIALIZING', reason: 'Insufficient data' },
    };
  }

  // ---- Identify Strong Signals ----
  const strongSignals = [];
  if (signals.blink.detected && signals.blink.count >= 1)
    strongSignals.push('verified_blink');
  if (
    signals.temporalMovement.detected &&
    signals.temporalMovement.coherent
  )
    strongSignals.push('temporal_movement');
  if (signals.headMovement.detected)
    strongSignals.push('head_movement');
  if (signals.eyeVariance.detected && signals.eyeVariance.consistent)
    strongSignals.push('eye_variance');

  // ---- Score Calculation ----
  let score = 0;
  const factors = [];

  // Factor 1: Verified Blink (30 pts) - STRONGEST SIGNAL
  if (signals.blink.detected && duration > 2000) {
    const pts = Math.min(
      config.scoring.blink,
      config.scoring.blink * signals.blink.strength
    );
    score += pts;
    factors.push({
      name: 'Verified Blink',
      score: Math.round(pts),
      status: 'pass',
    });
  } else if (duration < 2000) {
    score += 3;
    factors.push({
      name: 'Initializing...',
      score: 3,
      status: 'pending',
    });
  } else {
    factors.push({
      name: 'No Blink Detected',
      score: 0,
      status: 'fail',
    });
  }

  // Factor 2: Temporal Movement (20 pts)
  if (
    signals.temporalMovement.detected &&
    signals.temporalMovement.coherent
  ) {
    const strength = clamp(
      signals.temporalMovement.strength / config.temporalMovementStrong,
      0,
      1
    );
    const pts = Math.min(
      config.scoring.temporalMovement,
      config.scoring.temporalMovement * strength
    );
    score += pts;
    factors.push({
      name: 'Temporal Landmark Movement',
      score: Math.round(pts),
      status: 'pass',
    });
  } else if (signals.temporalMovement.strength > config.temporalMovementNoise) {
    const pts = Math.min(
      3,
      (signals.temporalMovement.strength / config.temporalMovementPartial) * 3
    );
    score += pts;
    factors.push({
      name: 'Minimal Movement',
      score: Math.round(pts),
      status: 'warn',
    });
  } else {
    factors.push({
      name: 'Too Static (Photo?)',
      score: 0,
      status: 'fail',
    });
  }

  // Factor 3: Head Pose Movement (15 pts)
  if (signals.headMovement.detected) {
    const pts = Math.min(
      config.scoring.headMovement,
      config.scoring.headMovement * signals.headMovement.strength
    );
    score += pts;
    factors.push({
      name: 'Head Movement',
      score: Math.round(pts),
      status: 'pass',
    });
  } else {
    factors.push({
      name: 'No Head Movement',
      score: 0,
      status: 'fail',
    });
  }

  // Factor 4: Eye Movement Variance (10 pts)
  if (signals.eyeVariance.detected && signals.eyeVariance.consistent) {
    const pts = Math.min(
      config.scoring.eyeVariance,
      config.scoring.eyeVariance * signals.eyeVariance.strength
    );
    score += pts;
    factors.push({
      name: 'Eye Movement',
      score: Math.round(pts),
      status: 'pass',
    });
  } else {
    factors.push({
      name: 'No Eye Movement',
      score: 0,
      status: 'fail',
    });
  }

  // Factor 5: 3D Depth (10 pts) - supporting evidence only
  if (signals.depth.detected) {
    const pts = Math.min(
      config.scoring.depth,
      config.scoring.depth * signals.depth.strength
    );
    score += pts;
    factors.push({
      name: '3D Depth Detected',
      score: Math.round(pts),
      status: 'pass',
    });
  } else {
    factors.push({
      name: 'Flat/2D Surface',
      score: 0,
      status: 'fail',
    });
  }

  // Factor 6: Landmark Coherence (10 pts)
  if (signals.coherence.detected && signals.coherence.coherent) {
    const pts = Math.min(
      config.scoring.coherence,
      config.scoring.coherence * signals.coherence.strength
    );
    score += pts;
    factors.push({
      name: 'Landmark Coherence',
      score: Math.round(pts),
      status: 'pass',
    });
  } else {
    factors.push({
      name: 'Low Coherence',
      score: 0,
      status: 'fail',
    });
  }

  // Factor 7: Temporal Consistency (5 pts bonus)
  const temporalConsistency = analyzeTemporalConsistency(history);
  if (temporalConsistency > 0.3 && strongSignals.length >= 2) {
    const pts = Math.min(
      config.scoring.consistency,
      config.scoring.consistency * temporalConsistency
    );
    score += pts;
    factors.push({
      name: 'Temporal Consistency',
      score: Math.round(pts),
      status: 'pass',
    });
  }

  // ---- ANTI-SPOOF: Static Face Gate ----
  const recentFrames = sliceHistory(history.landmarks3D, 10);
  const movementSamples = [];
  for (let i = 0; i < recentFrames.length - 1; i++) {
    const currentNose = recentFrames[i]?.landmarks?.noseTip;
    const nextNose = recentFrames[i + 1]?.landmarks?.noseTip;
    if (!currentNose || !nextNose) continue;

    const dx = Math.abs(currentNose.x - nextNose.x);
    const dy = Math.abs(currentNose.y - nextNose.y);
    movementSamples.push(Math.sqrt(dx * dx + dy * dy));
  }
  const avgMovement = movementSamples.length
    ? movementSamples.reduce((sum, movement) => sum + movement, 0) /
      movementSamples.length
    : 0;

  if (
    duration >= config.staticFaceDuration &&
    strongSignals.length === 0 &&
    avgMovement < config.staticMovementCap
  ) {
    score = Math.min(score, config.staticCapScore);
    factors.push({
      name: 'Static Face Gate',
      score: 0,
      status: 'fail',
      reason:
        'No meaningful temporal events detected over extended period',
    });
  }

  // ---- Normalize ----
  const confidence = clamp(score / 100, 0, 1);

  // ---- Temporal Smoothing ----
  let smoothedConfidence;
  if (history.smoothedConfidence === null) {
    smoothedConfidence = confidence;
  } else {
    smoothedConfidence =
      config.smoothingAlpha * confidence +
      (1 - config.smoothingAlpha) * history.smoothedConfidence;
  }
  history.smoothedConfidence = smoothedConfidence;

  history.confidenceHistory.push(smoothedConfidence);
  if (history.confidenceHistory.length > config.stabilityWindow * 2)
    history.confidenceHistory.shift();

  // ---- Stability check ----
  const recentConf = sliceHistory(
    history.confidenceHistory,
    config.stabilityWindow
  );
  let isStable = false;
  if (recentConf.length >= config.stabilityWindow) {
    const cMean =
      recentConf.reduce((a, b) => a + b, 0) / recentConf.length;
    const cVar =
      recentConf.reduce((a, v) => a + (v - cMean) ** 2, 0) /
      recentConf.length;
    const cStd = Math.sqrt(cVar);
    isStable = cStd < config.stabilityThreshold;
    if (history.previousRaw !== null) {
      const drift = Math.abs(smoothedConfidence - history.previousRaw);
      isStable = isStable && drift < 0.12;
    }
  }
  history.previousRaw = smoothedConfidence;

  // ---- Sustained Strong Frame Counting ----
  const hasAnyStrong = strongSignals.length > 0;
  if (hasAnyStrong && isStable) {
    history.verifiedStrongFrames++;
  } else {
    history.verifiedStrongFrames = Math.max(
      0,
      history.verifiedStrongFrames - 2
    );
  }

  // ---- Verification Result ----
  const gates = {
    hasMinimumBlink:
      !config.requireBlinkForLive ||
      signals.blink.count >= 1,
    strongSignalCount: strongSignals.length,
    sustainedStrong:
      history.verifiedStrongFrames >= config.sustainedStrongFrames,
    temporalConsistencyGate: temporalConsistency > 0.1,
  };

  let status;
  let decisionReason;

  const liveThresholdMet =
    duration >= config.minVerificationDuration &&
    smoothedConfidence >= config.liveConfidenceThreshold &&
    gates.hasMinimumBlink &&
    gates.strongSignalCount >= config.requiredStrongSignals &&
    gates.sustainedStrong &&
    gates.temporalConsistencyGate &&
    signals.stability.stable;

  if (duration < 2000) {
    status = 'UNCERTAIN';
    decisionReason = 'Initializing - collecting baseline data';
  } else if (duration < config.minVerificationDuration) {
    status = 'UNCERTAIN';
    decisionReason = `Collecting a stable baseline (${(duration / 1000).toFixed(1)}s / ${(config.minVerificationDuration / 1000).toFixed(0)}s)`;
  } else if (liveThresholdMet) {
    status = 'VERIFIED';
    decisionReason = `Multi-signal verification passed (${gates.strongSignalCount} strong signals, blink: ${gates.hasMinimumBlink}, sustained: ${history.verifiedStrongFrames} frames)`;
  } else if (
    smoothedConfidence < config.spoofConfidenceThreshold &&
    duration >= config.minVerificationDuration
  ) {
    status = 'SUSPICIOUS';
    decisionReason = `Low confidence after ${(duration / 1000).toFixed(
      1
    )}s - insufficient liveness evidence`;
  } else {
    status = 'UNCERTAIN';
    const missing = [];
    if (!gates.hasMinimumBlink) missing.push('blink');
    if (gates.strongSignalCount < config.requiredStrongSignals)
      missing.push(`${config.requiredStrongSignals - gates.strongSignalCount} more strong signals`);
    if (!gates.sustainedStrong)
      missing.push('temporal duration');
    if (!gates.temporalConsistencyGate)
      missing.push('temporal consistency');
    decisionReason = `Analyzing - waiting for: ${missing.join(', ')}`;
  }

  // ---- Liveness Evidence ----
  const livenessEvidence = [];
  if (signals.blink.detected) livenessEvidence.push('verified blink');
  if (signals.temporalMovement.detected && signals.temporalMovement.coherent)
    livenessEvidence.push('meaningful temporal movement');
  if (signals.headMovement.detected)
    livenessEvidence.push('directional head movement');
  if (signals.eyeVariance.detected && signals.eyeVariance.consistent)
    livenessEvidence.push('consistent eye movement');
  if (signals.depth.detected) livenessEvidence.push('3D depth');
  if (signals.coherence.detected && signals.coherence.coherent)
    livenessEvidence.push('landmark coherence');

  // ---- Debug ----
  const debug = {
    state: status,
    reason: decisionReason,
    faceDetected: true,
    trackingStable: signals.stability.stable,
    blink: {
      detected: signals.blink.detected,
      count: signals.blink.count,
      phase: history.blinkPhase.phase,
    },
    eyeMovement: {
      detected: signals.eyeVariance.detected,
      strength: parseFloat(signals.eyeVariance.strength.toFixed(4)),
      consistent: signals.eyeVariance.consistent,
    },
    headMovement: {
      detected: signals.headMovement.detected,
      strength: parseFloat(signals.headMovement.strength.toFixed(4)),
    },
    depth: {
      detected: signals.depth.detected,
      strength: parseFloat(signals.depth.strength.toFixed(4)),
      noseProtrusion: parseFloat(
        signals.depth.noseProtrusion.toFixed(6)
      ),
      foreheadRecession: parseFloat(
        signals.depth.foreheadRecession.toFixed(6)
      ),
    },
    temporalConsistency: parseFloat(temporalConsistency.toFixed(4)),
    rawScore: parseFloat(score.toFixed(1)),
    smoothedConfidence: parseFloat(smoothedConfidence.toFixed(4)),
    confidenceStability: parseFloat(
      (recentConf.length > 1
        ? Math.sqrt(
            recentConf.reduce(
              (a, v) =>
                a +
                (v -
                  recentConf.reduce((s, x) => s + x, 0) /
                    recentConf.length) **
                  2,
              0
            ) / recentConf.length
          )
        : 0
      ).toFixed(4)
    ),
    sustainedStrongFrames: history.verifiedStrongFrames,
    verificationGates: gates,
    liveEvidence: livenessEvidence,
    strongSignals,
  };

  return {
    confidence: smoothedConfidence,
    rawScore: score,
    factors,
    blinkCount: signals.blink.count,
    timeSinceLastBlink: signals.blink.timeSinceBlink,
    microMovement: signals.temporalMovement.strength,
    depthScore: signals.depth.strength,
    hasStrongLivenessSignal: strongSignals.length > 0,
    livenessEvidence,
    temporalConsistency,
    debug,
  };
};

// =============================================================================
// 16. PROCESS FRAME (called per frame from VideoCapture)
// =============================================================================

export const processLivenessFrame = (landmarks, imageWidth, imageHeight) => {
  const eyes = getEyeLandmarks(landmarks);
  const leftEAR = calculateEyeAspectRatio(eyes.left);
  const rightEAR = calculateEyeAspectRatio(eyes.right);
  const avgEAR = (leftEAR + rightEAR) / 2;

  const noseTip = landmarks[1];
  const chin = landmarks[152];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  const nose = { x: noseTip.x * imageWidth, y: noseTip.y * imageHeight };
  const chinPoint = { x: chin.x * imageWidth, y: chin.y * imageHeight };
  const leftEyePoint = {
    x: leftEye.x * imageWidth,
    y: leftEye.y * imageHeight,
  };
  const rightEyePoint = {
    x: rightEye.x * imageWidth,
    y: rightEye.y * imageHeight,
  };

  const eyeDistance = Math.abs(rightEyePoint.x - leftEyePoint.x);
  const eyeCenter = (leftEyePoint.x + rightEyePoint.x) / 2;
  const noseOffset = nose.x - eyeCenter;
  const yaw = eyeDistance > 0 ? (noseOffset / eyeDistance) * 100 : 0;

  const faceHeight = Math.abs(chinPoint.y - nose.y);
  const eyeY = (leftEyePoint.y + rightEyePoint.y) / 2;
  const noseRelative =
    (nose.y - eyeY) / (faceHeight > 0 ? faceHeight : 1);
  const pitch = noseRelative * 100;

  const eyeSlope =
    (rightEyePoint.y - leftEyePoint.y) /
    (rightEyePoint.x - leftEyePoint.x || 1);
  const roll = Math.atan(eyeSlope) * (180 / Math.PI);

  return {
    ear: avgEAR,
    pose: { yaw, pitch, roll },
    depth: analyze3DDepth(landmarks),
    timestamp: Date.now(),
  };
};

// =============================================================================
// 17. DEFAULT EXPORT (backwards compatibility)
// =============================================================================

export default {
  processLivenessFrame,
  detectBlinks: () => ({ blinkCount: 0, lastBlinkTime: null }),
  detectMicroMovements: () => ({ movement: 0, variance: 0 }),
  analyze3DDepth,
  calculateLivenessScore: () => ({
    confidence: 0,
    rawScore: 0,
    factors: [],
    hasStrongLivenessSignal: false,
  }),
  createTemporalHistory,
  pushTemporalFrame,
  analyzeAllSignals,
  computeNormalizedLandmarks,
  LIVENESS_CONFIG,
};
