import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import './Dashboard.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler
);

const Dashboard = ({ data }) => {
  const { status, confidence, signalQuality, roiConsistency, trustHistory, livenessFactors = [], blinkCount = 0, captureQuality = 0, guidance = 'Waiting for a face in the camera.', activeChallenge = null, state = null, sustainedFrames = 0 } = data;

  // Status badge styling
  const getStatusConfig = () => {
    switch (status) {
      case 'VERIFIED':
        return {
          label: 'VERIFIED',
          sublabel: 'High Confidence Human',
          color: '#10b981',
          gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          icon: '✓'
        };
      case 'SUSPICIOUS':
        return {
          label: 'SUSPICIOUS',
          sublabel: 'Physiological Inconsistency',
          color: '#ef4444',
          gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          icon: '⚠'
        };
      default:
        return {
          label: 'UNCERTAIN',
          sublabel: 'Insufficient Signal',
          color: '#f59e0b',
          gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          icon: '●'
        };
    }
  };

  const statusConfig = getStatusConfig();

  // Trust timeline chart data
  const trustChartData = {
    labels: trustHistory.map((_, i) => ''),
    datasets: [
      {
        label: 'Trust Score',
        data: trustHistory.map(entry => entry.confidence * 100),
        borderColor: statusConfig.color,
        backgroundColor: `${statusConfig.color}33`,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const trustChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        grid: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.6)',
          callback: (value) => value + '%',
        },
      },
      x: {
        display: false,
      },
    },
  };

  // Check for trust degradation
  const detectTrustDegradation = () => {
    if (trustHistory.length < 10) return false;

    const recent = trustHistory.slice(-10);
    const firstAvg = recent.slice(0, 5).reduce((sum, e) => sum + e.confidence, 0) / 5;
    const lastAvg = recent.slice(5).reduce((sum, e) => sum + e.confidence, 0) / 5;

    return firstAvg > 0.7 && lastAvg < 0.5;
  };

  const showDegradationWarning = detectTrustDegradation();

  return (
    <div className="dashboard">
      {/* Status Card */}
      <div className="status-card" style={{ borderColor: statusConfig.color }}>
        <div className="status-header">
          <div className="status-icon" style={{ background: statusConfig.gradient }}>
            {statusConfig.icon}
          </div>
          <div className="status-text">
            <div className="status-label" style={{ color: statusConfig.color }}>
              {statusConfig.label}
            </div>
            <div className="status-sublabel">{statusConfig.sublabel}</div>
          </div>
        </div>

        <div className="confidence-display">
          <div className="confidence-value" style={{ color: statusConfig.color }}>
            {Math.round(confidence * 100)}%
          </div>
          <div className="confidence-label">Human Confidence</div>
        </div>

        {showDegradationWarning && (
          <div className="alert-banner">
            <span className="alert-icon">⚡</span>
            <div>
              <strong>Trust Degradation Detected</strong>
              <p>Physiological evidence has changed significantly</p>
            </div>
          </div>
        )}
      </div>

      {/* Trust Timeline */}
      <div className="metric-card">
        <div className="card-header">
          <h3>Trust Timeline</h3>
          <div className="card-hint">Continuous Verification</div>
        </div>
        <div className="chart-container">
          {trustHistory.length > 0 ? (
            <Line data={trustChartData} options={trustChartOptions} />
          ) : (
            <div className="chart-placeholder">
              <div className="placeholder-text">Awaiting signal data...</div>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-item">
          <div className="metric-label">Signal Quality</div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{
                width: `${signalQuality * 100}%`,
                background: signalQuality > 0.6 ? '#10b981' : signalQuality > 0.3 ? '#f59e0b' : '#ef4444'
              }}
            />
          </div>
          <div className="metric-value">{Math.round(signalQuality * 100)}%</div>
        </div>

        <div className="metric-item">
          <div className="metric-label">Blink evidence</div>
          <div className="metric-value-large">
            {blinkCount > 0 ? `${blinkCount} detected` : '--'}
          </div>
          <div className="metric-hint">
            {blinkCount > 0 ? 'Natural eye closure recorded' : 'Blink naturally to add evidence'}
          </div>
        </div>

        <div className="metric-item">
          <div className="metric-label">ROI Consistency</div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{
                width: `${roiConsistency * 100}%`,
                background: roiConsistency > 0.6 ? '#10b981' : roiConsistency > 0.3 ? '#f59e0b' : '#ef4444'
              }}
            />
          </div>
          <div className="metric-value">{Math.round(roiConsistency * 100)}%</div>
        </div>
      </div>

      <div className="capture-guidance" role="status" aria-live="polite">
        <div className="capture-guidance-title">Camera guidance</div>
        <p>{guidance}</p>
        <div className="capture-guidance-bar" aria-label={`Capture quality ${Math.round(captureQuality * 100)}%`}>
          <div style={{ width: `${captureQuality * 100}%` }} />
        </div>
      </div>

      {/* Signal Quality Indicators */}
      <div className="metric-card">
        <div className="card-header">
          <h3>Liveness Factors</h3>
        </div>
        <div className="quality-indicators">
          {livenessFactors.length > 0 ? (
            livenessFactors.map((factor, idx) => (
              <div key={idx} className="quality-item">
                <div className="quality-dot" style={{
                  background: factor.status === 'pass' ? '#10b981' :
                             factor.status === 'warn' ? '#f59e0b' :
                             factor.status === 'pending' ? '#6b7280' : '#ef4444'
                }} />
                <span>{factor.name}</span>
                <span className="quality-status">
                  {factor.score > 0 ? `+${factor.score}` : factor.score}
                </span>
              </div>
            ))
          ) : (
            <div className="quality-item">
              <div className="quality-dot" style={{ background: '#6b7280' }} />
              <span>Analyzing...</span>
              <span className="quality-status">Waiting</span>
            </div>
          )}
        </div>

        {activeChallenge && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
            <div style={{ fontSize: '0.875rem', color: '#818cf8', marginBottom: '0.5rem' }}>
              <strong>🎯 Challenge: {activeChallenge.instruction}</strong>
            </div>
            {activeChallenge.progress !== undefined && (
              <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                <div style={{
                  width: `${activeChallenge.progress * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1, #818cf8)'
                }} />
              </div>
            )}
          </div>
        )}

        {blinkCount > 0 && !activeChallenge && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.875rem', color: '#10b981' }}>
              <strong>✓ {blinkCount} Blink{blinkCount > 1 ? 's' : ''} Detected</strong>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '0.25rem' }}>
              Natural eye movement confirmed
            </div>
          </div>
        )}

        {state && sustainedFrames > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
            State: {state} • Sustained: {sustainedFrames} frames
          </div>
        )}
      </div>

      {/* Recommendations */}
      {status === 'UNCERTAIN' && (
        <div className="recommendation-card">
          <div className="recommendation-header">
            <span className="recommendation-icon">💡</span>
            <strong>Improve Signal Quality</strong>
          </div>
          <ul className="recommendation-list">
            <li>Ensure adequate lighting on your face</li>
            <li>Position camera at eye level</li>
            <li>Stay comfortable and blink naturally while the signal settles</li>
            <li>Remove glasses if possible</li>
          </ul>
        </div>
      )}

      {status === 'SUSPICIOUS' && (
        <div className="recommendation-card alert">
          <div className="recommendation-header">
            <span className="recommendation-icon">🛡️</span>
            <strong>Manual Verification Recommended</strong>
          </div>
          <p className="recommendation-text">
            Physiological signals show inconsistency patterns. Consider additional verification methods.
          </p>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
