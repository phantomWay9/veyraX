package com.veyrax.pulseverify.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.github.mikephil.charting.charts.LineChart
import com.github.mikephil.charting.data.Entry
import com.github.mikephil.charting.data.LineData
import com.github.mikephil.charting.data.LineDataSet
import com.google.android.material.button.MaterialButton
import com.veyrax.pulseverify.R
import com.veyrax.pulseverify.core.CameraManager
import com.veyrax.pulseverify.core.RPPGProcessor
import kotlinx.coroutines.launch
import android.widget.ProgressBar
import android.widget.TextView
import androidx.camera.view.PreviewView

class MainActivity : AppCompatActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var roiOverlay: ROIOverlayView
    private lateinit var statusBadge: TextView
    private lateinit var confidenceText: TextView
    private lateinit var heartRateText: TextView
    private lateinit var statusMessage: TextView
    private lateinit var signalQualityValue: TextView
    private lateinit var signalQualityBar: ProgressBar
    private lateinit var roiConsistencyValue: TextView
    private lateinit var roiConsistencyBar: ProgressBar
    private lateinit var trustChart: LineChart
    private lateinit var startButton: MaterialButton
    private lateinit var stopButton: MaterialButton

    private lateinit var cameraManager: CameraManager
    private lateinit var rppgProcessor: RPPGProcessor

    private var isRunning = false

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            startVerification()
        } else {
            Toast.makeText(this, "Camera permission required", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initializeViews()
        setupChart()
        setupButtons()

        rppgProcessor = RPPGProcessor()
        cameraManager = CameraManager(this, this, previewView)

        // Observe verification state
        lifecycleScope.launch {
            rppgProcessor.verificationState.collect { state ->
                updateUI(state)
            }
        }
    }

    private fun initializeViews() {
        previewView = findViewById(R.id.previewView)
        roiOverlay = findViewById(R.id.roiOverlay)
        statusBadge = findViewById(R.id.statusBadge)
        confidenceText = findViewById(R.id.confidenceText)
        heartRateText = findViewById(R.id.heartRateText)
        statusMessage = findViewById(R.id.statusMessage)
        signalQualityValue = findViewById(R.id.signalQualityValue)
        signalQualityBar = findViewById(R.id.signalQualityBar)
        roiConsistencyValue = findViewById(R.id.roiConsistencyValue)
        roiConsistencyBar = findViewById(R.id.roiConsistencyBar)
        trustChart = findViewById(R.id.trustChart)
        startButton = findViewById(R.id.startButton)
        stopButton = findViewById(R.id.stopButton)
    }

    private fun setupChart() {
        trustChart.apply {
            description.isEnabled = false
            setTouchEnabled(false)
            isDragEnabled = false
            setScaleEnabled(false)
            setDrawGridBackground(false)
            legend.isEnabled = false

            xAxis.apply {
                isEnabled = false
            }

            axisLeft.apply {
                axisMinimum = 0f
                axisMaximum = 100f
                setDrawGridLines(true)
                textColor = android.graphics.Color.WHITE
            }

            axisRight.isEnabled = false
        }
    }

    private fun setupButtons() {
        startButton.setOnClickListener {
            checkCameraPermissionAndStart()
        }

        stopButton.setOnClickListener {
            stopVerification()
        }
    }

    private fun checkCameraPermissionAndStart() {
        when {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED -> {
                startVerification()
            }
            else -> {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }
    }

    private fun startVerification() {
        if (isRunning) return

        isRunning = true
        startButton.isEnabled = false
        stopButton.isEnabled = true

        rppgProcessor.reset()

        cameraManager.initialize { bitmap, faceLandmarks ->
            rppgProcessor.processFrame(bitmap, faceLandmarks)
            runOnUiThread {
                roiOverlay.updateFaceLandmarks(faceLandmarks)
            }
        }
    }

    private fun stopVerification() {
        if (!isRunning) return

        isRunning = false
        startButton.isEnabled = true
        stopButton.isEnabled = false

        cameraManager.release()
        rppgProcessor.reset()
        roiOverlay.clear()
    }

    private fun updateUI(state: RPPGProcessor.VerificationState) {
        // Update status badge
        when (state.status) {
            RPPGProcessor.VerificationState.Status.VERIFIED -> {
                statusBadge.text = "VERIFIED"
                statusBadge.setBackgroundResource(R.drawable.badge_verified)
            }
            RPPGProcessor.VerificationState.Status.SUSPICIOUS -> {
                statusBadge.text = "SUSPICIOUS"
                statusBadge.setBackgroundResource(R.drawable.badge_suspicious)
            }
            RPPGProcessor.VerificationState.Status.UNCERTAIN -> {
                statusBadge.text = "UNCERTAIN"
                statusBadge.setBackgroundResource(R.drawable.badge_uncertain)
            }
            RPPGProcessor.VerificationState.Status.INITIALIZING -> {
                statusBadge.text = "INITIALIZING"
                statusBadge.setBackgroundResource(R.drawable.badge_uncertain)
            }
        }

        // Update confidence
        confidenceText.text = "${(state.confidence * 100).toInt()}%"

        // Update heart rate
        heartRateText.text = if (state.heartRate > 0) {
            "${state.heartRate} BPM"
        } else {
            "-- BPM"
        }

        // Update message
        statusMessage.text = state.message

        // Update signal quality
        val signalQualityPercent = (state.signalQuality * 100).toInt()
        signalQualityValue.text = "$signalQualityPercent%"
        signalQualityBar.progress = signalQualityPercent

        // Update ROI consistency
        val roiConsistencyPercent = (state.roiConsistency * 100).toInt()
        roiConsistencyValue.text = "$roiConsistencyPercent%"
        roiConsistencyBar.progress = roiConsistencyPercent

        // Update trust chart
        updateTrustChart(state.trustHistory)
    }

    private fun updateTrustChart(history: List<RPPGProcessor.TrustPoint>) {
        if (history.isEmpty()) return

        val entries = history.mapIndexed { index, point ->
            Entry(index.toFloat(), point.confidence * 100f)
        }

        val dataSet = LineDataSet(entries, "Trust").apply {
            color = android.graphics.Color.parseColor("#4CAF50")
            lineWidth = 2f
            setDrawCircles(false)
            setDrawValues(false)
            setDrawFilled(true)
            fillColor = android.graphics.Color.parseColor("#4CAF50")
            fillAlpha = 50
        }

        trustChart.data = LineData(dataSet)
        trustChart.invalidate()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isRunning) {
            cameraManager.release()
        }
    }
}
