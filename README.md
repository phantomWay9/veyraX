# VeyraX

### Verify the Human. Not Just the Face.

**Continuous Physiological Liveness Verification for Video Calls**

VeyraX is an AI-powered liveness verification system designed to determine whether a person in front of a camera is genuinely present or being represented through a photo, replayed video, screen, or digitally manipulated media.

Traditional face verification answers:

> "Does this face match?"

VeyraX focuses on a harder question:

> "Is this actually a live human being right now?"

---

## The Problem

As deepfakes, face-swapping, replay attacks, and synthetic media become increasingly realistic, simply recognizing a face is no longer enough.

A system can recognize the correct face while still being fooled by:

- Printed photographs
- Images displayed on another device
- Replayed videos
- Screen-based attacks
- Face replacement
- AI-generated or manipulated video

VeyraX approaches liveness as a **continuous trust problem**, rather than a single face-recognition decision.

---

## Our Solution

VeyraX combines multiple independent signals to determine whether a video stream behaves like a genuine live person.

### Core signals

**Physiological signals**
- Remote Photoplethysmography (rPPG)
- Subtle blood-volume changes visible through the skin
- Signal quality and periodicity analysis
- Cross-region physiological consistency

**Visual & temporal signals**
- Facial movement consistency
- Temporal behavior across frames
- Region-of-interest consistency
- Detection of unnatural or inconsistent patterns

**Presentation-attack signals**
- Replay detection
- Screen/display artifacts
- Visual inconsistencies
- Suspicious temporal patterns

These signals are fused into a continuously updated trust assessment.

---

## How It Works

```text
                Camera / Video Stream
                         |
                         v
                Face Detection
                         |
                         v
              Region of Interest
          ┌──────────┬──────────┐
          |          |          |
       Forehead   Left Cheek  Right Cheek
          |          |          |
          └──────────┴──────────┘
                         |
                         v
                  rPPG Analysis
                         |
              ┌──────────┴──────────┐
              |                     |
        Signal Quality        Periodicity
              |                     |
              └──────────┬──────────┘
                         |
                         v
               Multi-ROI Consistency
                         |
                         v
                Motion Analysis
                         |
                         v
          Visual / Temporal Evidence
                         |
                         v
              Evidence Fusion Layer
                         |
                         v
              ┌───────────────────┐
              │   TRUST STATE     │
              │                   │
              │   VERIFIED        │
              │   UNCERTAIN       │
              │   SUSPICIOUS      │
              └───────────────────┘