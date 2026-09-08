package com.veyrax.pulseverify.core

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import kotlin.math.max
import kotlin.math.min

/**
 * ROI (Region of Interest) Extractor for rPPG
 * Extracts facial regions using MediaPipe Face Mesh landmarks
 */
object ROIExtractor {

    // MediaPipe Face Mesh landmark indices for ROIs
    private val FOREHEAD_INDICES = listOf(10, 67, 109, 338, 297)
    private val LEFT_CHEEK_INDICES = listOf(266, 426, 436, 416, 376)
    private val RIGHT_CHEEK_INDICES = listOf(36, 206, 216, 192, 147)

    data class ROIData(
        val forehead: SignalProcessing.RGBValue?,
        val leftCheek: SignalProcessing.RGBValue?,
        val rightCheek: SignalProcessing.RGBValue?
    )

    data class ROIRect(
        val region: String,
        val rect: Rect
    )

    /**
     * Extract RGB values from all three ROIs
     */
    fun extractROIs(bitmap: Bitmap, faceLandmarks: FaceLandmarkerResult): ROIData? {
        if (faceLandmarks.faceLandmarks().isEmpty()) {
            return null
        }

        val landmarks = faceLandmarks.faceLandmarks()[0]
        val width = bitmap.width
        val height = bitmap.height

        val forehead = extractROI(bitmap, landmarks, FOREHEAD_INDICES, width, height)
        val leftCheek = extractROI(bitmap, landmarks, LEFT_CHEEK_INDICES, width, height)
        val rightCheek = extractROI(bitmap, landmarks, RIGHT_CHEEK_INDICES, width, height)

        // Need at least 2 valid ROIs
        val validCount = listOf(forehead, leftCheek, rightCheek).count { it != null }
        if (validCount < 2) {
            return null
        }

        return ROIData(
            forehead = forehead,
            leftCheek = leftCheek,
            rightCheek = rightCheek
        )
    }

    /**
     * Get ROI rectangles for visualization (mirrored for front camera preview)
     */
    fun getROIRects(faceLandmarks: FaceLandmarkerResult, width: Int, height: Int, isFrontCamera: Boolean = true): List<ROIRect> {
        if (faceLandmarks.faceLandmarks().isEmpty()) {
            return emptyList()
        }

        val landmarks = faceLandmarks.faceLandmarks()[0]
        val rects = mutableListOf<ROIRect>()

        // Forehead
        getROIBounds(landmarks, FOREHEAD_INDICES, width, height, isFrontCamera)?.let { rect ->
            rects.add(ROIRect("forehead", rect))
        }

        // Left cheek
        getROIBounds(landmarks, LEFT_CHEEK_INDICES, width, height, isFrontCamera)?.let { rect ->
            rects.add(ROIRect("leftCheek", rect))
        }

        // Right cheek
        getROIBounds(landmarks, RIGHT_CHEEK_INDICES, width, height, isFrontCamera)?.let { rect ->
            rects.add(ROIRect("rightCheek", rect))
        }

        return rects
    }

    private fun extractROI(
        bitmap: Bitmap,
        landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>,
        indices: List<Int>,
        width: Int,
        height: Int
    ): SignalProcessing.RGBValue? {
        val points = indices.map { i ->
            val landmark = landmarks[i]
            Pair(
                (landmark.x() * width).toInt().coerceIn(0, width - 1),
                (landmark.y() * height).toInt().coerceIn(0, height - 1)
            )
        }

        val minX = max(0, points.minOf { it.first })
        val maxX = min(width - 1, points.maxOf { it.first })
        val minY = max(0, points.minOf { it.second })
        val maxY = min(height - 1, points.maxOf { it.second })

        val roiWidth = maxX - minX
        val roiHeight = maxY - minY

        if (roiWidth <= 0 || roiHeight <= 0) {
            return null
        }

        // Extract pixels from ROI
        val pixels = IntArray(roiWidth * roiHeight)
        bitmap.getPixels(pixels, 0, roiWidth, minX, minY, roiWidth, roiHeight)

        // Apply skin filtering
        return SignalProcessing.extractROIWithSkinFilter(pixels)
    }

    private fun getROIBounds(
        landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>,
        indices: List<Int>,
        width: Int,
        height: Int,
        isFrontCamera: Boolean = true
    ): Rect? {
        val points = indices.map { i ->
            val landmark = landmarks[i]
            val xNorm = if (isFrontCamera) (1f - landmark.x()) else landmark.x()
            Pair(
                (xNorm * width).toInt().coerceIn(0, width - 1),
                (landmark.y() * height).toInt().coerceIn(0, height - 1)
            )
        }

        val minX = max(0, points.minOf { it.first })
        val maxX = min(width - 1, points.maxOf { it.first })
        val minY = max(0, points.minOf { it.second })
        val maxY = min(height - 1, points.maxOf { it.second })

        val roiWidth = maxX - minX
        val roiHeight = maxY - minY

        if (roiWidth <= 0 || roiHeight <= 0) {
            return null
        }

        return Rect(minX, minY, maxX, maxY)
    }
}
