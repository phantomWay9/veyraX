package com.veyrax.pulseverify.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Camera Manager with MediaPipe Face Landmark Detection
 * Handles camera initialization and frame processing
 */
class CameraManager(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView
) {
    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var imageAnalyzer: ImageAnalysis? = null
    private var faceLandmarker: FaceLandmarker? = null

    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private var onFrameProcessed: ((Bitmap, FaceLandmarkerResult) -> Unit)? = null
    private var isProcessing = false

    /**
     * Initialize camera and MediaPipe
     */
    fun initialize(onFrameCallback: (Bitmap, FaceLandmarkerResult) -> Unit) {
        this.onFrameProcessed = onFrameCallback

        // Initialize MediaPipe Face Landmarker
        initializeFaceLandmarker()

        // Initialize CameraX
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            bindCamera()
        }, ContextCompat.getMainExecutor(context))
    }

    /**
     * Initialize MediaPipe Face Landmarker
     */
    private fun initializeFaceLandmarker() {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("face_landmarker.task")
            .build()

        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .setNumFaces(1)
            .setMinFaceDetectionConfidence(0.5f)
            .setMinFacePresenceConfidence(0.5f)
            .setMinTrackingConfidence(0.5f)
            .build()

        try {
            faceLandmarker = FaceLandmarker.createFromOptions(context, options)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Bind camera to lifecycle
     */
    private fun bindCamera() {
        val cameraProvider = this.cameraProvider ?: return

        // Preview use case
        val preview = Preview.Builder()
            .build()
            .also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

        // Image analysis use case for face detection
        imageAnalyzer = ImageAnalysis.Builder()
            .setTargetResolution(android.util.Size(640, 480))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
            .also {
                it.setAnalyzer(cameraExecutor) { imageProxy ->
                    processImageProxy(imageProxy)
                }
            }

        // Select front camera
        val cameraSelector = CameraSelector.Builder()
            .requireLensFacing(CameraSelector.LENS_FACING_FRONT)
            .build()

        try {
            // Unbind all use cases before rebinding
            cameraProvider.unbindAll()

            // Bind use cases to camera
            camera = cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageAnalyzer
            )

        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Process image from camera
     */
    private fun processImageProxy(imageProxy: ImageProxy) {
        if (isProcessing) {
            imageProxy.close()
            return
        }

        isProcessing = true

        try {
            // Convert ImageProxy to Bitmap
            val bitmap = imageProxyToBitmap(imageProxy)

            if (bitmap != null && faceLandmarker != null) {
                // Detect face landmarks
                val mpImage = BitmapImageBuilder(bitmap).build()
                val result = faceLandmarker?.detect(mpImage)

                if (result != null && result.faceLandmarks().isNotEmpty()) {
                    // Process frame with landmarks
                    onFrameProcessed?.invoke(bitmap, result)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            isProcessing = false
            imageProxy.close()
        }
    }

    /**
     * Convert ImageProxy to Bitmap with proper rotation handling
     */
    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        val bitmap = imageProxy.toBitmap()
        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        return if (rotationDegrees != 0) {
            val matrix = Matrix().apply {
                postRotate(rotationDegrees.toFloat())
            }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } else {
            bitmap
        }
    }

    /**
     * Release resources
     */
    fun release() {
        cameraProvider?.unbindAll()
        faceLandmarker?.close()
        cameraExecutor.shutdown()
    }

    /**
     * Get camera info (for debugging)
     */
    fun getCameraInfo(): String {
        return "Camera: ${camera?.cameraInfo?.lensFacing}"
    }
}
