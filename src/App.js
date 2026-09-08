import React, { useState } from 'react';
import './App.css';
import VideoCapture from './components/VideoCapture';
import Dashboard from './components/Dashboard';

function App() {
  const [verificationData, setVerificationData] = useState({
    status: 'UNCERTAIN',
    confidence: 0,
    signalQuality: 0,
    roiConsistency: 0,
    captureQuality: 0,
    guidance: 'Start verification, then place your face in the camera frame.',
    trustHistory: []
  });

  return (
    <div className="App">
      <header className="app-header">
        <div className="logo">
          <div className="pulse-icon"></div>
          <h1>veyraX</h1>
        </div>
        <div className="tagline">Physiological Liveness Verification</div>
      </header>

      <main className="app-main">
        <VideoCapture onVerificationUpdate={setVerificationData} />
        <Dashboard data={verificationData} />
      </main>

      <footer className="app-footer">
        <div className="privacy-badge">
          <span className="badge-icon">🔒</span>
          <span>100% On-Device • 0KB Cloud Transfer • Privacy-Preserving</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
