/**
 * Signal Processing Utilities for rPPG (Remote Photoplethysmography)
 * Implements CHROM algorithm for pulse extraction from facial video
 */

import {
  extractROIWithSkinFilter,
  butterworthFilter,
  chromAlgorithmImproved,
  analyzeFrequencyImproved,
  normalizeSignal,
  polynomialDetrend
} from './advancedSignalProcessing';

console.log('✅ Advanced signal processing loaded!');

// Extract RGB values from ROIs with skin filtering
export const extractROIs = (image, landmarks, canvas) => {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Create temporary canvas to extract pixel data
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(image, 0, 0, width, height);

  const regions = {
    forehead: [10, 67, 109, 338, 297],
    leftCheek: [266, 426, 436, 416, 376],
    rightCheek: [36, 206, 216, 192, 147]
  };

  const roiData = {};

  Object.entries(regions).forEach(([region, indices]) => {
    const points = indices.map(i => ({
      x: Math.floor(landmarks[i].x * width),
      y: Math.floor(landmarks[i].y * height)
    }));

    const minX = Math.max(0, Math.min(...points.map(p => p.x)));
    const maxX = Math.min(width, Math.max(...points.map(p => p.x)));
    const minY = Math.max(0, Math.min(...points.map(p => p.y)));
    const maxY = Math.min(height, Math.max(...points.map(p => p.y)));

    const roiWidth = maxX - minX;
    const roiHeight = maxY - minY;

    if (roiWidth > 0 && roiHeight > 0) {
      const imageData = tempCtx.getImageData(minX, minY, roiWidth, roiHeight);

      // Use advanced skin filtering
      const rgb = extractROIWithSkinFilter(imageData);

      if (rgb) {
        roiData[region] = rgb;
      }
    }
  });

  return Object.keys(roiData).length === 3 ? roiData : null;
};

// Process signal using improved algorithms
const processSignal = (rgbBuffer) => {
  // Use improved CHROM algorithm
  const signal = chromAlgorithmImproved(rgbBuffer);
  if (!signal || signal.length < 60) return null;

  // Polynomial detrending
  const detrended = polynomialDetrend(signal);

  // Butterworth bandpass filter
  const filtered = butterworthFilter(detrended, 0.7, 4.0, 30);

  // Normalize
  const normalized = normalizeSignal(filtered);

  return normalized;
};

// Process rPPG signal from RGB buffer
export const processRPPGSignal = (rgbBuffer) => {
  const regions = ['forehead', 'leftCheek', 'rightCheek'];
  const signals = {};
  const freqAnalysis = {};

  // Check if we have enough data and valid skin ratios
  let validRegions = 0;
  const skinRatios = {};

  regions.forEach(region => {
    const buffer = rgbBuffer[region];
    if (buffer && buffer.length > 0) {
      const avgSkinRatio = buffer.reduce((sum, rgb) => sum + (rgb.skinRatio || 0), 0) / buffer.length;
      skinRatios[region] = avgSkinRatio;
      if (avgSkinRatio > 0.3) { // At least 30% skin pixels
        validRegions++;
      }
    }
  });

  console.log('🎨 Skin ratios:', skinRatios, 'Valid regions:', validRegions);

  if (validRegions < 2) {
    // Not enough valid skin regions
    console.log('⚠️ Insufficient skin detection');
    return {
      signals: {},
      freqAnalysis: {},
      heartRate: 0,
      consistency: 0,
      rawSignal: [],
      skinQuality: validRegions / 3
    };
  }

  // Process each ROI with improved algorithms
  regions.forEach(region => {
    const signal = processSignal(rgbBuffer[region]);
    if (signal && signal.length > 0) {
      const freq = analyzeFrequencyImproved(signal, 30);

      signals[region] = signal;
      freqAnalysis[region] = freq;

      if (region === 'forehead') {
        console.log('📊 Forehead analysis:', {
          signalLength: signal.length,
          dominantFreq: freq.dominantFreq.toFixed(3),
          dominantFreqHz: freq.dominantFreq.toFixed(3) + ' Hz',
          estimatedBPM: (freq.dominantFreq * 60).toFixed(1) + ' BPM',
          snr: freq.snr.toFixed(2),
          power: freq.power.toFixed(4),
          bandPower: freq.bandPower?.toFixed(4),
          signalMin: Math.min(...signal).toFixed(3),
          signalMax: Math.max(...signal).toFixed(3),
          signalMean: (signal.reduce((a,b) => a+b, 0) / signal.length).toFixed(3)
        });
      }
    }
  });

  // Calculate average heart rate with outlier rejection
  const heartRates = regions
    .map(r => freqAnalysis[r]?.dominantFreq || 0)
    .filter(f => f > 0)
    .map(f => f * 60); // Convert Hz to BPM

  // Remove outliers (values > 2 std dev from median)
  if (heartRates.length > 1) {
    const median = heartRates.sort((a, b) => a - b)[Math.floor(heartRates.length / 2)];
    const validHRs = heartRates.filter(hr => Math.abs(hr - median) < 40); // Within 40 BPM of median

    const avgHeartRate = validHRs.length > 0
      ? validHRs.reduce((sum, hr) => sum + hr, 0) / validHRs.length
      : 0;

    // Calculate cross-ROI consistency
    const consistency = calculateCrossROIConsistency(freqAnalysis);

    const confidenceResult = calculateConfidence({
      freqAnalysis,
      heartRate: Math.round(avgHeartRate),
      consistency,
      signals
    });

    console.log('💓 Heart rate analysis:', {
      allHRs: heartRates.map(hr => Math.round(hr)),
      validHRs: validHRs.map(hr => Math.round(hr)),
      finalHR: Math.round(avgHeartRate),
      consistency: consistency.toFixed(2)
    });

    console.log('🎯 Confidence breakdown:', {
      overall: (confidenceResult.overall * 100).toFixed(1) + '%',
      signalQuality: (confidenceResult.signalQuality * 100).toFixed(1) + '%',
      roiConsistency: (confidenceResult.roiConsistency * 100).toFixed(1) + '%',
      avgSNR: confidenceResult.snr.toFixed(2),
      hrPlausibility: (confidenceResult.heartRatePlausibility * 100).toFixed(1) + '%'
    });

    return {
      signals,
      freqAnalysis,
      heartRate: Math.round(avgHeartRate),
      consistency,
      rawSignal: signals.forehead || [],
      skinQuality: validRegions / 3
    };
  }

  return {
    signals: {},
    freqAnalysis: {},
    heartRate: 0,
    consistency: 0,
    rawSignal: [],
    skinQuality: validRegions / 3
  };
};

// Calculate cross-ROI consistency
const calculateCrossROIConsistency = (freqAnalysis) => {
  const regions = ['forehead', 'leftCheek', 'rightCheek'];
  const freqs = regions
    .map(r => freqAnalysis[r]?.dominantFreq || 0)
    .filter(f => f > 0);

  if (freqs.length < 2) return 0;

  const mean = freqs.reduce((sum, f) => sum + f, 0) / freqs.length;
  const variance = freqs.reduce((sum, f) => sum + Math.pow(f - mean, 2), 0) / freqs.length;
  const stdDev = Math.sqrt(variance);

  // Low standard deviation = high consistency
  const consistency = Math.max(0, 1 - (stdDev / mean) * 5);
  return consistency;
};

// Calculate overall confidence score
export const calculateConfidence = (signalData) => {
  const { freqAnalysis, heartRate, consistency, skinQuality = 0.5 } = signalData;

  // Average SNR across ROIs
  const snrValues = Object.values(freqAnalysis)
    .map(fa => fa.snr)
    .filter(snr => snr > 0);

  const avgSNR = snrValues.length > 0
    ? snrValues.reduce((sum, snr) => sum + snr, 0) / snrValues.length
    : 0;

  // Normalize SNR to 0-1 scale (webcam-realistic threshold)
  const snrScore = Math.min(1, avgSNR / 6); // Lowered to 6 for webcam conditions

  // Heart rate plausibility
  let hrScore = 0;
  if (heartRate >= 50 && heartRate <= 120) {
    hrScore = 1.0; // Normal resting/moderate HR
  } else if (heartRate >= 40 && heartRate < 50) {
    hrScore = 0.7; // Low but possible
  } else if (heartRate > 120 && heartRate <= 150) {
    hrScore = 0.7; // High but possible
  } else if (heartRate > 150 && heartRate <= 180) {
    hrScore = 0.3; // Extreme
  } else if (heartRate > 180 || heartRate < 40 || heartRate === 0) {
    hrScore = 0; // Impossible or no signal
  }

  // High consistency with low SNR is suspicious (photos/flat signals)
  let consistencyScore = consistency;
  if (consistency > 0.95 && avgSNR < 3) {
    consistencyScore = 0.2; // Too perfect = likely photo
  } else if (consistency > 0.85 && avgSNR < 2) {
    consistencyScore = 0.15;
  }

  // Band power check
  const bandPowerValues = Object.values(freqAnalysis)
    .map(fa => fa.bandPower || 0)
    .filter(p => p > 0);
  const avgBandPower = bandPowerValues.length > 0
    ? bandPowerValues.reduce((sum, p) => sum + p, 0) / bandPowerValues.length
    : 0;
  const bandPowerScore = Math.min(1, avgBandPower / 25); // More forgiving

  // Periodicity check
  const powerValues = Object.values(freqAnalysis)
    .map(fa => fa.power)
    .filter(p => p > 0);
  const avgPower = powerValues.length > 0
    ? powerValues.reduce((sum, p) => sum + p, 0) / powerValues.length
    : 0;
  const periodicityScore = Math.min(1, avgPower / 40); // More forgiving

  // Skin quality check
  const skinScore = Math.max(0, Math.min(1, skinQuality));

  // Signal quality - webcam-tuned weights
  const signalQuality = (
    snrScore * 0.35 +
    bandPowerScore * 0.25 +
    periodicityScore * 0.2 +
    skinScore * 0.2
  );

  // Overall confidence - emphasize HR plausibility (key discriminator)
  let overall = (
    signalQuality * 0.4 +
    hrScore * 0.3 +
    consistencyScore * 0.2 +
    periodicityScore * 0.1
  );

  // CRITICAL: Photos/spoofs must have implausible HR to be rejected
  // Only boost if HR is genuinely plausible
  if (hrScore >= 0.7 && avgSNR > 2.0) {
    overall = Math.min(1, overall * 1.6); // 60% boost only with good signal
  }

  // HEAVY penalties for clear spoofs - these must dominate
  if (heartRate > 180 || heartRate < 40 || heartRate === 0) {
    overall *= 0.1; // 90% penalty for impossible/missing HR
  }
  if (avgSNR < 2.0) {
    overall *= 0.3; // 70% penalty for very weak signal
  }
  if (avgSNR < 3.0 && consistency > 0.9) {
    // Suspicious: too consistent with weak signal (photo characteristic)
    overall *= 0.2; // 80% penalty
  }

  // Bonus for strong coherent signal (only applies after penalties)
  if (hrScore >= 0.9 && avgSNR > 4.0 && skinQuality > 0.5) {
    overall = Math.min(1, overall * 1.2); // 20% bonus for excellent signal
  }

  return {
    overall: Math.max(0, Math.min(1, overall)),
    signalQuality: Math.max(0, Math.min(1, signalQuality)),
    roiConsistency: Math.max(0, Math.min(1, consistency)),
    snr: avgSNR,
    heartRatePlausibility: hrScore,
    periodicityScore,
    bandPowerScore,
    skinQuality: skinScore
  };
};
