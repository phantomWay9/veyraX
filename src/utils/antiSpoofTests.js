/**
 * Enhanced Photo/Replay Detection System
 * Multiple validation layers to reject non-live content
 */

/**
 * Test 1: Temporal Variance Analysis
 * Photos have near-zero variance over time
 */
export const detectTemporalVariance = (rgbHistory) => {
  if (rgbHistory.length < 60) return { score: 0, isLive: false };

  const regions = ['forehead', 'leftCheek', 'rightCheek'];
  const variances = [];

  regions.forEach(region => {
    const values = rgbHistory.map(frame => frame[region]?.r || 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    variances.push(variance);
  });

  const avgVariance = variances.reduce((sum, v) => sum + v, 0) / variances.length;

  // Real faces: variance > 5.0
  // Photos: variance < 1.0
  const isLive = avgVariance > 3.0;
  const score = Math.min(1, avgVariance / 10);

  return {
    score,
    isLive,
    variance: avgVariance,
    threshold: 3.0,
    description: `Temporal variance: ${avgVariance.toFixed(2)} (${isLive ? 'LIVE' : 'STATIC'})`
  };
};

/**
 * Test 2: Frequency Domain Analysis
 * Photos lack periodic components in heart rate range
 */
export const detectPeriodicSignal = (signalData) => {
  const { freqAnalysis, heartRate } = signalData;

  if (!freqAnalysis || Object.keys(freqAnalysis).length === 0) {
    return { score: 0, isLive: false, description: 'No frequency data' };
  }

  // Check SNR across all ROIs
  const snrValues = Object.values(freqAnalysis).map(fa => fa.snr).filter(snr => snr > 0);
  const avgSNR = snrValues.length > 0 ? snrValues.reduce((sum, snr) => sum + snr, 0) / snrValues.length : 0;

  // Check if detected frequency is in plausible heart rate range
  const hrPlausible = heartRate >= 45 && heartRate <= 150;

  // Real faces: SNR > 2.5, plausible HR
  // Photos: SNR < 1.5 or implausible HR
  const isLive = avgSNR > 2.0 && hrPlausible;
  const score = Math.min(1, avgSNR / 6);

  return {
    score,
    isLive,
    snr: avgSNR,
    heartRate,
    hrPlausible,
    threshold: 2.0,
    description: `SNR: ${avgSNR.toFixed(2)}, HR: ${heartRate} BPM (${isLive ? 'LIVE' : 'NO SIGNAL'})`
  };
};

/**
 * Test 3: Cross-ROI Phase Consistency
 * Real faces: slight phase delays between regions (blood propagation)
 * Photos/Screens: artificially synchronized or inconsistent
 */
export const detectPhaseConsistency = (signals) => {
  if (!signals || Object.keys(signals).length < 2) {
    return { score: 0, isLive: false, description: 'Insufficient ROI data' };
  }

  const signalArrays = Object.values(signals).filter(s => s && s.length > 0);
  if (signalArrays.length < 2) {
    return { score: 0, isLive: false, description: 'Insufficient ROI data' };
  }

  // Calculate cross-correlation between ROI pairs
  const correlations = [];
  for (let i = 0; i < signalArrays.length - 1; i++) {
    for (let j = i + 1; j < signalArrays.length; j++) {
      const corr = calculateCrossCorrelation(signalArrays[i], signalArrays[j]);
      correlations.push(corr);
    }
  }

  const avgCorrelation = correlations.reduce((sum, c) => sum + c, 0) / correlations.length;

  // Real faces: 0.5 < correlation < 0.9 (similar but not identical)
  // Photos: correlation ~0 or ~1 (no signal or perfectly flat)
  // Screens: correlation might be too high (>0.95) or too low
  const isNaturalRange = avgCorrelation > 0.4 && avgCorrelation < 0.95;
  const isLive = isNaturalRange;
  const score = isNaturalRange ? 0.8 : 0.2;

  return {
    score,
    isLive,
    correlation: avgCorrelation,
    threshold: { min: 0.4, max: 0.95 },
    description: `ROI correlation: ${avgCorrelation.toFixed(2)} (${isLive ? 'NATURAL' : 'UNNATURAL'})`
  };
};

/**
 * Test 4: Signal Complexity (Entropy)
 * Real signals have natural complexity
 * Photos produce flat/simple signals
 */
export const detectSignalComplexity = (signal) => {
  if (!signal || signal.length < 100) {
    return { score: 0, isLive: false, description: 'Insufficient signal data' };
  }

  // Calculate approximate entropy
  const entropy = calculateApproximateEntropy(signal);

  // Real faces: entropy > 0.3
  // Photos: entropy < 0.15
  const isLive = entropy > 0.25;
  const score = Math.min(1, entropy / 0.5);

  return {
    score,
    isLive,
    entropy,
    threshold: 0.25,
    description: `Signal entropy: ${entropy.toFixed(3)} (${isLive ? 'COMPLEX' : 'SIMPLE'})`
  };
};

/**
 * Test 5: Skin Ratio Stability
 * Photos: perfect skin ratio (always 100%)
 * Real faces: slight variations due to movement, lighting
 */
export const detectSkinRatioVariability = (rgbHistory) => {
  if (rgbHistory.length < 60) {
    return { score: 0, isLive: false, description: 'Insufficient history' };
  }

  const regions = ['forehead', 'leftCheek', 'rightCheek'];
  const ratioVariances = [];

  regions.forEach(region => {
    const ratios = rgbHistory
      .map(frame => frame[region]?.skinRatio || 0)
      .filter(r => r > 0);

    if (ratios.length > 0) {
      const mean = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
      const variance = ratios.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / ratios.length;
      ratioVariances.push(variance);
    }
  });

  const avgVariance = ratioVariances.length > 0
    ? ratioVariances.reduce((sum, v) => sum + v, 0) / ratioVariances.length
    : 0;

  // Real faces: some variance (0.001 - 0.05)
  // Photos: near-zero variance (< 0.0005)
  const isLive = avgVariance > 0.0008;
  const score = Math.min(1, avgVariance / 0.01);

  return {
    score,
    isLive,
    variance: avgVariance,
    threshold: 0.0008,
    description: `Skin ratio variance: ${avgVariance.toFixed(5)} (${isLive ? 'VARIABLE' : 'STATIC'})`
  };
};

/**
 * Test 6: Micro-motion Detection
 * Already implemented in livenessDetection.js
 * Real faces: natural micro-movements (variance > 5)
 * Photos: no movement (variance < 1)
 */
export const validateMicroMotion = (microMovement) => {
  const isLive = microMovement > 2 && microMovement < 50;
  const score = isLive ? Math.min(1, microMovement / 20) : 0;

  return {
    score,
    isLive,
    movement: microMovement,
    threshold: { min: 2, max: 50 },
    description: `Micro-movement: ${microMovement.toFixed(2)} (${isLive ? 'DETECTED' : 'ABSENT'})`
  };
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate cross-correlation between two signals
 */
function calculateCrossCorrelation(signal1, signal2) {
  const len = Math.min(signal1.length, signal2.length);
  if (len < 10) return 0;

  // Take last N samples
  const s1 = signal1.slice(-len);
  const s2 = signal2.slice(-len);

  // Normalize
  const mean1 = s1.reduce((sum, v) => sum + v, 0) / len;
  const mean2 = s2.reduce((sum, v) => sum + v, 0) / len;

  let numerator = 0;
  let denom1 = 0;
  let denom2 = 0;

  for (let i = 0; i < len; i++) {
    const diff1 = s1[i] - mean1;
    const diff2 = s2[i] - mean2;
    numerator += diff1 * diff2;
    denom1 += diff1 * diff1;
    denom2 += diff2 * diff2;
  }

  const denominator = Math.sqrt(denom1 * denom2);
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Calculate approximate entropy (signal complexity measure)
 */
function calculateApproximateEntropy(signal, m = 2, r = 0.2) {
  const N = signal.length;
  if (N < 100) return 0;

  // Normalize signal
  const std = Math.sqrt(signal.reduce((sum, v) => {
    const mean = signal.reduce((s, val) => s + val, 0) / N;
    return sum + Math.pow(v - mean, 2);
  }, 0) / N);

  if (std === 0) return 0;

  const threshold = r * std;

  function phi(m) {
    let patterns = [];
    for (let i = 0; i <= N - m; i++) {
      patterns.push(signal.slice(i, i + m));
    }

    let C = patterns.map((pattern, i) => {
      let count = 0;
      for (let j = 0; j < patterns.length; j++) {
        const maxDiff = Math.max(...pattern.map((v, k) => Math.abs(v - patterns[j][k])));
        if (maxDiff <= threshold) count++;
      }
      return count / patterns.length;
    });

    return C.reduce((sum, c) => sum + Math.log(c), 0) / C.length;
  }

  const phi_m = phi(m);
  const phi_m1 = phi(m + 1);

  return Math.abs(phi_m - phi_m1);
}

/**
 * Comprehensive Anti-Spoof Test Suite
 * Combines all tests with weighted scoring
 */
export const runAntiSpoofTests = (testData) => {
  const {
    rgbHistory = [],
    signalData = {},
    signals = {},
    rawSignal = [],
    microMovement = 0
  } = testData;

  const tests = [];

  // Test 1: Temporal Variance
  const t1 = detectTemporalVariance(rgbHistory);
  tests.push({ name: 'Temporal Variance', weight: 0.15, ...t1 });

  // Test 2: Periodic Signal
  const t2 = detectPeriodicSignal(signalData);
  tests.push({ name: 'Periodic Signal', weight: 0.25, ...t2 });

  // Test 3: Phase Consistency
  const t3 = detectPhaseConsistency(signals);
  tests.push({ name: 'Phase Consistency', weight: 0.15, ...t3 });

  // Test 4: Signal Complexity
  const t4 = detectSignalComplexity(rawSignal);
  tests.push({ name: 'Signal Complexity', weight: 0.15, ...t4 });

  // Test 5: Skin Ratio Variability
  const t5 = detectSkinRatioVariability(rgbHistory);
  tests.push({ name: 'Skin Ratio Variance', weight: 0.15, ...t5 });

  // Test 6: Micro-motion
  const t6 = validateMicroMotion(microMovement);
  tests.push({ name: 'Micro-motion', weight: 0.15, ...t6 });

  // Calculate weighted score
  const overallScore = tests.reduce((sum, test) => {
    return sum + (test.score * test.weight);
  }, 0);

  // Count how many tests passed
  const passedTests = tests.filter(t => t.isLive).length;
  const totalTests = tests.length;

  // Final verdict: need at least 4/6 tests passing AND overall score > 0.5
  const isLive = passedTests >= 4 && overallScore > 0.5;

  return {
    isLive,
    overallScore,
    passedTests,
    totalTests,
    tests: tests.map(t => ({
      name: t.name,
      passed: t.isLive,
      score: t.score,
      weight: t.weight,
      description: t.description
    })),
    verdict: isLive ? 'LIVE HUMAN' : 'SPOOF DETECTED',
    confidence: overallScore
  };
};

export default {
  detectTemporalVariance,
  detectPeriodicSignal,
  detectPhaseConsistency,
  detectSignalComplexity,
  detectSkinRatioVariability,
  validateMicroMotion,
  runAntiSpoofTests
};
