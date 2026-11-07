import os
import sys
import time
import math
import random
from datetime import datetime
import numpy as np
import cv2

try:
    import winsound
except ImportError:
    winsound = None

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# ========================================================
# Constants & Configuration
# ========================================================
PHOTOBOOTH_NOISE_STD = 15
MAX_STRIP_PHOTOS = 3
SHATTER_COLS = 6
SHATTER_ROWS = 6
SHATTER_DURATION_S = 0.85

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

# Audio Feedback using Windows winsound
def play_sfx(sfx_type):
    if not winsound:
        return
    try:
        if sfx_type == "shutter":
            winsound.Beep(1200, 40)
            winsound.Beep(600, 50)
        elif sfx_type == "shatter":
            winsound.Beep(2200, 30)
            winsound.Beep(1400, 40)
            winsound.Beep(800, 60)
        elif sfx_type == "snap":
            winsound.Beep(880, 35)
        elif sfx_type == "spark":
            winsound.Beep(1250, 30)
        elif sfx_type == "beep":
            winsound.Beep(750, 40)
        elif sfx_type == "complete":
            for freq in (523, 659, 784, 1046, 1318):
                winsound.Beep(freq, 70)
    except Exception:
        pass

# Ensure model exists
MODEL_PATH = os.path.join(os.path.dirname(__file__), "hand_landmarker.task")
if not os.path.exists(MODEL_PATH):
    import urllib.request
    print("Downloading hand_landmarker.task...")
    url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
    urllib.request.urlretrieve(url, MODEL_PATH)

# ========================================================
# Puzzle Cam Engine
# ========================================================
class PuzzleCam:
    def __init__(self, width=1280, height=720):
        self.vw = 960  # video viewport width
        self.sw = 320  # sidebar width
        self.w = self.vw + self.sw  # 1280
        self.h = height             # 720

        # State Machine: "tracking" | "shatter" | "puzzle"
        self.state = "tracking"

        # Camera: Optimized for zero latency & 60 FPS
        self.cap = cv2.VideoCapture(0)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self.cap.set(cv2.CAP_PROP_FPS, 60)

        # MediaPipe HandLandmarker in VIDEO Tracking Mode
        # (Drastically faster & smoother than still image mode)
        base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.detector = vision.HandLandmarker.create_from_options(options)
        self.last_ts_ms = 0

        # Interaction & Gestures
        self.current_landmarks = []  # list of landmark lists
        self.hand_cursor = None      # (x, y) - always tracks active hand
        self.is_pinching = False
        self.is_fist = False
        self.is_peace = False
        self.is_thumbs_up = False
        self.prev_active_grab = False

        # Framing
        self.active_box = None       # (x, y, w, h)
        self.framing_start = 0
        self.hold_duration = 1.3
        self.flash_opacity = 0.0
        self.countdown_step = 0

        # Shatter
        self.shatter_fragments = []
        self.shatter_start = 0

        # Puzzle
        self.board_box = None        # (x, y, w, h)
        self.captured_crop = None
        self.pieces = []             # list of dicts: {'orig': idx, 'slot': idx, 'img': np.array}
        self.dragged_piece = None
        self.selected_slot = None    # for tap-to-swap: first selected tile slot
        self.drag_offset = (0, 0)
        self.solved = False

        # Score & Timer
        self.puzzle_start_time = 0.0
        self.final_solve_time = 0.0
        self.swap_count = 0

        # Visual FX & Particles
        self.particles = []

        # Filters: "noir" | "polaroid" | "cyber"
        self.filters = ["noir", "polaroid", "cyber"]
        self.filter_idx = 0

        # Fist save hold
        self.fist_start = 0
        self.fist_hold = 0.5

        # Photo Strip
        self.completed_photos = []   # list of (timestamp, crop_bgr)
        self.status_msg = "MANOS EN SEGUIMIENTO"

        # Mouse handling
        self.mouse_pos = (0, 0)
        self.mouse_down = False
        cv2.namedWindow("Puzzle-Cam - Gesture Capture", cv2.WINDOW_AUTOSIZE)
        cv2.setMouseCallback("Puzzle-Cam - Gesture Capture", self.on_mouse)

    def on_mouse(self, event, x, y, flags, param):
        self.mouse_pos = (x, y)
        if event == cv2.EVENT_LBUTTONDOWN:
            self.mouse_down = True
            # Check sidebar clicks
            if x >= self.vw:
                # [FILTER] button click
                if 48 <= y <= 78:
                    self.cycle_filter()
                # [DESCARGAR] button click
                elif self.h - 90 <= y <= self.h - 55:
                    self.save_strip_image()
                # [REINICIAR] button click
                elif self.h - 45 <= y <= self.h - 15:
                    self.reset_all()
        elif event == cv2.EVENT_LBUTTONUP:
            self.mouse_down = False

    def cycle_filter(self):
        self.filter_idx = (self.filter_idx + 1) % len(self.filters)
        play_sfx("snap")

    def reset_all(self):
        self.completed_photos.clear()
        self.state = "tracking"
        self.pieces.clear()
        self.particles.clear()
        self.solved = False
        self.puzzle_start_time = 0.0
        self.final_solve_time = 0.0
        self.swap_count = 0
        self.status_msg = "MANOS EN SEGUIMIENTO"
        play_sfx("snap")

    # ========================================================
    # MediaPipe Detection & Gestures
    # ========================================================
    def process_hands(self, frame_bgr):
        # MediaPipe expects RGB
        rgb_frame = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # Monotonically increasing timestamp in ms for VIDEO mode
        ts_ms = int(time.perf_counter() * 1000)
        if ts_ms <= self.last_ts_ms:
            ts_ms = self.last_ts_ms + 1
        self.last_ts_ms = ts_ms

        result = self.detector.detect_for_video(mp_image, ts_ms)

        self.current_landmarks = []
        self.hand_cursor = None
        self.is_pinching = False
        self.is_fist = False
        self.is_peace = False
        self.is_thumbs_up = False

        if not result.hand_landmarks:
            return

        for hand_lms in result.hand_landmarks:
            pts = [(int(lm.x * self.vw), int(lm.y * self.h)) for lm in hand_lms]
            self.current_landmarks.append(pts)

            # Landmarks: 0: Wrist, 4: Thumb Tip, 8: Index Tip, 9: Middle MCP
            p0 = pts[0]
            p4 = pts[4]
            p8 = pts[8]
            p9 = pts[9]

            # Scale-Normalized Pinch Detection:
            # Measures distance relative to your palm size, so it works perfectly
            # whether you are sitting close to or far from the webcam!
            palm_len = max(35.0, math.hypot(p9[0] - p0[0], p9[1] - p0[1]))
            dist_pinch = math.hypot(p4[0] - p8[0], p4[1] - p8[1])
            pinch_ratio = dist_pinch / palm_len

            # Dual-threshold hysteresis normalized by hand scale
            grab_ratio = 0.28
            release_ratio = 0.44

            if self.is_pinching:
                if pinch_ratio > release_ratio:
                    self.is_pinching = False
            else:
                if pinch_ratio < grab_ratio:
                    self.is_pinching = True

            # Dynamic Zero-Latency Hand Cursor:
            # Moving fast -> 1:1 instant tracking (no lag)
            # Hovering still -> smooths camera sensor jitter
            target_cursor = ((p4[0] + p8[0]) // 2, (p4[1] + p8[1]) // 2) if self.is_pinching else p8
            if self.hand_cursor is None:
                self.hand_cursor = target_cursor
            else:
                dx = target_cursor[0] - self.hand_cursor[0]
                dy = target_cursor[1] - self.hand_cursor[1]
                spd = math.hypot(dx, dy)
                alpha = min(0.95, max(0.55, spd / 22.0))
                self.hand_cursor = (
                    int(self.hand_cursor[0] + dx * alpha),
                    int(self.hand_cursor[1] + dy * alpha)
                )

            wrist = pts[0]
            def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

            # 1. Fist check: all 4 fingers curled
            curled_index = dist(pts[8], wrist) < dist(pts[6], wrist) * 1.15
            curled_middle = dist(pts[12], wrist) < dist(pts[10], wrist) * 1.15
            curled_ring = dist(pts[16], wrist) < dist(pts[14], wrist) * 1.15
            curled_pinky = dist(pts[20], wrist) < dist(pts[18], wrist) * 1.15

            if curled_index and curled_middle and curled_ring and curled_pinky:
                self.is_fist = True

            # 2. Peace Sign (V): Index & Middle extended, Ring & Pinky curled
            ext_index = dist(pts[8], wrist) > dist(pts[6], wrist) * 1.25
            ext_middle = dist(pts[12], wrist) > dist(pts[10], wrist) * 1.25
            if ext_index and ext_middle and curled_ring and curled_pinky:
                self.is_peace = True

            # 3. Thumbs Up: Thumb pointing upward, other fingers curled
            thumb_up = pts[4][1] < pts[3][1] - 15 and pts[4][1] < pts[2][1] - 25
            if thumb_up and curled_index and curled_middle and curled_ring and curled_pinky:
                self.is_thumbs_up = True

    def compute_framing_box(self):
        if len(self.current_landmarks) < 2:
            if len(self.current_landmarks) == 1:
                pts = self.current_landmarks[0]
                p4, p8 = pts[4], pts[8]
                d = math.hypot(p4[0] - p8[0], p4[1] - p8[1])
                if d > self.vw * 0.2:
                    min_x = min(p4[0], p8[0])
                    max_x = max(p4[0], p8[0])
                    min_y = min(p4[1], p8[1])
                    max_y = max(p4[1], p8[1])
                    return min_x, min_y, max_x - min_x, max_y - min_y
            return None

        # Two hands: bounding rectangle
        all_pts = []
        for pts in self.current_landmarks:
            for idx in (0, 4, 8, 12):
                all_pts.append(pts[idx])

        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        w, h = max_x - min_x, max_y - min_y

        if w < self.vw * 0.18 or h < self.h * 0.18:
            return None

        pad_x = int(w * 0.08)
        pad_y = int(h * 0.08)
        x1 = max(10, min_x - pad_x)
        y1 = max(10, min_y - pad_y)
        x2 = min(self.vw - 10, max_x + pad_x)
        y2 = min(self.h - 10, max_y + pad_y)
        return x1, y1, x2 - x1, y2 - y1

    # ========================================================
    # Shatter & Puzzle Logic
    # ========================================================
    def trigger_capture(self, frame_bgr, box):
        play_sfx("shutter")
        self.flash_opacity = 1.0

        x, y, bw, bh = box
        size = min(bw, bh)
        cx = x + bw // 2
        cy = y + bh // 2
        sq_x = max(0, cx - size // 2)
        sq_y = max(0, cy - size // 2)
        sq_x2 = min(self.vw, sq_x + size)
        sq_y2 = min(self.h, sq_y + size)
        size = min(sq_x2 - sq_x, sq_y2 - sq_y)

        self.board_box = (sq_x, sq_y, size, size)
        self.captured_crop = frame_bgr[sq_y:sq_y + size, sq_x:sq_x + size].copy()

        # Build 6x6 shatter fragments
        self.shatter_fragments = []
        fw = size / SHATTER_COLS
        fh = size / SHATTER_ROWS
        for r in range(SHATTER_ROWS):
            for c in range(SHATTER_COLS):
                fx = int(c * fw)
                fy = int(r * fh)
                slice_img = self.captured_crop[fy:int(fy + fh), fx:int(fx + fw)]
                angle = math.atan2(r - SHATTER_ROWS / 2, c - SHATTER_COLS / 2) + (random.random() - 0.5)
                spd = 250 + random.random() * 450
                self.shatter_fragments.append({
                    "img": slice_img,
                    "x": float(sq_x + fx),
                    "y": float(sq_y + fy),
                    "vx": math.cos(angle) * spd,
                    "vy": math.sin(angle) * spd - 120,
                    "rot": 0.0,
                    "rot_spd": (random.random() - 0.5) * 8,
                    "w": int(fw),
                    "h": int(fh),
                })

        self.state = "shatter"
        self.shatter_start = time.time()
        play_sfx("shatter")
        self.status_msg = "SHATTER!"

    def init_puzzle(self):
        bx, by, bw, bh = self.board_box
        tw = bw // 3
        th = bh // 3
        self.pieces = []
        for r in range(3):
            for c in range(3):
                idx = r * 3 + c
                tile_img = self.captured_crop[r * th:(r + 1) * th, c * tw:(c + 1) * tw].copy()
                self.pieces.append({
                    "orig": idx,
                    "slot": idx,
                    "img": tile_img,
                })

        # Shuffle slots
        slots = list(range(9))
        random.shuffle(slots)
        for i, p in enumerate(self.pieces):
            p["slot"] = slots[i]

        # Ensure not already solved
        if all(p["slot"] == p["orig"] for p in self.pieces):
            self.pieces[0]["slot"], self.pieces[1]["slot"] = self.pieces[1]["slot"], self.pieces[0]["slot"]

        self.solved = False
        self.dragged_piece = None
        self.puzzle_start_time = time.time()
        self.final_solve_time = 0.0
        self.swap_count = 0
        self.particles.clear()
        self.status_msg = "ARMA EL ROMPECABEZAS CON PINCH"

    def get_slot_rect(self, slot_idx):
        bx, by, bw, bh = self.board_box
        tw = bw // 3
        th = bh // 3
        c = slot_idx % 3
        r = slot_idx // 3
        return bx + c * tw, by + r * th, tw, th

    def get_slot_at(self, px, py):
        bx, by, bw, bh = self.board_box
        if not (bx <= px <= bx + bw and by <= py <= by + bh):
            return -1
        tw = bw // 3
        th = bh // 3
        c = (px - bx) // tw
        r = (py - by) // th
        if 0 <= c < 3 and 0 <= r < 3:
            return r * 3 + c
        return -1

    def spawn_sparks(self, cx, cy):
        play_sfx("spark")
        for _ in range(18):
            angle = random.uniform(0, 2 * math.pi)
            spd = random.uniform(70, 220)
            self.particles.append({
                "type": "spark",
                "x": float(cx), "y": float(cy),
                "vx": math.cos(angle) * spd,
                "vy": math.sin(angle) * spd,
                "color": random.choice([(80, 220, 100), (21, 204, 250), (255, 255, 255)]),
                "size": random.randint(2, 4),
                "life": 1.0,
                "decay": random.uniform(1.8, 2.6)
            })

    def spawn_confetti(self):
        bx, by, bw, bh = self.board_box
        for _ in range(85):
            self.particles.append({
                "type": "confetti",
                "x": float(random.randint(max(10, bx - 40), min(self.vw - 10, bx + bw + 40))),
                "y": float(by + random.randint(-20, 100)),
                "vx": random.uniform(-160, 160),
                "vy": random.uniform(-360, -140),
                "w": random.randint(7, 13),
                "h": random.randint(4, 9),
                "color": random.choice([
                    (21, 204, 250),   # gold/yellow
                    (80, 220, 100),   # green
                    (250, 90, 210),   # magenta
                    (250, 190, 20),   # cyan
                    (255, 255, 255)   # white
                ]),
                "rot": random.uniform(0, math.pi),
                "rot_spd": random.uniform(-8, 8),
                "life": 1.0,
                "decay": random.uniform(0.32, 0.55)
            })

    def update_and_draw_particles(self, out, dt):
        alive = []
        for p in self.particles:
            p["life"] -= p["decay"] * dt
            if p["life"] <= 0:
                continue

            p["x"] += p["vx"] * dt
            p["y"] += p["vy"] * dt
            p["vy"] += 380 * dt  # gravity

            x, y = int(p["x"]), int(p["y"])
            if not (0 <= x < self.vw and 0 <= y < self.h):
                continue

            if p["type"] == "spark":
                r = max(1, int(p["size"] * p["life"]))
                cv2.circle(out, (x, y), r, p["color"], -1, cv2.LINE_AA)
            elif p["type"] == "confetti":
                p["rot"] += p["rot_spd"] * dt
                w, h = p["w"], p["h"]
                rect = ((float(x), float(y)), (float(w), float(h)), float(math.degrees(p["rot"])))
                box_pts = cv2.boxPoints(rect).astype(np.int32)
                cv2.drawContours(out, [box_pts], 0, p["color"], -1, cv2.LINE_AA)

            alive.append(p)
        self.particles = alive

    def check_puzzle_solved(self):
        correct = sum(1 for p in self.pieces if p["slot"] == p["orig"])
        if correct == 9 and not self.solved:
            self.solved = True
            self.final_solve_time = time.time() - self.puzzle_start_time
            play_sfx("complete")
            self.spawn_confetti()
            self.status_msg = "¡ROMPECABEZAS COMPLETO! CIERRA EL PUÑO O HAZ 'PEACE' ✌️"
        elif not self.solved:
            self.status_msg = f"{correct} / 9 PIEZAS COLOCADAS"

    # ========================================================
    # Photobooth Filters: Noir, Polaroid 70s, Cyber Neon
    # ========================================================
    def apply_photobooth_filter(self, img_bgr):
        flt = self.filters[self.filter_idx]
        h, w, _ = img_bgr.shape

        if flt == "noir":
            # Noir Film: Grayscale + S-curve + Grain + Vignette
            gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
            gray = ((gray / 255.0 - 0.5) * 1.35 + 0.5) * 255.0
            noise = np.random.normal(0, PHOTOBOOTH_NOISE_STD, gray.shape)
            gray = np.clip(gray + noise, 0, 255).astype(np.uint8)

            X, Y = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
            radius = np.sqrt(X ** 2 + Y ** 2)
            vignette = np.clip(1.15 - 0.45 * radius, 0.4, 1.0)
            gray = np.clip(gray * vignette, 0, 255).astype(np.uint8)
            return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

        elif flt == "polaroid":
            # 70s Vintage Polaroid: Warm fade, amber glow, soft film grain
            img = img_bgr.astype(np.float32)
            # Channel shifts (BGR)
            b = img[:, :, 0] * 0.88 + 15
            g = img[:, :, 1] * 0.98 + 10
            r = img[:, :, 2] * 1.10 + 20
            out_img = cv2.merge([b, g, r])
            noise = np.random.normal(0, 8, img.shape)
            out_img = np.clip(out_img + noise, 0, 255).astype(np.uint8)
            return out_img

        elif flt == "cyber":
            # Cyberpunk / Matrix Neon: High contrast, cyan shadows, magenta highlights
            img = img_bgr.astype(np.float32)
            # Contrast boost
            img = ((img / 255.0 - 0.5) * 1.38 + 0.5) * 255.0
            b = np.clip(img[:, :, 0] * 1.15 + 24, 0, 255)
            g = np.clip(img[:, :, 1] * 0.95 + 10, 0, 255)
            r = np.clip(img[:, :, 2] * 1.20 + 20, 0, 255)
            return cv2.merge([b, g, r]).astype(np.uint8)

        return img_bgr

    def save_solved_photo(self):
        play_sfx("shutter")
        self.flash_opacity = 1.0
        filtered = self.apply_photobooth_filter(self.captured_crop)
        t_str = datetime.now().strftime("%Y.%m.%d")
        sec = int(self.final_solve_time or (time.time() - self.puzzle_start_time))
        score_str = f"{sec}s · {self.swap_count} swaps"
        self.completed_photos.append((t_str, filtered, score_str))

        self.state = "tracking"
        self.pieces.clear()
        self.particles.clear()
        self.solved = False
        self.fist_start = 0

        if len(self.completed_photos) >= MAX_STRIP_PHOTOS:
            self.status_msg = "¡TIRA DE FOTOS COMPLETA!"
            self.save_strip_image()
        else:
            self.status_msg = "FOTO GUARDADA · ENCADRA LA SIGUIENTE"

    def save_strip_image(self):
        if not self.completed_photos:
            return
        os.makedirs("saved_strips", exist_ok=True)
        strip_w = 600
        photo_h = 450
        pad = 36
        header_h = 70
        footer_h = 60
        n = len(self.completed_photos)
        total_h = header_h + n * (photo_h + pad) + footer_h

        strip_img = np.full((total_h, strip_w, 3), 255, dtype=np.uint8)

        # Header branding
        cv2.putText(strip_img, "PUZZLE - CAM", (strip_w // 2 - 110, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (40, 40, 40), 2, cv2.LINE_AA)

        for i, photo_entry in enumerate(self.completed_photos):
            date_str = photo_entry[0]
            p_img = photo_entry[1]
            score_str = photo_entry[2] if len(photo_entry) > 2 else ""

            y_pos = header_h + i * (photo_h + pad)
            resized = cv2.resize(p_img, (strip_w - pad * 2, photo_h))
            strip_img[y_pos:y_pos + photo_h, pad:strip_w - pad] = resized
            cv2.rectangle(strip_img, (pad, y_pos), (strip_w - pad, y_pos + photo_h), (210, 210, 210), 2)
            cv2.putText(strip_img, f"#00{i+1}   {date_str}   {score_str}", (pad + 12, y_pos + photo_h - 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.48, (235, 235, 235), 1, cv2.LINE_AA)

        # Footer
        cv2.putText(strip_img, f"GESTURE PHOTOBOOTH - {datetime.now().strftime('%Y-%m-%d')}",
                    (strip_w // 2 - 165, total_h - 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (120, 120, 120), 1, cv2.LINE_AA)

        filename = os.path.join("saved_strips", f"strip_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")
        cv2.imwrite(filename, strip_img)
        print(f"[SUCCESS] Photobooth strip saved to: {filename}")
        play_sfx("complete")

    # ========================================================
    # Drawing & Rendering
    # ========================================================
    def draw_skeleton(self, canvas):
        for pts in self.current_landmarks:
            # Connections
            for i, j in HAND_CONNECTIONS:
                cv2.line(canvas, pts[i], pts[j], (255, 255, 255), 2, cv2.LINE_AA)
            # Joint landmarks
            for idx, pt in enumerate(pts):
                is_tip = idx in (4, 8, 12, 16, 20)
                color = (21, 204, 250) if is_tip else (255, 255, 255)
                radius = 5 if is_tip else 3
                cv2.circle(canvas, pt, radius, color, -1, cv2.LINE_AA)

    def draw_sidebar(self, out):
        # Dark panel background
        out[:, self.vw:self.w] = (30, 24, 19)
        cv2.line(out, (self.vw, 0), (self.vw, self.h), (60, 48, 38), 1)

        # Header
        cv2.putText(out, "TIRA", (self.vw + 24, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200, 200, 200), 2, cv2.LINE_AA)
        cv2.putText(out, f"{len(self.completed_photos)} / {MAX_STRIP_PHOTOS}", (self.w - 85, 34),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (250, 204, 21), 2, cv2.LINE_AA)

        # Filter Switcher Pill: [FILTRO: NOIR (F)]
        flt_name = self.filters[self.filter_idx].upper()
        cv2.rectangle(out, (self.vw + 20, 44), (self.w - 20, 72), (45, 38, 30), -1)
        cv2.rectangle(out, (self.vw + 20, 44), (self.w - 20, 72), (80, 70, 55), 1)
        cv2.putText(out, f"FILTRO: {flt_name} (F)", (self.vw + 42, 62),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (21, 204, 250), 1, cv2.LINE_AA)

        cv2.line(out, (self.vw, 82), (self.w, 82), (60, 48, 38), 1)

        # Empty state or completed photo cards
        if not self.completed_photos:
            cv2.putText(out, "Tus rompecabezas", (self.vw + 60, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
            cv2.putText(out, "completados", (self.vw + 85, 305), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
            cv2.putText(out, "apareceran aqui.", (self.vw + 75, 330), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
        else:
            thumb_w = self.sw - 40
            thumb_h = 145
            for i, photo_entry in enumerate(self.completed_photos):
                date_str = photo_entry[0]
                p_img = photo_entry[1]
                score_str = photo_entry[2] if len(photo_entry) > 2 else ""

                cy = 92 + i * (thumb_h + 24)
                if cy + thumb_h > self.h - 100:
                    break
                # White photobooth border card
                out[cy - 6:cy + thumb_h + 22, self.vw + 16:self.w - 16] = (255, 255, 255)
                resized = cv2.resize(p_img, (thumb_w, thumb_h))
                out[cy:cy + thumb_h, self.vw + 20:self.w - 20] = resized
                cv2.putText(out, f"#00{i+1}", (self.vw + 24, cy + thumb_h + 16),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (40, 40, 40), 1, cv2.LINE_AA)
                cv2.putText(out, score_str, (self.vw + 72, cy + thumb_h + 16),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.38, (90, 90, 90), 1, cv2.LINE_AA)

        # Buttons at bottom
        # [DESCARGAR]
        can_download = len(self.completed_photos) > 0
        btn_col = (240, 240, 240) if can_download else (70, 70, 70)
        txt_col = (10, 10, 10) if can_download else (140, 140, 140)
        cv2.rectangle(out, (self.vw + 20, self.h - 90), (self.w - 20, self.h - 55), btn_col, -1)
        cv2.putText(out, "DESCARGAR (S)", (self.vw + 68, self.h - 68), cv2.FONT_HERSHEY_SIMPLEX, 0.55, txt_col, 2, cv2.LINE_AA)

        # [REINICIAR]
        cv2.rectangle(out, (self.vw + 20, self.h - 45), (self.w - 20, self.h - 15), (45, 36, 28), -1)
        cv2.rectangle(out, (self.vw + 20, self.h - 45), (self.w - 20, self.h - 15), (70, 60, 50), 1)
        cv2.putText(out, "REINICIAR (R)", (self.vw + 72, self.h - 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA)

    def draw_hud(self, out):
        # Brand pill top left
        cv2.rectangle(out, (20, 15), (280, 48), (25, 20, 15), -1)
        cv2.rectangle(out, (20, 15), (280, 48), (70, 60, 50), 1)
        cv2.putText(out, "PUZZLE - CAM", (34, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (245, 245, 245), 2, cv2.LINE_AA)
        cv2.circle(out, (168, 32), 3, (21, 204, 250), -1)
        cv2.putText(out, "CAPTURE", (182, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (160, 160, 160), 1, cv2.LINE_AA)

        # Timer & Moves indicator (during puzzle)
        if self.state == "puzzle":
            elapsed_sec = int(self.final_solve_time if self.solved else (time.time() - self.puzzle_start_time))
            mins = elapsed_sec // 60
            secs = elapsed_sec % 60
            time_txt = f"{mins:02d}:{secs:02d}"
            cv2.rectangle(out, (292, 15), (460, 48), (25, 20, 15), -1)
            cv2.rectangle(out, (292, 15), (460, 48), (70, 60, 50), 1)
            cv2.putText(out, f"{time_txt} | {self.swap_count} SWAPS", (304, 37),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.44, (250, 204, 21), 1, cv2.LINE_AA)

        # Status badge top center/right
        badge_w = 460
        bx = self.vw - badge_w - 20
        is_done = self.solved or len(self.completed_photos) >= MAX_STRIP_PHOTOS
        bg_col = (20, 60, 25) if is_done else (25, 20, 15)
        border_col = (80, 220, 100) if is_done else (70, 60, 50)
        cv2.rectangle(out, (bx, 15), (bx + badge_w, 48), bg_col, -1)
        cv2.rectangle(out, (bx, 15), (bx + badge_w, 48), border_col, 1)

        dot_col = (80, 220, 100) if is_done else (21, 204, 250)
        cv2.circle(out, (bx + 18, 32), 5, dot_col, -1)
        cv2.putText(out, self.status_msg, (bx + 34, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (240, 240, 240), 1, cv2.LINE_AA)

    # ========================================================
    # Main Loop
    # ========================================================
    def run(self):
        print("========================================================")
        print("Puzzle-Cam Python running! Press ESC or Q to quit.")
        print("Press SPACE to snap photo / save puzzle manually.")
        print("========================================================")

        now_prev = time.time()
        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break

            # Mirror webcam horizontally
            frame = cv2.flip(frame, 1)
            frame = cv2.resize(frame, (self.vw, self.h))

            # Full composite window: [Viewport 960x720 | Sidebar 320x720]
            out = np.zeros((self.h, self.w, 3), dtype=np.uint8)
            out[:, :self.vw] = frame

            now = time.time()
            dt = now - now_prev
            now_prev = now

            # Process Hand Tracking
            self.process_hands(frame)

            # Determine Pointer (Hand pinch or Mouse)
            cursor_pos = self.hand_cursor or (self.mouse_pos if self.mouse_pos[0] < self.vw else None)
            is_active_grab = self.is_pinching or (self.mouse_down and self.mouse_pos[0] < self.vw)

            # State 1: TRACKING (Hand Framing)
            if self.state == "tracking":
                box = self.compute_framing_box()
                if box:
                    self.active_box = box
                    if self.framing_start == 0:
                        self.framing_start = now
                    elapsed = now - self.framing_start
                    prog = min(1.0, elapsed / self.hold_duration)

                    x, y, bw, bh = box
                    # Draw yellow framing box with corner brackets
                    cv2.rectangle(out, (x, y), (x + bw, y + bh), (21, 204, 250), 2)
                    c_len = int(min(bw, bh) * 0.15)
                    cv2.line(out, (x, y), (x + c_len, y), (21, 204, 250), 4)
                    cv2.line(out, (x, y), (x, y + c_len), (21, 204, 250), 4)
                    cv2.line(out, (x + bw, y), (x + bw - c_len, y), (21, 204, 250), 4)
                    cv2.line(out, (x + bw, y), (x + bw, y + c_len), (21, 204, 250), 4)
                    cv2.line(out, (x, y + bh), (x + c_len, y + bh), (21, 204, 250), 4)
                    cv2.line(out, (x, y + bh), (x, y + bh - c_len), (21, 204, 250), 4)
                    cv2.line(out, (x + bw, y + bh), (x + bw - c_len, y + bh), (21, 204, 250), 4)
                    cv2.line(out, (x + bw, y + bh), (x + bw, y + bh - c_len), (21, 204, 250), 4)

                    # Progress circle
                    cx, cy = x + bw // 2, y + bh // 2
                    cv2.circle(out, (cx, cy), 28, (80, 80, 80), 3)
                    cv2.ellipse(out, (cx, cy), (28, 28), -90, 0, int(prog * 360), (21, 204, 250), 3)

                    # Countdown audio beeps
                    step = int(prog * 3)
                    if step > self.countdown_step:
                        self.countdown_step = step
                        play_sfx("beep")

                    self.status_msg = f"ENCADRANDO... ({int(prog * 100)}%)"

                    if prog >= 1.0:
                        self.trigger_capture(frame, box)
                        self.framing_start = 0
                        self.countdown_step = 0
                else:
                    self.framing_start = 0
                    self.countdown_step = 0
                    if self.current_landmarks:
                        self.status_msg = "FORMA UN MARCO CON TUS MANOS"
                    else:
                        self.status_msg = "MANOS EN SEGUIMIENTO"

            # State 2: SHATTER
            elif self.state == "shatter":
                elapsed = now - self.shatter_start
                prog = min(1.0, elapsed / SHATTER_DURATION_S)

                for frag in self.shatter_fragments:
                    frag["x"] += frag["vx"] * dt
                    frag["y"] += frag["vy"] * dt
                    frag["vy"] += 380 * dt  # gravity
                    frag["rot"] += frag["rot_spd"] * dt

                    # Render fragment
                    fx, fy = int(frag["x"]), int(frag["y"])
                    fw, fh = frag["w"], frag["h"]
                    if 0 <= fx < self.vw - fw and 0 <= fy < self.h - fh:
                        out[fy:fy + fh, fx:fx + fw] = frag["img"]

                if elapsed >= SHATTER_DURATION_S:
                    self.init_puzzle()
                    self.state = "puzzle"

            # State 3: PUZZLE
            elif self.state == "puzzle":
                bx, by, bw, bh = self.board_box
                tw, th = bw // 3, bh // 3

                # Handle Stable Pinch Drag & Drop
                hover_slot = self.get_slot_at(cursor_pos[0], cursor_pos[1]) if cursor_pos else -1

                if cursor_pos and not self.solved:
                    cx, cy = cursor_pos

                    # 1. Start Dragging (Fingers physically touch together)
                    if is_active_grab and not self.prev_active_grab:
                        if hover_slot != -1:
                            piece = next((p for p in self.pieces if p["slot"] == hover_slot), None)
                            if piece:
                                self.dragged_piece = piece
                                sx, sy, _, _ = self.get_slot_rect(hover_slot)
                                self.drag_offset = (cx - sx, cy - sy)
                                play_sfx("snap")

                    # 2. Release & Drop (Fingers open / stop touching)
                    elif not is_active_grab and self.prev_active_grab:
                        if self.dragged_piece:
                            drop_slot = self.get_slot_at(cx, cy)
                            if drop_slot != -1 and drop_slot != self.dragged_piece["slot"]:
                                target = next((p for p in self.pieces if p["slot"] == drop_slot), None)
                                if target:
                                    target["slot"] = self.dragged_piece["slot"]
                                self.dragged_piece["slot"] = drop_slot
                                self.swap_count += 1
                                play_sfx("snap")

                                # Sparkle particles if placed in correct position!
                                if self.dragged_piece["slot"] == self.dragged_piece["orig"]:
                                    sx, sy, _, _ = self.get_slot_rect(drop_slot)
                                    self.spawn_sparks(sx + tw // 2, sy + th // 2)

                                self.check_puzzle_solved()
                            self.dragged_piece = None

                self.prev_active_grab = is_active_grab

                # Render Puzzle Board
                border_col = (80, 220, 100) if self.solved else (21, 204, 250)
                thick = 4 if self.solved else 2
                cv2.rectangle(out, (bx, by), (bx + bw, by + bh), border_col, thick)

                # Render Grid Tiles
                for slot in range(9):
                    sx, sy, _, _ = self.get_slot_rect(slot)
                    cv2.rectangle(out, (sx, sy), (sx + tw, sy + th), (60, 60, 60), 1)

                    piece = next((p for p in self.pieces if p["slot"] == slot), None)
                    if piece:
                        if piece == self.dragged_piece:
                            # Dimmed placeholder in original slot while dragging
                            placeholder = (piece["img"] * 0.35).astype(np.uint8)
                            out[sy:sy + th, sx:sx + tw] = placeholder
                            cv2.rectangle(out, (sx, sy), (sx + tw, sy + th), (40, 150, 180), 1, cv2.LINE_AA)
                        else:
                            out[sy:sy + th, sx:sx + tw] = piece["img"]
                            is_correct = piece["slot"] == piece["orig"]
                            c_col = (80, 220, 100) if is_correct else (40, 40, 40)
                            cv2.rectangle(out, (sx, sy), (sx + tw, sy + th), c_col, 1)

                    # Highlight target slot when hovering
                    if slot == hover_slot and not self.solved:
                        h_col = (80, 220, 100) if self.dragged_piece else (255, 255, 255)
                        cv2.rectangle(out, (sx, sy), (sx + tw, sy + th), h_col, 2)

                # Render Dragged Tile floating under hand
                if self.dragged_piece and cursor_pos:
                    cx, cy = cursor_pos
                    dx = cx - self.drag_offset[0]
                    dy = cy - self.drag_offset[1]
                    dx = max(0, min(self.vw - tw, dx))
                    dy = max(0, min(self.h - th, dy))

                    # Drop shadow behind dragged tile
                    shadow_y2 = min(self.h, dy + th + 6)
                    shadow_x2 = min(self.vw, dx + tw + 6)
                    if dy + 6 < shadow_y2 and dx + 6 < shadow_x2:
                        out[dy + 6:shadow_y2, dx + 6:shadow_x2] = (out[dy + 6:shadow_y2, dx + 6:shadow_x2] * 0.45).astype(np.uint8)

                    out[dy:dy + th, dx:dx + tw] = self.dragged_piece["img"]
                    cv2.rectangle(out, (dx, dy), (dx + tw, dy + th), (21, 204, 250), 3)

                # If solved: Fist / Peace / Thumbs Up detection to save
                if self.solved:
                    # Solved banner pill
                    bw_w = 480
                    cv2.rectangle(out, (bx + (bw - bw_w) // 2, by + bh + 14),
                                  (bx + (bw + bw_w) // 2, by + bh + 54), (10, 30, 15), -1)
                    cv2.rectangle(out, (bx + (bw - bw_w) // 2, by + bh + 14),
                                  (bx + (bw + bw_w) // 2, by + bh + 54), (80, 220, 100), 2)
                    cv2.putText(out, "COMPLETO! - CIERRA EL PUNO O HAZ 'PEACE' ✌",
                                (bx + (bw - bw_w) // 2 + 16, by + bh + 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.48, (100, 255, 120), 2, cv2.LINE_AA)

                    is_save_gesture = self.is_fist or self.is_peace or self.is_thumbs_up
                    if is_save_gesture:
                        if self.fist_start == 0:
                            self.fist_start = now
                        fist_elapsed = now - self.fist_start
                        prog = min(1.0, fist_elapsed / self.fist_hold)
                        self.status_msg = f"GUARDANDO FOTO... ({int(prog * 100)}%)"
                        if prog >= 1.0:
                            self.save_solved_photo()
                    else:
                        self.fist_start = 0

            # Update & Draw Floating Particles (Sparks & Confetti)
            self.update_and_draw_particles(out, dt)

            # Draw Hand Skeleton
            self.draw_skeleton(out)

            # Shutter Flash
            if self.flash_opacity > 0.05:
                overlay = out[:, :self.vw].copy()
                white = np.full_like(overlay, 255)
                out[:, :self.vw] = cv2.addWeighted(white, self.flash_opacity, overlay, 1.0 - self.flash_opacity, 0)
                self.flash_opacity *= 0.82

            # Draw Cursor
            if cursor_pos:
                cx, cy = cursor_pos
                c_col = (80, 220, 100) if is_active_grab else (255, 255, 255)
                r = 12 if is_active_grab else 8
                cv2.circle(out, (cx, cy), r, c_col, 2, cv2.LINE_AA)
                cv2.circle(out, (cx, cy), 3, c_col, -1, cv2.LINE_AA)

            # Draw Sidebar & HUD
            self.draw_sidebar(out)
            self.draw_hud(out)

            # Display Window
            cv2.imshow("Puzzle-Cam - Gesture Capture", out)

            # Key Controls
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord('q'), ord('Q')):
                break
            elif key == ord(' '):  # SPACE: force snap / force save
                if self.state == "tracking":
                    default_box = (int(self.vw * 0.25), int(self.h * 0.15), int(self.vw * 0.5), int(self.h * 0.7))
                    self.trigger_capture(frame, self.active_box or default_box)
                elif self.state == "puzzle" and self.solved:
                    self.save_solved_photo()
            elif key in (ord('r'), ord('R')):
                self.reset_all()
            elif key in (ord('s'), ord('S')):
                self.save_strip_image()
            elif key in (ord('f'), ord('F')):
                self.cycle_filter()

        self.cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    app = PuzzleCam()
    app.run()
