package com.veyrax.pulseverify.core

import kotlin.math.*

/**
 * Advanced Signal Processing for rPPG
 * Implements CHROM algorithm and frequency analysis for pulse extraction
 */
object SignalProcessing {

    data class RGBValue(
        val r: Float,
        val g: Float,
        val b: Float,
        val skinRatio: Float = 0f
    )

    data class FrequencyAnalysis(
        val dominantFreq: Float = 0f,
        val snr: Float = 0f,
        val power: Float = 0f,
        val bandPower: Float = 0f,
        val peakProminence: Float = 1f
    )

    data class SignalResult(
        val signals: Map<String, List<Float>>,
        val freqAnalysis: Map<String, FrequencyAnalysis>,
        val heartRate: Int,
        val consistency: Float,
        val rawSignal: List<Float>,
        val skinQuality: Float
    )

    // ==================== SKIN DETECTION ====================

    /**
     * Detect if a pixel is skin tone using robust RGB thresholds
     */
    fun isSkinPixel(r: Int, g: Int, b: Int): Boolean {
        // Basic RGB bounds
        if (r < 40 || g < 30 || b < 15) return false
        if (r > 250 && g > 250 && b > 250) return false // Glare/overexposed

        // R should be the dominant component or close to G, R > B
        if (r < g - 10 || r < b) return false

        // Contrast between max and min channel
        val maxC = max(r, max(g, b))
        val minC = min(r, min(g, b))
        if (maxC - minC < 5) return false

        return true
    }

    /**
     * Extract ROI with skin filtering - only average skin pixels
     */
    fun extractROIWithSkinFilter(pixels: IntArray): RGBValue? {
        var r = 0f
        var g = 0f
        var b = 0f
        var skinPixelCount = 0
        val totalPixels = pixels.size

        for (pixel in pixels) {
            val red = (pixel shr 16) and 0xFF
            val green = (pixel shr 8) and 0xFF
            val blue = pixel and 0xFF

            if (isSkinPixel(red, green, blue)) {
                r += red
                g += green
                b += blue
                skinPixelCount++
            }
        }

        val skinRatio = skinPixelCount.toFloat() / totalPixels

        if (skinPixelCount < 5) {
            return null
        }

        return RGBValue(
            r = r / skinPixelCount,
            g = g / skinPixelCount,
            b = b / skinPixelCount,
            skinRatio = skinRatio
        )
    }

    // ==================== SIGNAL NORMALIZATION ====================

    /**
     * Normalize signal to zero mean and unit variance
     */
    fun normalizeSignal(signal: List<Float>): List<Float> {
        if (signal.isEmpty()) return emptyList()

        val mean = signal.average().toFloat()
        val variance = signal.map { (it - mean).pow(2) }.average().toFloat()
        val stdDev = sqrt(variance)

        if (stdDev < 1e-10f) return signal.map { 0f }

        return signal.map { (it - mean) / stdDev }
    }

    /**
     * Polynomial detrending - removes slow drifts
     */
    fun polynomialDetrend(signal: List<Float>): List<Float> {
        if (signal.size < 10) return signal

        val n = signal.size
        val x = List(n) { it.toFloat() }

        val xMean = x.average().toFloat()
        val yMean = signal.average().toFloat()

        var numerator = 0f
        var denominator = 0f

        for (i in 0 until n) {
            numerator += (x[i] - xMean) * (signal[i] - yMean)
            denominator += (x[i] - xMean).pow(2)
        }

        val slope = numerator / denominator
        val intercept = yMean - slope * xMean

        return signal.mapIndexed { i, value ->
            value - (slope * i + intercept)
        }
    }

    // ==================== CHROM ALGORITHM ====================

    /**
     * CHROM algorithm with proper color space transformation
     */
    fun chromAlgorithm(rgbBuffer: List<RGBValue>): List<Float>? {
        if (rgbBuffer.size < 30) return null

        val signal = mutableListOf<Float>()
        val validIndices = rgbBuffer.mapIndexedNotNull { index, rgb ->
            if (rgb.skinRatio > 0.3f) index else null
        }

        if (validIndices.size < 30) return null

        for (i in validIndices) {
            val rgb = rgbBuffer[i]
            val mean = (rgb.r + rgb.g + rgb.b) / 3f
            if (mean < 10f) continue

            val rNorm = rgb.r / mean
            val gNorm = rgb.g / mean
            val bNorm = rgb.b / mean

            // CHROM color space transformation
            val xs = 3f * rNorm - 2f * gNorm
            val ys = 1.5f * rNorm + gNorm - 1.5f * bNorm

            val alpha = 1.0f
            val pulse = xs - alpha * ys

            signal.add(pulse)
        }

        if (signal.size < 30) return null
        return signal
    }

    // ==================== BUTTERWORTH BANDPASS FILTER ====================

    /**
     * Butterworth-like bandpass filter
     * Frequency range: 0.7 Hz to 4 Hz (42-240 BPM)
     */
    fun butterworthFilter(
        signal: List<Float>,
        lowCut: Float = 0.7f,
        highCut: Float = 4.0f,
        fps: Float = 30f
    ): List<Float> {
        if (signal.size < 10) return signal

        // Step 1: Detrend
        var filtered = polynomialDetrend(signal)

        // Step 2: High-pass filter
        val hpWindowSize = max(3, floor(fps / lowCut / 2).toInt())
        filtered = highPassFilter(filtered, hpWindowSize)

        // Step 3: Low-pass filter
        val lpWindowSize = max(3, floor(fps / highCut / 2).toInt())
        filtered = lowPassFilter(filtered, lpWindowSize)

        // Step 4: Normalize
        filtered = normalizeSignal(filtered)

        return filtered
    }

    private fun highPassFilter(signal: List<Float>, windowSize: Int): List<Float> {
        return signal.mapIndexed { i, value ->
            val start = max(0, i - windowSize)
            val end = min(signal.size, i + windowSize + 1)
            val window = signal.subList(start, end)
            val avg = window.average().toFloat()
            value - avg
        }
    }

    private fun lowPassFilter(signal: List<Float>, windowSize: Int): List<Float> {
        return signal.mapIndexed { i, _ ->
            val start = max(0, i - windowSize)
            val end = min(signal.size, i + windowSize + 1)
            val window = signal.subList(start, end)
            window.average().toFloat()
        }
    }

    // ==================== FREQUENCY ANALYSIS ====================

    /**
     * Frequency analysis with autocorrelation for periodicity detection
     */
    fun analyzeFrequency(signal: List<Float>, fps: Float = 30f): FrequencyAnalysis {
        if (signal.size < 64) {
            return FrequencyAnalysis()
        }

        val windowSize = min(512, 2.0.pow(floor(ln(signal.size.toDouble()) / ln(2.0))).toInt())
        val windowed = signal.takeLast(windowSize)

        // Apply Hamming window
        val hammingWindow = windowed.mapIndexed { i, value ->
            val windowVal = 0.54f - 0.46f * cos((2f * PI.toFloat() * i) / (windowSize - 1))
            value * windowVal
        }

        // Compute autocorrelation
        val autocorr = computeAutocorrelation(hammingWindow, fps)

        // Find dominant frequency in heart rate range (0.7 - 4 Hz)
        val minLag = floor(fps / 4.0f).toInt()  // Max 240 BPM
        val maxLag = floor(fps / 0.7f).toInt()  // Min 42 BPM

        var maxPower = 0f
        var dominantLag = 0
        var secondPeakPower = 0f

        for (i in minLag until min(maxLag, autocorr.size)) {
            if (autocorr[i] > maxPower) {
                secondPeakPower = maxPower
                maxPower = autocorr[i]
                dominantLag = i
            } else if (autocorr[i] > secondPeakPower) {
                secondPeakPower = autocorr[i]
            }
        }

        val dominantFreq = if (dominantLag > 0) fps / dominantLag else 0f

        // Calculate noise power
        val noisePower = if (minLag > 0) {
            autocorr.take(minLag).map { abs(it) }.average().toFloat()
        } else 0f

        val snr = if (noisePower > 0) maxPower / noisePower else 0f

        // Band power
        val bandPower = autocorr.subList(minLag, min(maxLag, autocorr.size))
            .map { abs(it) }
            .sum()

        val peakProminence = if (secondPeakPower > 0) maxPower / secondPeakPower else 1f

        return FrequencyAnalysis(
            dominantFreq = dominantFreq,
            snr = snr,
            power = maxPower,
            bandPower = bandPower,
            peakProminence = peakProminence
        )
    }

    private fun computeAutocorrelation(signal: List<Float>, fps: Float): List<Float> {
        val n = signal.size
        val maxLag = min(floor(n / 2f).toInt(), floor(fps / 0.5f).toInt())
        val autocorr = mutableListOf<Float>()

        for (lag in 0 until maxLag) {
            var sum = 0f
            var count = 0

            for (i in 0 until n - lag) {
                sum += signal[i] * signal[i + lag]
                count++
            }

            autocorr.add(sum / count)
        }

        // Normalize by zero-lag value
        val maxVal = autocorr.firstOrNull() ?: 0f
        return if (maxVal > 0) {
            autocorr.map { it / maxVal }
        } else {
            autocorr
        }
    }

    // ==================== SIGNAL PROCESSING ====================

    /**
     * Process signal using CHROM + filtering
     */
    fun processSignal(rgbBuffer: List<RGBValue>): List<Float>? {
        val signal = chromAlgorithm(rgbBuffer) ?: return null
        if (signal.size < 60) return null

        val detrended = polynomialDetrend(signal)
        val filtered = butterworthFilter(detrended, 0.7f, 4.0f, 30f)
        return normalizeSignal(filtered)
    }

    /**
     * Process rPPG signal from RGB buffer
     */
    fun processRPPGSignal(rgbBuffer: Map<String, List<RGBValue>>): SignalResult {
        val regions = listOf("forehead", "leftCheek", "rightCheek")
        val signals = mutableMapOf<String, List<Float>>()
        val freqAnalysis = mutableMapOf<String, FrequencyAnalysis>()

        // Check skin quality
        var validRegions = 0
        val skinRatios = mutableMapOf<String, Float>()

        regions.forEach { region ->
            val buffer = rgbBuffer[region]
            if (buffer != null && buffer.isNotEmpty()) {
                val avgSkinRatio = buffer.map { it.skinRatio }.average().toFloat()
                skinRatios[region] = avgSkinRatio
                if (avgSkinRatio > 0.3f) {
                    validRegions++
                }
            }
        }

        if (validRegions < 2) {
            return SignalResult(
                signals = emptyMap(),
                freqAnalysis = emptyMap(),
                heartRate = 0,
                consistency = 0f,
                rawSignal = emptyList(),
                skinQuality = validRegions / 3f
            )
        }

        // Process each ROI
        regions.forEach { region ->
            val buffer = rgbBuffer[region]
            if (buffer != null) {
                val signal = processSignal(buffer)
                if (signal != null && signal.isNotEmpty()) {
                    val freq = analyzeFrequency(signal, 30f)
                    signals[region] = signal
                    freqAnalysis[region] = freq
                }
            }
        }

        // Calculate average heart rate with outlier rejection
        val heartRates = regions.mapNotNull { region ->
            freqAnalysis[region]?.dominantFreq?.let { it * 60f }
        }.filter { it > 0 }

        val avgHeartRate = if (heartRates.size > 1) {
            val sorted = heartRates.sorted()
            val median = sorted[sorted.size / 2]
            val validHRs = heartRates.filter { abs(it - median) < 40f }
            if (validHRs.isNotEmpty()) {
                validHRs.average().toFloat()
            } else 0f
        } else 0f

        // Calculate cross-ROI consistency
        val consistency = calculateCrossROIConsistency(freqAnalysis)

        return SignalResult(
            signals = signals,
            freqAnalysis = freqAnalysis,
            heartRate = avgHeartRate.roundToInt(),
            consistency = consistency,
            rawSignal = signals["forehead"] ?: emptyList(),
            skinQuality = validRegions / 3f
        )
    }

    /**
     * Calculate cross-ROI consistency
     */
    private fun calculateCrossROIConsistency(freqAnalysis: Map<String, FrequencyAnalysis>): Float {
        val freqs = freqAnalysis.values.map { it.dominantFreq }.filter { it > 0 }
        if (freqs.size < 2) return 0f

        val mean = freqs.average().toFloat()
        val variance = freqs.map { (it - mean).pow(2) }.average().toFloat()
        val stdDev = sqrt(variance)

        // Low standard deviation = high consistency
        return max(0f, 1f - (stdDev / mean) * 5f)
    }

    /**
     * Calculate overall confidence score
     */
    fun calculateConfidence(signalResult: SignalResult): ConfidenceResult {
        val freqAnalysis = signalResult.freqAnalysis
        val heartRate = signalResult.heartRate
        val consistency = signalResult.consistency
        val skinQuality = signalResult.skinQuality

        // Average SNR across ROIs
        val snrValues = freqAnalysis.values.map { it.snr }.filter { it > 0 }
        val avgSNR = if (snrValues.isNotEmpty()) {
            snrValues.average().toFloat()
        } else 0f

        val snrScore = min(1f, avgSNR / 6f)

        // Heart rate plausibility
        val hrScore = when {
            heartRate in 50..120 -> 1.0f
            heartRate in 40..49 -> 0.7f
            heartRate in 121..150 -> 0.7f
            heartRate in 151..180 -> 0.3f
            else -> 0f
        }

        // Consistency score (adjusted for photo detection)
        var consistencyScore = consistency
        if (consistency > 0.95f && avgSNR < 3f) {
            consistencyScore = 0.2f  // Too perfect = likely photo
        } else if (consistency > 0.85f && avgSNR < 2f) {
            consistencyScore = 0.15f
        }

        // Band power
        val bandPowerValues = freqAnalysis.values.map { it.bandPower }.filter { it > 0 }
        val avgBandPower = if (bandPowerValues.isNotEmpty()) {
            bandPowerValues.average().toFloat()
        } else 0f
        val bandPowerScore = min(1f, avgBandPower / 5f)

        // Periodicity
        val powerValues = freqAnalysis.values.map { it.power }.filter { it > 0 }
        val avgPower = if (powerValues.isNotEmpty()) {
            powerValues.average().toFloat()
        } else 0f
        val periodicityScore = min(1f, avgPower / 0.4f)

        val skinScore = max(0f, min(1f, skinQuality))

        // Signal quality
        val signalQuality = (
            snrScore * 0.35f +
            bandPowerScore * 0.25f +
            periodicityScore * 0.2f +
            skinScore * 0.2f
        )

        // Overall confidence
        var overall = (
            signalQuality * 0.4f +
            hrScore * 0.3f +
            consistencyScore * 0.2f +
            periodicityScore * 0.1f
        )

        // Boost for good signals
        if (hrScore >= 0.7f && avgSNR > 2.0f) {
            overall = min(1f, overall * 1.6f)
        }

        // Penalties for spoofs
        if (heartRate > 180 || heartRate < 40 || heartRate == 0) {
            overall *= 0.1f
        }
        if (avgSNR < 2.0f) {
            overall *= 0.3f
        }
        if (avgSNR < 3.0f && consistency > 0.9f) {
            overall *= 0.2f
        }

        // Bonus for excellent signals
        if (hrScore >= 0.9f && avgSNR > 4.0f && skinQuality > 0.5f) {
            overall = min(1f, overall * 1.2f)
        }

        return ConfidenceResult(
            overall = max(0f, min(1f, overall)),
            signalQuality = max(0f, min(1f, signalQuality)),
            roiConsistency = max(0f, min(1f, consistency)),
            snr = avgSNR,
            heartRatePlausibility = hrScore,
            periodicityScore = periodicityScore,
            bandPowerScore = bandPowerScore,
            skinQuality = skinScore
        )
    }

    data class ConfidenceResult(
        val overall: Float,
        val signalQuality: Float,
        val roiConsistency: Float,
        val snr: Float,
        val heartRatePlausibility: Float,
        val periodicityScore: Float,
        val bandPowerScore: Float,
        val skinQuality: Float
    )
}
