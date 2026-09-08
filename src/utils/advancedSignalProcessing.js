/**
 * Advanced Signal Processing for rPPG
 * Implements proper algorithms for extracting physiological signals from video
 */

// ==================== SKIN DETECTION ====================

/**
 * Detect if a pixel is skin tone using RGB thresholds
 * Based on research: skin has specific RGB ratios regardless of ethnicity
 */
const isSkinPixel = (r, g, b) => {
  // Rule 1: R > G > B (skin has this characteristic)
  if (!(r > g && g > b)) return false;

  // Rule 2: RGB values must be above minimum threshold
  if (r < 60 || g < 40 || b < 20) return false;

  // Rule 3: Difference between channels
  if (Math.abs(r - g) < 15) return false;

  // Rule 4: Upper bounds (avoid bright overexposed regions)
  if (r > 250 || g > 250 || b > 250) return false;

  return true;
};

/**
 * Extract ROI with skin filtering - only average skin pixels
 */
export const extractROIWithSkinFilter = (imageData) => {
  const data = imageData.data;
  let r = 0, g = 0, b = 0;
  let skinPixelCount = 0;
  let totalPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    totalPixels++;
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];

    if (isSkinPixel(red, green, blue)) {
      r += red;
      g += green;
      b += blue;
      skinPixelCount++;
    }
  }

  const skinRatio = skinPixelCount / totalPixels;

  if (skinPixelCount < 10) {
    // Not enough skin pixels
    return null;
  }

  return {
    r: r / skinPixelCount,
    g: g / skinPixelCount,
    b: b / skinPixelCount,
    skinRatio: skinRatio
  };
};

// ==================== SIGNAL NORMALIZATION ====================

/**
 * Normalize signal to zero mean and unit variance
 */
export const normalizeSignal = (signal) => {
  if (!signal || signal.length === 0) return [];

  const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
  const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 1e-10) return signal.map(() => 0);

  return signal.map(val => (val - mean) / stdDev);
};

/**
 * Polynomial detrending - removes slow drifts
 */
export const polynomialDetrend = (signal, degree = 2) => {
  if (!signal || signal.length < 10) return signal;

  const n = signal.length;
  const x = Array.from({ length: n }, (_, i) => i);

  // Simple linear detrend (degree 1) for performance
  const xMean = x.reduce((sum, val) => sum + val, 0) / n;
  const yMean = signal.reduce((sum, val) => sum + val, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (x[i] - xMean) * (signal[i] - yMean);
    denominator += Math.pow(x[i] - xMean, 2);
  }

  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;

  return signal.map((val, i) => val - (slope * i + intercept));
};

// ==================== IMPROVED CHROM ALGORITHM ====================

/**
 * CHROM algorithm with proper color space transformation
 * Reference: "Improved Motion Robustness of Remote-PPG by Using the Blood Volume Pulse Signature"
 */
export const chromAlgorithmImproved = (rgbBuffer) => {
  if (!rgbBuffer || rgbBuffer.length < 30) return null;

  const signal = [];
  const validIndices = [];

  // First pass: identify valid frames (with skin detection)
  for (let i = 0; i < rgbBuffer.length; i++) {
    if (rgbBuffer[i] && rgbBuffer[i].skinRatio > 0.3) {
      validIndices.push(i);
    }
  }

  if (validIndices.length < 30) {
    console.log('⚠️ Not enough valid skin frames:', validIndices.length);
    return null;
  }

  // Process only valid frames
  for (const i of validIndices) {
    const { r, g, b } = rgbBuffer[i];

    // Normalize RGB by mean
    const mean = (r + g + b) / 3;
    if (mean < 10) continue; // Too dark

    const rNorm = r / mean;
    const gNorm = g / mean;
    const bNorm = b / mean;

    // CHROM color space transformation
    // These coefficients are from the CHROM paper
    const xs = 3 * rNorm - 2 * gNorm;
    const ys = 1.5 * rNorm + gNorm - 1.5 * bNorm;

    // Calculate alpha (std(xs) / std(ys))
    // For real-time, we use a simplified version
    const alpha = 1.0; // Can be refined with running statistics

    // Pulse signal is xs - alpha * ys
    const pulse = xs - alpha * ys;

    signal.push(pulse);
  }

  if (signal.length < 30) return null;

  return signal;
};

// ==================== BUTTERWORTH BANDPASS FILTER ====================

/**
 * Simple Butterworth-like bandpass filter
 * Frequency range: 0.7 Hz to 4 Hz (42-240 BPM)
 */
export const butterworthFilter = (signal, lowCut = 0.7, highCut = 4.0, fps = 30) => {
  if (!signal || signal.length < 10) return signal;

  // Step 1: Detrend
  let filtered = polynomialDetrend(signal);

  // Step 2: High-pass filter (remove DC and very low frequencies)
  const hpWindowSize = Math.max(3, Math.floor(fps / lowCut / 2));
  filtered = highPassFilter(filtered, hpWindowSize);

  // Step 3: Low-pass filter (remove high-frequency noise)
  const lpWindowSize = Math.max(3, Math.floor(fps / highCut / 2));
  filtered = lowPassFilter(filtered, lpWindowSize);

  // Step 4: Normalize
  filtered = normalizeSignal(filtered);

  return filtered;
};

/**
 * High-pass filter using moving average subtraction
 */
const highPassFilter = (signal, windowSize) => {
  const result = [];

  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(signal.length, i + windowSize + 1);
    const window = signal.slice(start, end);
    const avg = window.reduce((sum, val) => sum + val, 0) / window.length;

    result.push(signal[i] - avg);
  }

  return result;
};

/**
 * Low-pass filter using moving average
 */
const lowPassFilter = (signal, windowSize) => {
  const result = [];

  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(signal.length, i + windowSize + 1);
    const window = signal.slice(start, end);
    const avg = window.reduce((sum, val) => sum + val, 0) / window.length;

    result.push(avg);
  }

  return result;
};

// ==================== IMPROVED FREQUENCY ANALYSIS ====================

/**
 * Frequency analysis with proper windowing and peak detection
 */
export const analyzeFrequencyImproved = (signal, fps = 30) => {
  if (!signal || signal.length < 64) {
    return { dominantFreq: 0, snr: 0, power: 0, bandPower: 0 };
  }

  // Use last N samples (e.g., last 10 seconds = 300 frames at 30fps)
  const windowSize = Math.min(512, Math.pow(2, Math.floor(Math.log2(signal.length))));
  const windowed = signal.slice(-windowSize);

  // Apply Hamming window to reduce spectral leakage
  const hammingWindow = windowed.map((val, i) => {
    const windowVal = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (windowSize - 1));
    return val * windowVal;
  });

  // Compute autocorrelation for periodicity detection
  const autocorr = computeAutocorrelation(hammingWindow, fps);

  // Find dominant frequency in heart rate range (0.7 - 4 Hz = 42-240 BPM)
  const minLag = Math.floor(fps / 4.0); // Max 240 BPM
  const maxLag = Math.floor(fps / 0.7); // Min 42 BPM

  let maxPower = 0;
  let dominantLag = 0;
  let secondPeakPower = 0;

  for (let i = minLag; i < Math.min(maxLag, autocorr.length); i++) {
    if (autocorr[i] > maxPower) {
      secondPeakPower = maxPower;
      maxPower = autocorr[i];
      dominantLag = i;
    } else if (autocorr[i] > secondPeakPower) {
      secondPeakPower = autocorr[i];
    }
  }

  const dominantFreq = dominantLag > 0 ? fps / dominantLag : 0;

  // Calculate noise power (frequencies outside HR range)
  const noisePower = autocorr.slice(0, minLag).reduce((sum, val) => sum + Math.abs(val), 0) / minLag;

  // Signal-to-Noise Ratio
  const snr = noisePower > 0 ? maxPower / noisePower : 0;

  // Band power (total power in HR frequency range)
  const bandPower = autocorr.slice(minLag, maxLag).reduce((sum, val) => sum + Math.abs(val), 0);

  // Peak prominence (how much stronger is the peak than the second peak?)
  const peakProminence = secondPeakPower > 0 ? maxPower / secondPeakPower : 1;

  return {
    dominantFreq,
    snr,
    power: maxPower,
    bandPower,
    peakProminence
  };
};

/**
 * Compute autocorrelation for periodicity detection
 */
const computeAutocorrelation = (signal, fps) => {
  const n = signal.length;
  const maxLag = Math.min(Math.floor(n / 2), Math.floor(fps / 0.5)); // Up to 0.5 Hz
  const autocorr = [];

  for (let lag = 0; lag < maxLag; lag++) {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < n - lag; i++) {
      sum += signal[i] * signal[i + lag];
      count++;
    }

    autocorr.push(sum / count);
  }

  // Normalize by the zero-lag value
  const maxVal = autocorr[0];
  if (maxVal > 0) {
    return autocorr.map(val => val / maxVal);
  }

  return autocorr;
};

// ==================== EXPORT ALL ====================

export default {
  extractROIWithSkinFilter,
  chromAlgorithmImproved,
  butterworthFilter,
  analyzeFrequencyImproved,
  normalizeSignal,
  polynomialDetrend
};
