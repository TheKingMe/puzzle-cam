<div align="center">

# 🧩 PUZZLE · CAM
### Real-Time Computer Vision Photobooth & Gesture-Controlled Tile Puzzle

[![Python](https://img.shields.io/badge/Python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12%20%7C%203.14-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![OpenCV](https://img.shields.io/badge/OpenCV-5.0+-5C3EE8?logo=opencv&logoColor=white)](https://opencv.org/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks%20Hands-0078D4?logo=google&logoColor=white)](https://developers.google.com/mediapipe)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Turn your webcam into an interactive arcade photobooth.**  
Frame portraits in mid-air using your hands, watch the snapshot explode into 36 physics fragments, solve the scrambled 3×3 puzzle using pinch gestures, and save collectible vintage photobooth film strips.

[✨ Features](#-key-features) • [🎮 How It Works](#-how-it-works-gesture-flow) • [🚀 Quick Start](#-quick-start) • [⌨️ Controls](#️-controls--shortcuts) • [🎞️ Film Filters](#️-vintage--cyber-film-filters) • [📁 Structure](#-project-structure)

---

</div>

## 🌟 Key Features

* **👐 Air Framing Capture**: Hold up both hands to frame your portrait. An animated golden HUD locks onto your crop area with countdown audio beeps and a shutter flash.
* **💥 6×6 Fragment Shatter**: Your captured photo shatters into 36 dynamic fragments exploding across the screen with randomized velocity, rotation, gravity, and glass crash SFX.
* **🤏 Ultra-Stable Pinch-to-Swap**: Drag and drop puzzle pieces smoothly in mid-air. Uses **dual-threshold hysteresis** (`grab < 38px`, `release > 56px`) and **palm-scale normalization**, guaranteeing rock-solid tracking at any distance from your camera.
* **✨ Sparkles & Confetti Celebration**: Correctly placed tiles trigger sparkling golden particle bursts; completing all 9 pieces unleashes a multi-colored celebration confetti cannon!
* **✊ / ✌️ Gesture Save**: Close your fist or strike a peace sign to trigger the camera flash, process the vintage film grade, and print to your photobooth strip.
* **🎞️ Photobooth Strip Exporter**: Automatically composes vertical 3-photo cards with authentic margins, timestamps, move count, and branding. Export high-res PNGs with one click or keypress.
* **⚡ Dual-Engine Support**: Run as a **native zero-latency Python desktop app** (OpenCV + MediaPipe Tasks) or directly in your **web browser** (HTML5 Canvas + MediaPipe Hands JS).

---

## 🎮 How It Works (Gesture Flow)

```
 [ 1. Hand Framing ] ──> [ 2. 6x6 Shatter ] ──> [ 3. Pinch 3x3 Puzzle ] ──> [ 4. Fist / Peace Save ] ──> [ 5. 3-Photo Strip ]
   Define crop box          36 fragments          Drag & swap tiles          Trigger vintage filter        Download PNG card
   with both hands           explode out            in mid-air                  when completed              with live scores
```

| Step | Action | Gesture / Input | Description |
| :--- | :--- | :--- | :--- |
| **1. Frame** | **Air Crop** | 👐 **Two Hands** | Form a rectangle with both hands. Hold steady for ~1.3s as the countdown ring fills *(or press `Spacebar`)*. |
| **2. Shatter** | **Explosion** | 💥 **Automatic** | Photo disintegrates into 36 pieces that scatter outward with physics simulation. |
| **3. Solve** | **Tile Swap** | 🤏 **Pinch (Thumb + Index)** | Touch thumb & index together over a tile to pick it up, drag it to another slot, and release fingers to swap. |
| **4. Save** | **Print** | ✊ **Fist** or ✌️ **Peace Sign** | When solved (`9 / 9`), hold a closed fist or peace sign for 0.5s to flash and print to the strip. |
| **5. Export** | **Download** | 💾 **Click or 'S'** | Stacks up to 3 photos into a vintage card. Press `S` to export as a high-res PNG to disk. |

---

## 🚀 Quick Start

### Option A: Native Python Desktop App (Recommended)

Requires **Python 3.9+** and a webcam.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/puzzle-cam.git
   cd puzzle-cam
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Launch the application:**
   * **Windows**: Double-click [`run_python.bat`](run_python.bat)
   * **Terminal / macOS / Linux**:
     ```bash
     python puzzle_cam.py
     ```
   *(On first run, the 7.8 MB Google MediaPipe Hand model is automatically downloaded into the directory).*

---

### Option B: In-Browser Web App (HTML5 / JS)

No Python installation required. Because modern web browsers require a secure origin (`localhost`) to access the webcam:

1. **Start a local HTTP server:**
   * **Windows**: Double-click [`start.bat`](start.bat)
   * **Or run in terminal:**
     ```bash
     python -m http.server 8000
     ```
2. Open **[http://localhost:8000](http://localhost:8000)** in Chrome, Edge, or Brave and click **Allow** on the camera prompt.

---

## ⌨️ Controls & Shortcuts

| Action | Hand Gesture | Keyboard Shortcut | Mouse Fallback |
| :--- | :---: | :---: | :---: |
| **Snap Photo Frame** | Hold framing box steady | `Spacebar` | Left-click canvas |
| **Pick up / Drag piece** | Pinch thumb & index together | — | Click & drag piece |
| **Drop & Swap piece** | Release pinch over target slot | — | Release mouse button |
| **Save Completed Photo** | Closed Fist (✊) or Peace (✌️) | `Spacebar` | Automatic upon hold |
| **Cycle Film Filters** | — | `F` | Click `FILTRO` button |
| **Download / Export Strip** | — | `S` | Click `DESCARGAR` button |
| **Reset Board & Strip** | — | `R` | Click `REINICIAR` button |
| **Quit Application** | — | `Q` or `Esc` | Close window |

---

## 🎞️ Vintage & Cyber Film Filters

Switch presets anytime during gameplay by pressing **`F`** or clicking the filter selector:

| Filter | Aesthetic & Technical Grade |
| :--- | :--- |
| **NOIR FILM** | Silver-gelatin grayscale, procedural Gaussian film grain (`STD = 15`), high S-curve contrast, and optical radial vignette. |
| **POLAROID 70s** | Warm amber and sepia tint, lifted shadow blacks (+18 Red, -14 Blue), and soft analog film softening. |
| **CYBER NEON** | High-contrast Matrix & cyberpunk grading, deep teal/cyan shadows, and saturated magenta highlights. |

---

## 📁 Project Structure

```
puzzle-cam/
├── puzzle_cam.py          # Native Python desktop application (OpenCV + MediaPipe Tasks)
├── index.html             # Web UI layout, HUD overlays, canvas, and sidebar
├── css/
│   └── styles.css         # Dark minimalist cyber theme & vintage photobooth card CSS
├── app.js                 # Browser engine (MediaPipe Hands JS, physics, Web Audio SFX)
├── requirements.txt       # Python dependencies (opencv-python, mediapipe, numpy)
├── run_python.bat         # 1-click native Python desktop launcher (Windows)
├── start.bat              # 1-click local web server launcher (Windows)
├── .gitignore             # Standard Python, output, and OS exclusions
└── README.md              # Project documentation
```

---

## 🔬 Under The Hood

* **Temporal Video Tracking (`RunningMode.VIDEO`)**: Uses continuous inter-frame landmark tracking rather than running isolated palm detection on every frame, cutting inference latency by ~60%.
* **Zero Camera Buffer Delay**: OpenCV's default multi-frame queue is bypassed with `CAP_PROP_BUFFERSIZE = 1`, eliminating camera lag.
* **Palm-Scale Invariance**: Pinch distance is evaluated as `d_pinch / len(wrist -> middle_mcp)`. Whether you are 40 cm or 2 meters away from your camera, the gesture sensitivity remains identical.
* **Dynamic Velocity Cursor Filter**: Fast finger movements bypass low-pass filtering for instant 1:1 responsiveness, while stationary hovering dampens camera sensor micro-jitter.

---

## 🤝 Contributing

Contributions, feature requests, and bug reports are welcome!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<div align="center">
  <sub>Built with ❤️ using MediaPipe, OpenCV, and HTML5 Canvas.</sub>
</div>
