import os
import time
from flask import current_app

try:
    import cv2
    import numpy as np
    from sklearn.decomposition import PCA
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False

# ==========================================
# BIOMETRICS CAMERA ENGINE
# ==========================================

if OPENCV_AVAILABLE:
    class FaceRecognitionManager:
        def __init__(self):
            self.camera = None
            self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            self.pca = None
            self.pca_mean = None
            self.threshold = 0.0
            self.model_loaded = False
            
            # State variables for active video actions
            self.mode = "idle"  # "idle", "register", "verify"
            self.register_count = 0
            self.verification_frames_checked = 0
            self.verification_success_count = 0
            self.verification_finished = False
            self.verification_success = False
            self.intruder_captured = False
            self.camera_error = False

        def load_model(self):
            """Loads the pre-trained PCA face recognition model from disk."""
            face_dir = current_app.config['FACE_DATA_DIR']
            model_path = os.path.join(face_dir, "pca_model.npz")
            if os.path.exists(model_path):
                try:
                    data = np.load(model_path)
                    self.pca = PCA()
                    self.pca.components_ = data['components']
                    self.pca.mean_ = data['mean']
                    self.pca_mean = data['pca_mean']
                    self.threshold = float(data['threshold'])
                    self.model_loaded = True
                    return True
                except Exception:
                    self.model_loaded = False
                    return False
            self.model_loaded = False
            return False

        def train_model(self) -> bool:
            """Trains the PCA model on the registered face photos."""
            face_dir = current_app.config['FACE_DATA_DIR']
            images = []
            for filename in os.listdir(face_dir):
                if filename.endswith(".jpg") and filename.startswith("user_"):
                    img_path = os.path.join(face_dir, filename)
                    img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
                    if img is not None:
                        images.append(img.flatten())

            if len(images) < 15:
                return False

            X = np.array(images)
            n_comp = min(12, len(images))
            
            self.pca = PCA(n_components=n_comp, random_state=42)
            X_pca = self.pca.fit_transform(X)
            self.pca_mean = np.mean(X_pca, axis=0)

            dists = [np.linalg.norm(x - self.pca_mean) for x in X_pca]
            mean_dist = np.mean(dists)
            std_dist = np.std(dists)
            
            self.threshold = max(900.0, mean_dist + 3.0 * std_dist)

            model_path = os.path.join(face_dir, "pca_model.npz")
            try:
                np.savez(model_path,
                         components=self.pca.components_,
                         mean=self.pca.mean_,
                         pca_mean=self.pca_mean,
                         threshold=self.threshold)
            except Exception:
                pass
            
            self.model_loaded = True
            return True

        def start_camera(self) -> bool:
            """Initializes the camera connection."""
            if self.camera is None or not self.camera.isOpened():
                # Try camera index 0 (default webcam)
                self.camera = cv2.VideoCapture(0)
                if not self.camera.isOpened():
                    self.camera = None
                    self.camera_error = True
                    return False
            self.camera_error = False
            return True

        def stop_camera(self):
            """Releases the camera connection."""
            if self.camera is not None:
                self.camera.release()
                self.camera = None

        def reset_state(self, mode="idle"):
            """Resets the face detection states for registration or verification runs."""
            self.mode = mode
            self.register_count = 0
            self.verification_frames_checked = 0
            self.verification_success_count = 0
            self.verification_finished = False
            self.verification_success = False
            self.intruder_captured = False
            self.camera_error = False

        def generate_frames(self):
            """Generates video streaming frames annotated depending on mode."""
            success = self.start_camera()
            if not success or self.camera is None:
                self.camera_error = True
                self.verification_finished = True
                yield b""
                return

            if self.mode == "verify" and not self.model_loaded:
                self.load_model()

            while self.camera is not None and self.camera.isOpened():
                success, frame = self.camera.read()
                if not success:
                    break

                frame = cv2.flip(frame, 1)
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.3, minNeighbors=5)

                h_frame, w_frame, _ = frame.shape
                scan_y = int((time.time() * 150) % h_frame)
                cv2.line(frame, (0, scan_y), (w_frame, scan_y), (0, 255, 255), 1)

                for (x, y, w, h) in faces:
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 255, 0), 2)
                    
                    face_img = gray[y:y+h, x:x+w]
                    face_resized = cv2.resize(face_img, (64, 64))

                    if self.mode == "register":
                        self.register_count += 1
                        face_dir = current_app.config['FACE_DATA_DIR']
                        face_path = os.path.join(face_dir, f"user_{self.register_count}.jpg")
                        try:
                            cv2.imwrite(face_path, face_resized)
                        except Exception:
                            pass
                        
                        cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 3)
                        cv2.putText(frame, f"Capturing: {self.register_count}/30", (x, y - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                        if self.register_count >= 30:
                            self.stop_camera()
                            self.train_model()
                            self.mode = "idle"
                            self.verification_finished = True
                            break

                    elif self.mode == "verify":
                        self.verification_frames_checked += 1
                        
                        if self.model_loaded and self.pca is not None:
                            face_vector = face_resized.flatten()
                            try:
                                projected = self.pca.transform([face_vector])[0]
                                distance = np.linalg.norm(projected - self.pca_mean)
                                
                                if distance <= self.threshold:
                                    self.verification_success_count += 1
                                    match_pct = int(max(0, 100 - (distance / self.threshold * 50)))
                                    cv2.putText(frame, f"MATCH: {match_pct}%", (x, y - 10),
                                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                                else:
                                    cv2.putText(frame, "UNKNOWN", (x, y - 10),
                                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                            except Exception:
                                pass

                        if self.verification_frames_checked >= 40:
                            self.stop_camera()
                            self.mode = "idle"
                            self.verification_finished = True
                            self.verification_success = (self.verification_success_count >= 12)
                            
                            if not self.verification_success:
                                intruder_path = os.path.join(current_app.config['INTRUDERS_DIR'], f"intruder_{int(time.time())}.jpg")
                                try:
                                    cv2.imwrite(intruder_path, frame)
                                    self.intruder_captured = os.path.basename(intruder_path)
                                except Exception:
                                    pass
                            break

                ret, jpeg = cv2.imencode('.jpg', frame)
                if not ret:
                    break
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n\r\n')

            self.stop_camera()
else:
    # Heuristics mock classifier for serverless environments (Vercel)
    class FaceRecognitionManager:
        def __init__(self):
            self.camera = None
            self.mode = "idle"
            self.register_count = 0
            self.verification_frames_checked = 0
            self.verification_success_count = 0
            self.verification_finished = False
            self.verification_success = False
            self.intruder_captured = False
            self.camera_error = True
            self.model_loaded = False

        def load_model(self):
            return False
        def train_model(self) -> bool:
            return False
        def start_camera(self) -> bool:
            self.camera_error = True
            return False
        def stop_camera(self):
            pass
        def reset_state(self, mode="idle"):
            self.mode = mode
            self.camera_error = True
            self.verification_finished = True
        def generate_frames(self):
            self.camera_error = True
            self.verification_finished = True
            yield b""

# Singleton biometrics controller
camera_manager = FaceRecognitionManager()
