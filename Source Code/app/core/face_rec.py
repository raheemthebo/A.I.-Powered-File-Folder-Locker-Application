import os
import cv2
import numpy as np
import time
from flask import current_app
from sklearn.decomposition import PCA

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
            # Need a reasonable number of frames to train PCA
            return False

        X = np.array(images)
        n_comp = min(12, len(images))
        
        self.pca = PCA(n_components=n_comp, random_state=42)
        X_pca = self.pca.fit_transform(X)
        self.pca_mean = np.mean(X_pca, axis=0)

        # Establish threshold based on maximum distance in the training set
        dists = [np.linalg.norm(x - self.pca_mean) for x in X_pca]
        mean_dist = np.mean(dists)
        std_dist = np.std(dists)
        
        # Threshold: mean distance + 3 * standard deviation with a sensible minimum
        self.threshold = max(900.0, mean_dist + 3.0 * std_dist)

        # Save to disk
        model_path = os.path.join(face_dir, "pca_model.npz")
        np.savez(model_path,
                 components=self.pca.components_,
                 mean=self.pca.mean_,
                 pca_mean=self.pca_mean,
                 threshold=self.threshold)
        
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
            # Yield empty frame or camera error placeholder
            yield b""
            return

        # Make sure our face recognizer model is loaded for verification
        if self.mode == "verify" and not self.model_loaded:
            self.load_model()

        while self.camera is not None and self.camera.isOpened():
            success, frame = self.camera.read()
            if not success:
                break

            # Mirror the frame for standard webcam usage
            frame = cv2.flip(frame, 1)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.3, minNeighbors=5)

            # Overlay overlay scanner lines
            h_frame, w_frame, _ = frame.shape
            scan_y = int((time.time() * 150) % h_frame)
            cv2.line(frame, (0, scan_y), (w_frame, scan_y), (0, 255, 255), 1)

            for (x, y, w, h) in faces:
                # Bounding box coordinates
                cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 255, 0), 2)
                
                # Preprocess detected face image
                face_img = gray[y:y+h, x:x+w]
                face_resized = cv2.resize(face_img, (64, 64))

                if self.mode == "register":
                    # Capture face frame
                    self.register_count += 1
                    face_path = os.path.join(current_app.config['FACE_DATA_DIR'], f"user_{self.register_count}.jpg")
                    cv2.imwrite(face_path, face_resized)
                    
                    # Highlight captured frame
                    cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 3)
                    cv2.putText(frame, f"Capturing: {self.register_count}/30", (x, y - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                    if self.register_count >= 30:
                        # Completed registration!
                        self.stop_camera()
                        self.train_model()
                        self.mode = "idle"
                        self.verification_finished = True
                        break

                elif self.mode == "verify":
                    self.verification_frames_checked += 1
                    
                    if self.model_loaded and self.pca is not None:
                        # Flatten and project to PCA space
                        face_vector = face_resized.flatten()
                        try:
                            projected = self.pca.transform([face_vector])[0]
                            distance = np.linalg.norm(projected - self.pca_mean)
                            
                            # Verify matches
                            if distance <= self.threshold:
                                self.verification_success_count += 1
                                match_pct = int(max(0, 100 - (distance / self.threshold * 50)))
                                label_text = f"Authorized User ({match_pct}%)"
                                color = (0, 255, 0) # Green
                            else:
                                label_text = "Analyzing..."
                                color = (0, 165, 255) # Orange
                        except Exception:
                            label_text = "Error verifying"
                            color = (0, 0, 255)
                    else:
                        label_text = "No biometric profile loaded"
                        color = (0, 0, 255)

                    cv2.rectangle(frame, (x, y), (x+w, y+h), color, 3)
                    cv2.putText(frame, label_text, (x, y - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

                    # Biometric verification evaluation
                    if self.verification_success_count >= 12:
                        self.verification_success = True
                        self.verification_finished = True
                        self.stop_camera()
                        break
                    
                    if self.verification_frames_checked >= 40:
                        # Too many failed frames: access denied
                        self.verification_success = False
                        self.verification_finished = True
                        
                        # Take picture of intruder!
                        if not self.intruder_captured:
                            photo_name = f"intruder_{int(time.time())}.jpg"
                            photo_path = os.path.join(current_app.config['INTRUDERS_DIR'], photo_name)
                            cv2.imwrite(photo_path, frame)
                            self.intruder_captured = photo_name # stores path suffix

                        self.stop_camera()
                        break

            # Encode frame to JPEG
            ret, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

        # Cleanup if camera is active when loop breaks
        self.stop_camera()

# Singleton camera manager
camera_manager = FaceRecognitionManager()
