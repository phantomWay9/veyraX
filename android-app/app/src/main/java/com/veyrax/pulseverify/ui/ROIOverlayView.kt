package com.veyrax.pulseverify.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.util.AttributeSet
import android.view.View
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.veyrax.pulseverify.core.ROIExtractor

class ROIOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private var faceLandmarks: FaceLandmarkerResult? = null
    private var roiRects: List<ROIExtractor.ROIRect> = emptyList()

    private val foreheadPaint = Paint().apply {
        color = Color.RED
        style = Paint.Style.STROKE
        strokeWidth = 4f
        alpha = 200
    }

    private val leftCheekPaint = Paint().apply {
        color = Color.CYAN
        style = Paint.Style.STROKE
        strokeWidth = 4f
        alpha = 200
    }

    private val rightCheekPaint = Paint().apply {
        color = Color.rgb(173, 216, 230)
        style = Paint.Style.STROKE
        strokeWidth = 4f
        alpha = 200
    }

    fun updateFaceLandmarks(landmarks: FaceLandmarkerResult) {
        this.faceLandmarks = landmarks
        this.roiRects = ROIExtractor.getROIRects(landmarks, width, height)
        invalidate()
    }

    fun clear() {
        faceLandmarks = null
        roiRects = emptyList()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        if (roiRects.isEmpty()) return

        for (roiRect in roiRects) {
            val paint = when (roiRect.region) {
                "forehead" -> foreheadPaint
                "leftCheek" -> leftCheekPaint
                "rightCheek" -> rightCheekPaint
                else -> foreheadPaint
            }

            canvas.drawRect(roiRect.rect, paint)
        }
    }
}
