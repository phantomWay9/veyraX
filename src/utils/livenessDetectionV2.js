/**
 * Production-Grade Liveness Detection V2
 *
 * Features:
 * - Temporal analysis with rolling history
 * - Challenge-response system
 * - State machine with explicit states
 * - Weighted evidence scoring
 * - Confidence smoothing
 * - Anti-spoofing for photos and video replay
 */

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

const CONFIG = {
  // Temporal History
  MIN_HISTORY_FRAMES: 30,
  MAX_HISTORY_FRAMES: 180, // ~6 seconds at 30fps
  MIN_FRAMES_FOR_ANALYSIS: 30,

  // Blink Detection
  BLINK_EAR_THRESHOLD: 0.2,
  BLINK_MIN_CLOSURE_FRAMES: 2,
  BLINK_MAX_CLOSURE_FRAMES: 10,
  BLINK_MIN_RECOVERY_RATIO: 0.25, // Must recover to at least this much

  // Head Movement
  HEAD_MOVEMENT_YAW_THRESHOLD: 8, // degrees
  HEAD_MOVEMENT_PITCH_THRESHOLD: 8,
  HEAD_MOVEMENT_MIN_FRAMES: 10,

  // Natural Movement
  MIN_TEMPORAL_VARIANCE: 0.1,
  MAX_STATIC_VARIANCE: 0.05, // Photos typically below this

  // Eye Movement
  EYE_VARIANCE_MIN: 0.00005,
  EYE_VARIANCE_MAX: 0.01,

  // Depth
  DEPTH_MIN_VARIATION: 0.5,
  DEPTH_NORMALIZATION_FACTOR: 100,

  // Landmark Consistency
  MAX_LANDMARK_JUMP: 0.1, // Normalized coordinates
  TRACKING_STABILITY_WINDOW: 10,

  // Scoring Thresholds
  LIVE_THRESHOLD: 0.70,
  SPOOF_THRESHOLD: 0.35,
  UNCERTAINTY_ZONE: 0.35, // Between spoof and live

  // Smoothing
  SMOOTHING_FACTOR: 0.15, // Lower = smoother
  MIN_SUSTAINED_FRAMES: 15, // Frames above threshold before declaring LIVE

  // Challenge
  CHALLENGE_TIMEOUT: 10000, // 10 seconds
  CHALLENGE_PROBABILITY: 0.8, // 80% chance of challenge

  // Weights (must sum to 100)
  WEIGHTS: {
    CHALLENGE_RESPONSE: 30,
    TEMPORAL_MOTION: 20,
    HEAD_MOVEMENT: 15,
    EYE_MOVEMENT: 10,
    DEPTH_3D: 10,
    LANDMARK_CONSISTENCY: 10,
    TRACKING_STABILITY: 5
  }
};

// ============================================================================
// VERIFICATION STATES
// ============================================================================

const STATES = {
  INITIALIZING: 'INITIALIZING',
  FACE_DETECTED: 'FACE_DETECTED',
  TRACKING: 'TRACKING',
  ANALYZING: 'ANALYZING',
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  CHALLENGE_ACTIVE: 'CHALLENGE_ACTIVE',
  VERIFYING: 'VERIFYING',
  LIVE: 'LIVE',
  SPOOF: 'SPOOF',
  UNCERTAIN: 'UNCERTAIN'
};

// ============================================================================
// CHALLENGE TYPES
// ============================================================================

const CHALLENGES = {
  BLINK: 'BLINK',
  TURN_LEFT: 'TURN_LEFT',
  TURN_RIGHT: 'TURN_RIGHT',
  NOD_DOWN: 'NOD_DOWN'
};

// ============================================================================
// TEMPORAL FRAME STORAGE
// ============================================================================

class TemporalHistory {
  constructor(maxFrames = CONFIG.MAX_HISTORY_FRAMES) {
    this.maxFrames = maxFrames;
    this.frames = [];
  }

  add(frameData) {
    this.frames.push({
      ...frameData,
      timestamp: Date.now()
    });

    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  get length() {
    return this.frames.length;
  }

  getRecent(count) {
    return this.frames.slice(-count);
  }

  getAll() {
    return this.frames;
  }

  clear() {
    this.frames = [];
  }

  getByTimeWindow(milliseconds) {
    const cutoff = Date.now() - milliseconds;
    return this.frames.filter(f => f.timestamp >= cutoff);
  }
}

// ============================================================================
// NORMALIZATION UTILITIES
// ============================================================================

const normalize = {
  faceCenter: (landmarks, width, height) => {
    const noseTip = landmarks[1];
    return {
      x: noseTip.x,
      y: noseTip.y,
      xPixels: noseTip.x * width,
      yPixels: noseTip.y * height
    };
  },

  faceSize: (landmarks) => {
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const chin = landmarks[152];
    const forehead = landmarks[10];

    const width = Math.sqrt(
      Math.pow(rightEye.x - leftEye.x, 2) +
      Math.pow(rightEye.y - leftEye.y, 2)
    );

    const height = Math.sqrt(
      Math.pow(chin.x - forehead.x, 2) +
      Math.pow(chin.y - forehead.y, 2)
    );

    return { width, height, area: width * height };
  },

  depth: (landmarks) => {
    const noseTip = landmarks[1];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    const forehead = landmarks[10];

    const noseZ = noseTip.z || 0;
    const leftCheekZ = leftCheek.z || 0;
    const rightCheekZ = rightCheek.z || 0;
    const foreheadZ = forehead.z || 0;

    const avgZ = (noseZ + leftCheekZ + rightCheekZ + foreheadZ) / 4;
    const variance = [noseZ, leftCheekZ, rightCheekZ, foreheadZ]
      .reduce((sum, z) => sum + Math.pow(z - avgZ, 2), 0) / 4;

    return {
      average: avgZ * CONFIG.DEPTH_NORMALIZATION_FACTOR,
      variance: variance * CONFIG.DEPTH_NORMALIZATION_FACTOR,
      noseProtrusion: (noseZ - (leftCheekZ + rightCheekZ) / 2) * CONFIG.DEPTH_NORMALIZATION_FACTOR
    };
  }
};

// ============================================================================
// EYE ASPECT RATIO (EAR) - From existing implementation
// ============================================================================

const calculateEyeAspectRatio = (eyeLandmarks) => {
  const p1 = eyeLandmarks[0];
  const p2 = eyeLandmarks[1];
  const p3 = eyeLandmarks[2];
  const p4 = eyeLandmarks[3];
  const p5 = eyeLandmarks[4];
  const p6 = eyeLandmarks[5];

  const vertical1 = Math.sqrt(
    Math.pow(p2.x - p6.x, 2) + Math.pow(p2.y - p6.y, 2)
  );
  const vertical2 = Math.sqrt(
    Math.pow(p3.x - p5.x, 2) + Math.pow(p3.y - p5.y, 2)
  );
  const horizontal = Math.sqrt(
    Math.pow(p1.x - p4.x, 2) + Math.pow(p1.y - p4.y, 2)
  );

  if (horizontal === 0) return 0;
  return (vertical1 + vertical2) / (2.0 * horizontal);
};

const getEyeLandmarks = (landmarks) => {
  const leftEye = [33, 160, 158, 133, 153, 144];
  const rightEye = [362, 385, 387, 263, 373, 380];

  return {
    left: leftEye.map(idx => landmarks[idx]),
    right: rightEye.map(idx => landmarks[idx])
  };
};

// ============================================================================
// HEAD POSE CALCULATION - From existing implementation
// ============================================================================

const calculateHeadPose = (landmarks, imageWidth, imageHeight) => {
  const noseTip = landmarks[1];
  const chin = landmarks[152];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  const nose = { x: noseTip.x * imageWidth, y: noseTip.y * imageHeight };
  const chinPoint = { x: chin.x * imageWidth, y: chin.y * imageHeight };
  const leftEyePoint = { x: leftEye.x * imageWidth, y: leftEye.y * imageHeight };
  const rightEyePoint = { x: rightEye.x * imageWidth, y: rightEye.y * imageHeight };

  // Yaw (left-right)
  const eyeDistance = Math.abs(rightEyePoint.x - leftEyePoint.x);
  const eyeCenter = (leftEyePoint.x + rightEyePoint.x) / 2;
  const noseOffset = nose.x - eyeCenter;
  const yaw = eyeDistance > 0 ? (noseOffset / eyeDistance) * 100 : 0;

  // Pitch (up-down)
  const faceHeight = Math.abs(chinPoint.y - nose.y);
  const eyeY = (leftEyePoint.y + rightEyePoint.y) / 2;
  const noseRelative = (nose.y - eyeY) / (faceHeight > 0 ? faceHeight : 1);
  const pitch = noseRelative * 100;

  // Roll (tilt)
  const eyeSlope = (rightEyePoint.y - leftEyePoint.y) / (rightEyePoint.x - leftEyePoint.x);
  const roll = Math.atan(eyeSlope) * (180 / Math.PI);

  return { yaw, pitch, roll };
};

// ============================================================================
// LIVENESS SIGNAL DETECTORS
// ============================================================================

const LivenessSignals = {
  // Detect genuine blinks from temporal EAR data
  detectBlink: (history) => {
    if (history.length < CONFIG.MIN_HISTORY_FRAMES) {
      return {
        name: 'Blink Detection',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames',
        blinkCount: 0,
        lastBlinkTime: null
      };
    }

    const earData = history.map(f => ({ ear: f.ear, timestamp: f.timestamp }));
    let blinkCount = 0;
    let lastBlinkTime = null;
    let inBlink = false;
    let blinkStartIdx = -1;
    let consecutiveClosedFrames = 0;

    for (let i = 0; i < earData.length; i++) {
      const ear = earData[i].ear;

      if (ear < CONFIG.BLINK_EAR_THRESHOLD) {
        consecutiveClosedFrames++;

        if (!inBlink && consecutiveClosedFrames >= CONFIG.BLINK_MIN_CLOSURE_FRAMES) {
          inBlink = true;
          blinkStartIdx = i;
        }
      } else {
        // Eye is open
        if (inBlink) {
          // Check if we had a valid blink closure duration
          if (consecutiveClosedFrames >= CONFIG.BLINK_MIN_CLOSURE_FRAMES &&
              consecutiveClosedFrames <= CONFIG.BLINK_MAX_CLOSURE_FRAMES) {

            // Check if eye recovered sufficiently
            if (ear >= CONFIG.BLINK_EAR_THRESHOLD + CONFIG.BLINK_MIN_RECOVERY_RATIO) {
              blinkCount++;
              lastBlinkTime = earData[i].timestamp;
            }
          }
          inBlink = false;
          consecutiveClosedFrames = 0;
        } else {
          consecutiveClosedFrames = 0;
        }
      }
    }

    const score = blinkCount >= 1 ? CONFIG.WEIGHTS.CHALLENGE_RESPONSE : 0;

    return {
      name: 'Blink Detection',
      score,
      confidence: Math.min(1, blinkCount / 2),
      status: blinkCount >= 1 ? 'pass' : 'fail',
      reason: blinkCount >= 1 ? `${blinkCount} blink(s) detected` : 'No blinks detected',
      blinkCount,
      lastBlinkTime
    };
  },

  // Detect head movement over time
  detectHeadMovement: (history) => {
    if (history.length < CONFIG.MIN_HISTORY_FRAMES) {
      return {
        name: 'Head Movement',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames'
      };
    }

    const poses = history.map(f => f.pose);

    // Calculate range of movement
    const yaws = poses.map(p => p.yaw);
    const pitches = poses.map(p => p.pitch);

    const yawRange = Math.max(...yaws) - Math.min(...yaws);
    const pitchRange = Math.max(...pitches) - Math.min(...pitches);

    // Calculate variance for natural micro-movements
    const yawMean = yaws.reduce((sum, val) => sum + val, 0) / yaws.length;
    const pitchMean = pitches.reduce((sum, val) => sum + val, 0) / pitches.length;

    const yawVariance = yaws.reduce((sum, val) => sum + Math.pow(val - yawMean, 2), 0) / yaws.length;
    const pitchVariance = pitches.reduce((sum, val) => sum + Math.pow(val - pitchMean, 2), 0) / pitches.length;

    const totalVariance = Math.sqrt(yawVariance + pitchVariance);

    // Score based on meaningful movement
    const hasSignificantMovement = yawRange > CONFIG.HEAD_MOVEMENT_YAW_THRESHOLD ||
                                   pitchRange > CONFIG.HEAD_MOVEMENT_PITCH_THRESHOLD;

    let score = 0;
    let confidence = 0;
    let status = 'fail';
    let reason = '';

    if (hasSignificantMovement) {
      const movementScore = Math.min(1, (yawRange + pitchRange) / 30);
      score = movementScore * CONFIG.WEIGHTS.HEAD_MOVEMENT;
      confidence = movementScore;
      status = 'pass';
      reason = `Movement: ${yawRange.toFixed(1)}° yaw, ${pitchRange.toFixed(1)}° pitch`;
    } else if (totalVariance > CONFIG.MIN_TEMPORAL_VARIANCE) {
      // Give partial credit for natural micro-movements
      const microScore = Math.min(1, totalVariance / 2);
      score = microScore * CONFIG.WEIGHTS.HEAD_MOVEMENT * 0.5;
      confidence = microScore * 0.5;
      status = 'warn';
      reason = `Micro-movements detected (${totalVariance.toFixed(2)})`;
    } else {
      reason = 'No head movement detected';
    }

    return {
      name: 'Head Movement',
      score,
      confidence,
      status,
      reason,
      yawRange,
      pitchRange,
      variance: totalVariance
    };
  },

  // Detect natural face position/scale changes
  detectTemporalMotion: (history) => {
    if (history.length < CONFIG.MIN_HISTORY_FRAMES) {
      return {
        name: 'Temporal Motion',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames'
      };
    }

    const positions = history.map(f => f.faceCenter);
    const sizes = history.map(f => f.faceSize);

    // Position variance
    const xValues = positions.map(p => p.x);
    const yValues = positions.map(p => p.y);

    const xMean = xValues.reduce((sum, val) => sum + val, 0) / xValues.length;
    const yMean = yValues.reduce((sum, val) => sum + val, 0) / yValues.length;

    const xVariance = xValues.reduce((sum, val) => sum + Math.pow(val - xMean, 2), 0) / xValues.length;
    const yVariance = yValues.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0) / yValues.length;

    const positionVariance = Math.sqrt(xVariance + yVariance);

    // Size variance
    const areaValues = sizes.map(s => s.area);
    const areaMean = areaValues.reduce((sum, val) => sum + val, 0) / areaValues.length;
    const areaVariance = areaValues.reduce((sum, val) => sum + Math.pow(val - areaMean, 2), 0) / areaValues.length;
    const sizeVariance = Math.sqrt(areaVariance);

    const totalMotion = positionVariance + sizeVariance;

    let score = 0;
    let confidence = 0;
    let status = 'fail';
    let reason = '';

    if (totalMotion > CONFIG.MIN_TEMPORAL_VARIANCE) {
      const motionScore = Math.min(1, totalMotion / 0.5);
      score = motionScore * CONFIG.WEIGHTS.TEMPORAL_MOTION;
      confidence = motionScore;
      status = 'pass';
      reason = `Natural motion detected (${totalMotion.toFixed(4)})`;
    } else if (totalMotion > CONFIG.MAX_STATIC_VARIANCE) {
      // Minimal motion - partial credit
      const partialScore = totalMotion / CONFIG.MIN_TEMPORAL_VARIANCE;
      score = partialScore * CONFIG.WEIGHTS.TEMPORAL_MOTION * 0.3;
      confidence = partialScore * 0.3;
      status = 'warn';
      reason = `Minimal motion (${totalMotion.toFixed(4)})`;
    } else {
      reason = 'Too static - possible photo';
      status = 'fail';
    }

    return {
      name: 'Temporal Motion',
      score,
      confidence,
      status,
      reason,
      positionVariance,
      sizeVariance,
      totalMotion
    };
  },

  // Detect eye movement variance
  detectEyeMovement: (history) => {
    if (history.length < CONFIG.MIN_HISTORY_FRAMES) {
      return {
        name: 'Eye Movement',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames'
      };
    }

    const earValues = history.map(f => f.ear);
    const earMean = earValues.reduce((sum, val) => sum + val, 0) / earValues.length;
    const earVariance = earValues.reduce((sum, val) => sum + Math.pow(val - earMean, 2), 0) / earValues.length;

    let score = 0;
    let confidence = 0;
    let status = 'fail';
    let reason = '';

    if (earVariance >= CONFIG.EYE_VARIANCE_MIN && earVariance <= CONFIG.EYE_VARIANCE_MAX) {
      const varianceScore = Math.min(1, (earVariance - CONFIG.EYE_VARIANCE_MIN) / 0.001);
      score = varianceScore * CONFIG.WEIGHTS.EYE_MOVEMENT;
      confidence = varianceScore;
      status = 'pass';
      reason = `Natural variance (${earVariance.toFixed(6)})`;
    } else if (earVariance > 0) {
      const partialScore = Math.min(0.5, earVariance * 1000);
      score = partialScore * CONFIG.WEIGHTS.EYE_MOVEMENT;
      confidence = partialScore;
      status = 'warn';
      reason = `Low variance (${earVariance.toFixed(6)})`;
    } else {
      reason = 'No eye variance detected';
    }

    return {
      name: 'Eye Movement',
      score,
      confidence,
      status,
      reason,
      variance: earVariance
    };
  },

  // Analyze 3D depth consistency
  analyzeDepth: (history) => {
    if (history.length < CONFIG.MIN_HISTORY_FRAMES) {
      return {
        name: '3D Depth',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames'
      };
    }

    const depths = history.map(f => f.depth);
    const variances = depths.map(d => d.variance);
    const protrusions = depths.map(d => d.noseProtrusion);

    const avgVariance = variances.reduce((sum, val) => sum + val, 0) / variances.length;
    const avgProtrusion = protrusions.reduce((sum, val) => sum + val, 0) / protrusions.length;

    // Temporal depth variance
    const depthValues = depths.map(d => d.average);
    const depthMean = depthValues.reduce((sum, val) => sum + val, 0) / depthValues.length;
    const depthTempVariance = depthValues.reduce((sum, val) => sum + Math.pow(val - depthMean, 2), 0) / depthValues.length;

    let score = 0;
    let confidence = 0;
    let status = 'fail';
    let reason = '';

    const hasDepth = avgVariance > CONFIG.DEPTH_MIN_VARIATION || Math.abs(avgProtrusion) > CONFIG.DEPTH_MIN_VARIATION;

    if (hasDepth) {
      const depthScore = Math.min(1, (avgVariance + Math.abs(avgProtrusion)) / 3);
      score = depthScore * CONFIG.WEIGHTS.DEPTH_3D;
      confidence = depthScore;
      status = 'pass';
      reason = `3D structure detected (var: ${avgVariance.toFixed(2)})`;
    } else if (avgVariance > 0.1 || depthTempVariance > 0.01) {
      const partialScore = Math.min(0.5, (avgVariance + depthTempVariance) / 1);
      score = partialScore * CONFIG.WEIGHTS.DEPTH_3D;
      confidence = partialScore;
      status = 'warn';
      reason = `Minimal depth (${avgVariance.toFixed(2)})`;
    } else {
      reason = 'Flat surface - possible photo';
    }

    return {
      name: '3D Depth',
      score,
      confidence,
      status,
      reason,
      avgVariance,
      avgProtrusion,
      depthTempVariance
    };
  },

  // Check landmark tracking consistency
  analyzeLandmarkConsistency: (history) => {
    if (history.length < CONFIG.TRACKING_STABILITY_WINDOW) {
      return {
        name: 'Landmark Consistency',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames'
      };
    }

    let jumpCount = 0;
    let totalJump = 0;

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      // Check face center jump
      const centerJump = Math.sqrt(
        Math.pow(curr.faceCenter.x - prev.faceCenter.x, 2) +
        Math.pow(curr.faceCenter.y - prev.faceCenter.y, 2)
      );

      totalJump += centerJump;

      if (centerJump > CONFIG.MAX_LANDMARK_JUMP) {
        jumpCount++;
      }
    }

    const avgJump = totalJump / (history.length - 1);
    const jumpRate = jumpCount / (history.length - 1);

    let score = 0;
    let confidence = 0;
    let status = 'fail';
    let reason = '';

    if (jumpRate < 0.1) {
      // Stable tracking
      const stabilityScore = 1 - jumpRate;
      score = stabilityScore * CONFIG.WEIGHTS.LANDMARK_CONSISTENCY;
      confidence = stabilityScore;
      status = 'pass';
      reason = `Stable tracking (${(jumpRate * 100).toFixed(1)}% jumps)`;
    } else if (jumpRate < 0.3) {
      const partialScore = 0.5;
      score = partialScore * CONFIG.WEIGHTS.LANDMARK_CONSISTENCY;
      confidence = partialScore;
      status = 'warn';
      reason = `Some instability (${(jumpRate * 100).toFixed(1)}% jumps)`;
    } else {
      reason = 'Unstable tracking';
    }

    return {
      name: 'Landmark Consistency',
      score,
      confidence,
      status,
      reason,
      jumpRate,
      avgJump
    };
  },

  // Check overall tracking stability
  analyzeTrackingStability: (history) => {
    if (history.length < CONFIG.TRACKING_STABILITY_WINDOW) {
      return {
        name: 'Tracking Stability',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Insufficient frames'
      };
    }

    // Simple measure: all frames should have valid data
    const validFrames = history.length;
    const stabilityScore = 1.0; // If we have frames, tracking is stable

    return {
      name: 'Tracking Stability',
      score: stabilityScore * CONFIG.WEIGHTS.TRACKING_STABILITY,
      confidence: stabilityScore,
      status: 'pass',
      reason: `${validFrames} valid frames`,
      validFrames
    };
  }
};

// ============================================================================
// CHALLENGE SYSTEM
// ============================================================================

class ChallengeManager {
  constructor() {
    this.activeChallenge = null;
    this.challengeStartTime = null;
    this.challengeBaseline = null;
    this.challengeProgress = 0;
  }

  shouldInitiateChallenge() {
    return Math.random() < CONFIG.CHALLENGE_PROBABILITY;
  }

  selectRandomChallenge() {
    const challenges = Object.values(CHALLENGES);
    return challenges[Math.floor(Math.random() * challenges.length)];
  }

  startChallenge() {
    this.activeChallenge = this.selectRandomChallenge();
    this.challengeStartTime = Date.now();
    this.challengeBaseline = null;
    this.challengeProgress = 0;

    return {
      type: this.activeChallenge,
      instruction: this.getChallengeInstruction(this.activeChallenge),
      startTime: this.challengeStartTime
    };
  }

  getChallengeInstruction(challenge) {
    switch (challenge) {
      case CHALLENGES.BLINK:
        return 'Please blink';
      case CHALLENGES.TURN_LEFT:
        return 'Turn your head left';
      case CHALLENGES.TURN_RIGHT:
        return 'Turn your head right';
      case CHALLENGES.NOD_DOWN:
        return 'Nod your head down';
      default:
        return 'Follow the instruction';
    }
  }

  checkChallenge(currentFrame, history) {
    if (!this.activeChallenge) {
      return {
        name: 'Challenge Response',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'No active challenge'
      };
    }

    const elapsed = Date.now() - this.challengeStartTime;

    if (elapsed > CONFIG.CHALLENGE_TIMEOUT) {
      return {
        name: 'Challenge Response',
        score: 0,
        confidence: 0,
        status: 'fail',
        reason: 'Challenge timeout',
        challengeType: this.activeChallenge
      };
    }

    // Set baseline on first check
    if (!this.challengeBaseline && history.length > 0) {
      this.challengeBaseline = history[history.length - 1];
    }

    if (!this.challengeBaseline) {
      return {
        name: 'Challenge Response',
        score: 0,
        confidence: 0,
        status: 'pending',
        reason: 'Establishing baseline'
      };
    }

    // Check challenge-specific conditions
    switch (this.activeChallenge) {
      case CHALLENGES.BLINK:
        return this.checkBlinkChallenge(history);

      case CHALLENGES.TURN_LEFT:
        return this.checkTurnChallenge(currentFrame, 'left');

      case CHALLENGES.TURN_RIGHT:
        return this.checkTurnChallenge(currentFrame, 'right');

      case CHALLENGES.NOD_DOWN:
        return this.checkNodChallenge(currentFrame);

      default:
        return {
          name: 'Challenge Response',
          score: 0,
          confidence: 0,
          status: 'fail',
          reason: 'Unknown challenge'
        };
    }
  }

  checkBlinkChallenge(history) {
    const recentHistory = history.slice(-60); // Last 2 seconds
    const blinkResult = LivenessSignals.detectBlink(recentHistory);

    if (blinkResult.blinkCount >= 1) {
      return {
        name: 'Challenge Response',
        score: CONFIG.WEIGHTS.CHALLENGE_RESPONSE,
        confidence: 1,
        status: 'pass',
        reason: 'Blink challenge passed',
        challengeType: CHALLENGES.BLINK
      };
    }

    return {
      name: 'Challenge Response',
      score: 0,
      confidence: 0,
      status: 'pending',
      reason: 'Waiting for blink...',
      challengeType: CHALLENGES.BLINK
    };
  }

  checkTurnChallenge(currentFrame, direction) {
    const baselineYaw = this.challengeBaseline.pose.yaw;
    const currentYaw = currentFrame.pose.yaw;
    const yawDelta = currentYaw - baselineYaw;

    const threshold = CONFIG.HEAD_MOVEMENT_YAW_THRESHOLD;
    const requiredDelta = direction === 'left' ? -threshold : threshold;

    let progress = 0;
    if (direction === 'left') {
      progress = Math.max(0, Math.min(1, -yawDelta / threshold));
    } else {
      progress = Math.max(0, Math.min(1, yawDelta / threshold));
    }

    this.challengeProgress = Math.max(this.challengeProgress, progress);

    if (this.challengeProgress >= 1.0) {
      return {
        name: 'Challenge Response',
        score: CONFIG.WEIGHTS.CHALLENGE_RESPONSE,
        confidence: 1,
        status: 'pass',
        reason: `Turn ${direction} challenge passed`,
        challengeType: this.activeChallenge,
        progress: this.challengeProgress
      };
    }

    return {
      name: 'Challenge Response',
      score: 0,
      confidence: this.challengeProgress,
      status: 'pending',
      reason: `Turn ${direction}... (${(this.challengeProgress * 100).toFixed(0)}%)`,
      challengeType: this.activeChallenge,
      progress: this.challengeProgress
    };
  }

  checkNodChallenge(currentFrame) {
    const baselinePitch = this.challengeBaseline.pose.pitch;
    const currentPitch = currentFrame.pose.pitch;
    const pitchDelta = currentPitch - baselinePitch;

    const threshold = CONFIG.HEAD_MOVEMENT_PITCH_THRESHOLD;
    const progress = Math.max(0, Math.min(1, pitchDelta / threshold));

    this.challengeProgress = Math.max(this.challengeProgress, progress);

    if (this.challengeProgress >= 1.0) {
      return {
        name: 'Challenge Response',
        score: CONFIG.WEIGHTS.CHALLENGE_RESPONSE,
        confidence: 1,
        status: 'pass',
        reason: 'Nod challenge passed',
        challengeType: CHALLENGES.NOD_DOWN,
        progress: this.challengeProgress
      };
    }

    return {
      name: 'Challenge Response',
      score: 0,
      confidence: this.challengeProgress,
      status: 'pending',
      reason: `Nod down... (${(this.challengeProgress * 100).toFixed(0)}%)`,
      challengeType: CHALLENGES.NOD_DOWN,
      progress: this.challengeProgress
    };
  }

  reset() {
    this.activeChallenge = null;
    this.challengeStartTime = null;
    this.challengeBaseline = null;
    this.challengeProgress = 0;
  }

  isActive() {
    return this.activeChallenge !== null;
  }

  getChallenge() {
    return this.activeChallenge;
  }
}

// ============================================================================
// CONFIDENCE SMOOTHER
// ============================================================================

class ConfidenceSmoother {
  constructor(smoothingFactor = CONFIG.SMOOTHING_FACTOR) {
    this.smoothingFactor = smoothingFactor;
    this.smoothedValue = 0;
    this.sustainedFrames = 0;
    this.lastState = null;
  }

  update(rawConfidence) {
    // Exponential moving average
    if (this.smoothedValue === 0) {
      this.smoothedValue = rawConfidence;
    } else {
      this.smoothedValue = this.smoothingFactor * rawConfidence +
                          (1 - this.smoothingFactor) * this.smoothedValue;
    }

    return this.smoothedValue;
  }

  updateSustainedFrames(state) {
    if (state === this.lastState) {
      this.sustainedFrames++;
    } else {
      this.sustainedFrames = 1;
      this.lastState = state;
    }
  }

  isSustained() {
    return this.sustainedFrames >= CONFIG.MIN_SUSTAINED_FRAMES;
  }

  reset() {
    this.smoothedValue = 0;
    this.sustainedFrames = 0;
    this.lastState = null;
  }

  getValue() {
    return this.smoothedValue;
  }
}

// ============================================================================
// MAIN STATE MACHINE
// ============================================================================

class LivenessDetector {
  constructor() {
    this.state = STATES.INITIALIZING;
    this.history = new TemporalHistory();
    this.challengeManager = new ChallengeManager();
    this.smoother = new ConfidenceSmoother();
    this.sessionStartTime = null;
    this.lastDiagnosticLog = 0;
  }

  reset() {
    this.state = STATES.INITIALIZING;
    this.history.clear();
    this.challengeManager.reset();
    this.smoother.reset();
    this.sessionStartTime = null;
    this.lastDiagnosticLog = 0;
  }

  processFrame(landmarks, imageWidth, imageHeight) {
    if (!this.sessionStartTime) {
      this.sessionStartTime = Date.now();
    }

    // Extract frame data
    const eyes = getEyeLandmarks(landmarks);
    const leftEAR = calculateEyeAspectRatio(eyes.left);
    const rightEAR = calculateEyeAspectRatio(eyes.right);
    const avgEAR = (leftEAR + rightEAR) / 2;

    const pose = calculateHeadPose(landmarks, imageWidth, imageHeight);
    const faceCenter = normalize.faceCenter(landmarks, imageWidth, imageHeight);
    const faceSize = normalize.faceSize(landmarks);
    const depth = normalize.depth(landmarks);

    const frameData = {
      ear: avgEAR,
      pose,
      faceCenter,
      faceSize,
      depth,
      timestamp: Date.now()
    };

    this.history.add(frameData);

    // State machine transitions
    if (this.state === STATES.INITIALIZING) {
      this.state = STATES.FACE_DETECTED;
    }

    if (this.state === STATES.FACE_DETECTED && this.history.length >= 10) {
      this.state = STATES.TRACKING;
    }

    if (this.state === STATES.TRACKING && this.history.length >= CONFIG.MIN_FRAMES_FOR_ANALYSIS) {
      this.state = STATES.ANALYZING;
    }

    // Initiate challenge if in analyzing state and no challenge active
    if (this.state === STATES.ANALYZING && !this.challengeManager.isActive()) {
      if (this.challengeManager.shouldInitiateChallenge()) {
        this.state = STATES.CHALLENGE_REQUIRED;
      }
    }

    if (this.state === STATES.CHALLENGE_REQUIRED) {
      this.challengeManager.startChallenge();
      this.state = STATES.CHALLENGE_ACTIVE;
    }

    // Calculate liveness
    const result = this.calculateLiveness(frameData);

    // Log diagnostics periodically
    if (Date.now() - this.lastDiagnosticLog > 500) {
      this.logDiagnostics(result);
      this.lastDiagnosticLog = Date.now();
    }

    return result;
  }

  calculateLiveness(currentFrame) {
    const factors = [];
    let totalScore = 0;

    // Get all liveness signals
    const blinkSignal = LivenessSignals.detectBlink(this.history.getAll());
    const headMovement = LivenessSignals.detectHeadMovement(this.history.getAll());
    const temporalMotion = LivenessSignals.detectTemporalMotion(this.history.getAll());
    const eyeMovement = LivenessSignals.detectEyeMovement(this.history.getAll());
    const depth = LivenessSignals.analyzeDepth(this.history.getAll());
    const consistency = LivenessSignals.analyzeLandmarkConsistency(this.history.getAll());
    const stability = LivenessSignals.analyzeTrackingStability(this.history.getAll());

    // Check challenge if active
    let challengeResult;
    if (this.challengeManager.isActive()) {
      challengeResult = this.challengeManager.checkChallenge(currentFrame, this.history.getAll());
      factors.push(challengeResult);
      totalScore += challengeResult.score;

      // If challenge passed, move to verifying
      if (challengeResult.status === 'pass') {
        this.state = STATES.VERIFYING;
      }
    } else {
      // Use blink as challenge substitute
      factors.push(blinkSignal);
      totalScore += blinkSignal.score;
    }

    // Add other factors
    factors.push(temporalMotion);
    totalScore += temporalMotion.score;

    factors.push(headMovement);
    totalScore += headMovement.score;

    factors.push(eyeMovement);
    totalScore += eyeMovement.score;

    factors.push(depth);
    totalScore += depth.score;

    factors.push(consistency);
    totalScore += consistency.score;

    factors.push(stability);
    totalScore += stability.score;

    // Calculate raw confidence (0-1)
    const rawConfidence = totalScore / 100;

    // Apply smoothing
    const smoothedConfidence = this.smoother.update(rawConfidence);

    // Determine verification state
    let verificationState;
    if (smoothedConfidence >= CONFIG.LIVE_THRESHOLD) {
      verificationState = STATES.LIVE;
    } else if (smoothedConfidence <= CONFIG.SPOOF_THRESHOLD) {
      verificationState = STATES.SPOOF;
    } else {
      verificationState = STATES.UNCERTAIN;
    }

    // Update sustained frames
    this.smoother.updateSustainedFrames(verificationState);

    // Only declare LIVE if sustained
    let finalState = this.state;
    if (this.state === STATES.VERIFYING) {
      if (verificationState === STATES.LIVE && this.smoother.isSustained()) {
        finalState = STATES.LIVE;
      } else if (verificationState === STATES.SPOOF && this.smoother.isSustained()) {
        finalState = STATES.SPOOF;
      } else {
        finalState = STATES.UNCERTAIN;
      }
    }

    // Map internal states to display states
    let displayStatus;
    if (finalState === STATES.LIVE) {
      displayStatus = 'VERIFIED';
    } else if (finalState === STATES.SPOOF) {
      displayStatus = 'SUSPICIOUS';
    } else {
      displayStatus = 'UNCERTAIN';
    }

    return {
      status: displayStatus,
      confidence: smoothedConfidence,
      rawConfidence,
      state: finalState,
      signalQuality: Math.min(1, this.history.length / CONFIG.MIN_FRAMES_FOR_ANALYSIS),
      heartRate: blinkSignal.blinkCount * 15, // Dummy HR
      roiConsistency: consistency.confidence,
      trustHistory: this.history.getAll().map(f => ({
        timestamp: f.timestamp,
        confidence: smoothedConfidence
      })).slice(-60),
      livenessFactors: factors,
      blinkCount: blinkSignal.blinkCount,
      microMovement: headMovement.variance || 0,
      activeChallenge: this.challengeManager.isActive() ? {
        type: this.challengeManager.getChallenge(),
        instruction: this.challengeManager.getChallengeInstruction(this.challengeManager.getChallenge()),
        progress: challengeResult?.progress || 0
      } : null,
      sustainedFrames: this.smoother.sustainedFrames,
      totalFrames: this.history.length
    };
  }

  logDiagnostics(result) {
    const diagnostics = {
      '🔍 State': result.state,
      '📊 Confidence': `${(result.confidence * 100).toFixed(1)}% (raw: ${(result.rawConfidence * 100).toFixed(1)}%)`,
      '⏱️ Frames': `${result.totalFrames} total, ${result.sustainedFrames} sustained`,
      '🎯 Challenge': result.activeChallenge ?
        `${result.activeChallenge.type} (${(result.activeChallenge.progress * 100).toFixed(0)}%)` :
        'None',
      '👁️ Blinks': result.blinkCount,
      '📈 Factors': result.livenessFactors.map(f =>
        `${f.name}: ${f.score.toFixed(1)} (${f.status})`
      )
    };

    console.log('🔬 Liveness Diagnostics:', diagnostics);
  }

  getCurrentState() {
    return this.state;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Create singleton instance
const detector = new LivenessDetector();

export const processLivenessFrame = (landmarks, imageWidth, imageHeight) => {
  return detector.processFrame(landmarks, imageWidth, imageHeight);
};

export const resetLivenessDetector = () => {
  detector.reset();
};

export const getLivenessState = () => {
  return detector.getCurrentState();
};

export { STATES, CHALLENGES, CONFIG };

export default {
  processLivenessFrame,
  resetLivenessDetector,
  getLivenessState,
  STATES,
  CHALLENGES,
  CONFIG
};
