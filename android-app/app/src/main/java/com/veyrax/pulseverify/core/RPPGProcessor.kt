package com.veyrax.pulseverify.core

import android.graphics.Bitmap
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.LinkedList

/**
 * Main rPPG Processor
 * Manages the signal processing pipeline for pulse detection
 */
class RPPGProcessor(private val bufferSize: Int = 300) { // 10 seconds at 30fps

    // RGB buffers for each ROI
    private val foreheadBuffer = LinkedList<SignalProcessing.RGBValue>()
    private val leftCheekBuffer = LinkedList<SignalProcessing.RGBValue>()
    private val rightCheekBuffer = LinkedList<SignalProcessing.RGBValue>()

    // Verification state
    private val _verificationState = MutableStateFlow(VerificationState())
    val verificationState: StateFlow<VerificationState> = _verificationState

    // Trust history for timeline
    private val trustHistory = LinkedList<TrustPoint>()
    private var frameCount = 0

    data class VerificationState(
        val status: Status = Status.INITIALIZING,
        val confidence: Float = 0f,
        val heartRate: Int = 0,
        val signalQuality: Float = 0f,
        val roiConsistency: Float = 0f,
        val framesCollected: Int = 0,
        val rawSignal: List<Float> = emptyList(),
        val trustHistory: List<TrustPoint> = emptyList(),
        val message: String = "Initializing..."
    ) {
        enum class Status {
            INITIALIZING,
            VERIFIED,
            UNCERTAIN,
            SUSPICIOUS
        }
    }

    data class TrustPoint(
        val timestamp: Long,
        val confidence: Float,
        val status: VerificationState.Status
    )

    /**
     * Process a new frame
     */
    fun processFrame(bitmap: Bitmap, faceLandmarks: FaceLandmarkerResult) {
        frameCount++

        // Extract ROIs
        val roiData = ROIExtractor.extractROIs(bitmap, faceLandmarks)

        if (roiData == null) {
            _verificationState.value = VerificationState(
                status = VerificationState.Status.UNCERTAIN,
                confidence = 0f,
                message = "No face detected - position your face in frame",
                framesCollected = frameCount
            )
            return
        }

        // Add to buffers
        roiData.forehead?.let {
            foreheadBuffer.add(it)
            if (foreheadBuffer.size > bufferSize) foreheadBuffer.removeFirst()
        }
        roiData.leftCheek?.let {
            leftCheekBuffer.add(it)
            if (leftCheekBuffer.size > bufferSize) leftCheekBuffer.removeFirst()
        }
        roiData.rightCheek?.let {
            rightCheekBuffer.add(it)
            if (rightCheekBuffer.size > bufferSize) rightCheekBuffer.removeFirst()
        }

        // Need minimum frames to start processing
        if (foreheadBuffer.size < 90) { // 3 seconds at 30fps
            _verificationState.value = VerificationState(
                status = VerificationState.Status.INITIALIZING,
                confidence = 0f,
                message = "Collecting data... ${foreheadBuffer.size}/90 frames",
                framesCollected = frameCount
            )
            return
        }

        // Process signals
        val rgbBufferMap = mapOf(
            "forehead" to foreheadBuffer.toList(),
            "leftCheek" to leftCheekBuffer.toList(),
            "rightCheek" to rightCheekBuffer.toList()
        )

        val signalResult = SignalProcessing.processRPPGSignal(rgbBufferMap)
        val confidence = SignalProcessing.calculateConfidence(signalResult)

        // Determine status
        val status = determineStatus(confidence, signalResult)
        val message = generateMessage(status, confidence, signalResult)

        // Add to trust history
        val trustPoint = TrustPoint(
            timestamp = System.currentTimeMillis(),
            confidence = confidence.overall,
            status = status
        )
        trustHistory.add(trustPoint)
        if (trustHistory.size > 100) { // Keep last 100 points
            trustHistory.removeFirst()
        }

        // Check for trust degradation
        val degradationDetected = detectTrustDegradation()
        val finalMessage = if (degradationDetected) {
            "⚠️ Trust Degradation Detected!"
        } else {
            message
        }

        _verificationState.value = VerificationState(
            status = status,
            confidence = confidence.overall,
            heartRate = signalResult.heartRate,
            signalQuality = confidence.signalQuality,
            roiConsistency = confidence.roiConsistency,
            framesCollected = frameCount,
            rawSignal = signalResult.rawSignal.takeLast(150), // Last 5 seconds
            trustHistory = trustHistory.toList(),
            message = finalMessage
        )
    }

    /**
     * Determine verification status based on confidence
     */
    private fun determineStatus(
        confidence: SignalProcessing.ConfidenceResult,
        signalResult: SignalProcessing.SignalResult
    ): VerificationState.Status {
        val overall = confidence.overall
        val signalQuality = confidence.signalQuality

        return when {
            // VERIFIED: Strong physiological evidence
            overall >= 0.65f && signalQuality >= 0.40f -> VerificationState.Status.VERIFIED

            // SUSPICIOUS: Poor signal or implausible metrics
            overall < 0.45f && signalQuality >= 0.30f -> VerificationState.Status.SUSPICIOUS

            // UNCERTAIN: Need better conditions or more data
            else -> VerificationState.Status.UNCERTAIN
        }
    }

    /**
     * Generate status message
     */
    private fun generateMessage(
        status: VerificationState.Status,
        confidence: SignalProcessing.ConfidenceResult,
        signalResult: SignalProcessing.SignalResult
    ): String {
        return when (status) {
            VerificationState.Status.VERIFIED -> {
                "✓ Verified - Strong physiological signal detected"
            }
            VerificationState.Status.SUSPICIOUS -> {
                when {
                    signalResult.heartRate == 0 -> "⚠ No periodic signal detected"
                    signalResult.heartRate > 180 || signalResult.heartRate < 40 ->
                        "⚠ Implausible heart rate detected"
                    confidence.snr < 2.0f -> "⚠ Very weak signal - possible spoof"
                    confidence.roiConsistency < 0.3f -> "⚠ Inconsistent facial regions"
                    else -> "⚠ Suspicious - Manual verification recommended"
                }
            }
            VerificationState.Status.UNCERTAIN -> {
                when {
                    confidence.signalQuality < 0.40f && confidence.skinQuality < 0.4f ->
                        "Improve lighting and face positioning"
                    confidence.signalQuality < 0.40f ->
                        "Poor signal quality - improve lighting"
                    foreheadBuffer.size < 150 ->
                        "Hold still - collecting more data..."
                    else -> "Uncertain - Insufficient physiological evidence"
                }
            }
            VerificationState.Status.INITIALIZING -> "Initializing..."
        }
    }

    /**
     * Detect trust degradation (hot-swap attack detection)
     */
    private fun detectTrustDegradation(): Boolean {
        if (trustHistory.size < 30) return false // Need at least 30 points

        // Get recent history (last 30 points = ~1 second)
        val recent = trustHistory.takeLast(30)
        val earlier = trustHistory.dropLast(30).takeLast(30)

        if (earlier.isEmpty()) return false

        // Calculate average confidence for both periods
        val recentAvg = recent.map { it.confidence }.average().toFloat()
        val earlierAvg = earlier.map { it.confidence }.average().toFloat()

        // Significant drop in confidence?
        val drop = earlierAvg - recentAvg
        val wasVerified = earlier.count { it.status == VerificationState.Status.VERIFIED } > 15

        // Degradation detected if:
        // 1. Was previously verified
        // 2. Confidence dropped by more than 30%
        return wasVerified && drop > 0.30f
    }

    /**
     * Reset the processor
     */
    fun reset() {
        foreheadBuffer.clear()
        leftCheekBuffer.clear()
        rightCheekBuffer.clear()
        trustHistory.clear()
        frameCount = 0
        _verificationState.value = VerificationState(
            status = VerificationState.Status.INITIALIZING,
            message = "Initializing..."
        )
    }

    /**
     * Get current buffer fill percentage
     */
    fun getBufferFillPercentage(): Float {
        return (foreheadBuffer.size.toFloat() / bufferSize.toFloat()) * 100f
    }
}
