import json
import math
import random
import string
import time
from collections import Counter
from flask import current_app

# Try importing scikit-learn and numpy, fallback to mock helper classes if not available (e.g. serverless Vercel)
try:
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier, IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    class MockNumpy:
        def array(self, obj, **kwargs):
            return obj
        def column_stack(self, tup):
            return list(zip(*tup))
        def clip(self, a, a_min, a_max):
            return [max(a_min, min(a_max, x)) for x in a]
        def mean(self, a, axis=None):
            if len(a) == 0: return 0.0
            return sum(a) / len(a)
    np = MockNumpy()

# ==========================================
# 1. AI PASSWORD STRENGTH ANALYZER
# ==========================================

if SKLEARN_AVAILABLE:
    class PasswordStrengthClassifier:
        def __init__(self):
            self.model = RandomForestClassifier(n_estimators=50, random_state=42)
            self.is_trained = False
            
        def _calculate_entropy(self, s: str) -> float:
            if not s:
                return 0.0
            entropy = 0
            len_s = len(s)
            counts = Counter(s)
            for count in counts.values():
                p = count / len_s
                entropy -= p * math.log2(p)
            return entropy

        def _extract_features(self, password: str) -> list:
            length = len(password)
            upper_count = sum(1 for c in password if c.isupper())
            lower_count = sum(1 for c in password if c.islower())
            digit_count = sum(1 for c in password if c.isdigit())
            special_count = sum(1 for c in password if c in string.punctuation)
            unique_ratio = len(set(password)) / length if length > 0 else 0.0
            entropy = self._calculate_entropy(password)
            
            return [length, upper_count, lower_count, digit_count, special_count, unique_ratio, entropy]

        def _generate_dataset(self) -> tuple[np.ndarray, np.ndarray]:
            X = []
            y = []
            
            # 1. Weak Passwords (Label: 0)
            for _ in range(200):
                pw_len = random.randint(1, 7)
                charset = random.choice([string.ascii_lowercase, string.digits])
                pw = "".join(random.choices(charset, k=pw_len))
                X.append(self._extract_features(pw))
                y.append(0)

            # 2. Medium Passwords (Label: 1)
            for _ in range(200):
                pw_len = random.randint(8, 12)
                charset = string.ascii_lowercase + string.digits + string.ascii_uppercase
                pw = "".join(random.choices(charset, k=pw_len))
                X.append(self._extract_features(pw))
                y.append(1)

            # 3. Strong Passwords (Label: 2)
            special_chars = "!@#$%^&*()_+-=[]{}|;:,.<>?"
            for _ in range(200):
                pw_len = random.randint(10, 18)
                pw = [
                    random.choice(string.ascii_lowercase),
                    random.choice(string.ascii_uppercase),
                    random.choice(string.digits),
                    random.choice(special_chars)
                ]
                charset = string.ascii_lowercase + string.ascii_uppercase + string.digits + special_chars
                pw += random.choices(charset, k=pw_len - 4)
                random.shuffle(pw)
                pw_str = "".join(pw)
                X.append(self._extract_features(pw_str))
                y.append(2)

            return np.array(X), np.array(y)

        def train(self):
            """Generates training data and fits the Random Forest model."""
            X, y = self._generate_dataset()
            self.model.fit(X, y)
            self.is_trained = True

        def analyze(self, password: str) -> dict:
            """Evaluates password strength and returns suggestions."""
            if not self.is_trained:
                self.train()

            if not password:
                return {
                    "strength": "Weak",
                    "score": 0,
                    "suggestions": ["Password cannot be empty."]
                }

            features = np.array([self._extract_features(password)])
            prob = self.model.predict_proba(features)[0]
            
            # Calculate dynamic percentage score based on probabilities
            score = int((prob[1] * 50) + (prob[2] * 100))
            
            if score < 40:
                strength = "Weak"
            elif score < 80:
                strength = "Medium"
            else:
                strength = "Strong"

            suggestions = []
            if len(password) < 8:
                suggestions.append("Increase length to at least 8 characters.")
            if not any(c.isupper() for c in password):
                suggestions.append("Add uppercase letters (A-Z).")
            if not any(c.islower() for c in password):
                suggestions.append("Add lowercase letters (a-z).")
            if not any(c.isdigit() for c in password):
                suggestions.append("Add numeric digits (0-9).")
            if not any(c in string.punctuation for c in password):
                suggestions.append("Include special characters (e.g., !, @, #, $, %).")
            if len(set(password)) < len(password) / 2:
                suggestions.append("Use a wider variety of unique characters.")

            return {
                "strength": strength,
                "score": max(5, min(100, score)),
                "suggestions": suggestions
            }
else:
    # Pure-Python heuristics analyzer when scikit-learn is not installed/loaded (serverless fallbacks)
    class PasswordStrengthClassifier:
        def __init__(self):
            self.is_trained = True
        def train(self):
            pass
        def analyze(self, password: str) -> dict:
            if not password:
                return {"strength": "Weak", "score": 0, "suggestions": ["Password cannot be empty."]}
            
            suggestions = []
            score = 0
            
            if len(password) >= 8: score += 20
            else: suggestions.append("Increase length to at least 8 characters.")
            
            if any(c.isupper() for c in password): score += 20
            else: suggestions.append("Add uppercase letters (A-Z).")
            
            if any(c.islower() for c in password): score += 20
            else: suggestions.append("Add lowercase letters (a-z).")
            
            if any(c.isdigit() for c in password): score += 20
            else: suggestions.append("Add numeric digits (0-9).")
            
            if any(c in string.punctuation for c in password): score += 20
            else: suggestions.append("Include special characters (e.g., !, @, #, $, %).")
            
            if len(password) >= 12 and score >= 80: score = 100
            
            if score < 40: strength = "Weak"
            elif score < 80: strength = "Medium"
            else: strength = "Strong"
            
            return {
                "strength": strength,
                "score": max(5, min(100, score)),
                "suggestions": suggestions
            }

# ==========================================
# 2. AI BEHAVIORAL ANOMALY DETECTOR
# ==========================================

if SKLEARN_AVAILABLE:
    class AnomalyDetector:
        def __init__(self):
            self.model = IsolationForest(contamination=0.1, random_state=42)
            self.is_trained = False

        def _generate_normal_login_data(self) -> np.ndarray:
            np_real = __import__('numpy')
            hours = np_real.random.uniform(9, 18, 150)  # Standard business hours
            durations = np_real.random.normal(2.5, 0.7, 150)  # Quick typing durations
            face_scores = np_real.ones(150)  # Face verification is successful
            
            hours = np_real.append(hours, np_real.random.uniform(19, 22, 50))
            durations = np_real.append(durations, np_real.random.normal(3.5, 1.0, 50))
            face_scores = np_real.append(face_scores, np_real.ones(50))
            durations = np_real.clip(durations, 0.5, 10.0)

            return np_real.column_stack((hours, durations, face_scores))

        def train(self):
            """Fits the Isolation Forest on normal login heuristics."""
            X = self._generate_normal_login_data()
            self.model.fit(X)
            self.is_trained = True

        def check_anomaly(self, hour: float, duration: float, face_success: bool) -> tuple[bool, str]:
            if not self.is_trained:
                self.train()

            face_val = 1.0 if face_success else 0.0
            X_test = [[hour, duration, face_val]]
            prediction = self.model.predict(X_test)[0]

            is_anomaly = (prediction == -1)
            reasons = []

            if is_anomaly:
                if hour < 7 or hour > 22:
                    reasons.append("Unusual access hour (nighttime/off-hours).")
                if duration > 7.0:
                    reasons.append(f"Extended authentication duration ({duration:.1f}s).")
                if not face_success:
                    reasons.append("Failed facial biometric alignment.")
                
                reason_str = " | ".join(reasons) if reasons else "Atypical login heuristics profile."
                return True, reason_str

            return False, "Normal pattern."
else:
    # Pure-Python heuristics fallback when scikit-learn/numpy are not installed (serverless Vercel)
    class AnomalyDetector:
        def __init__(self):
            self.is_trained = True
        def train(self):
            pass
        def check_anomaly(self, hour: float, duration: float, face_success: bool) -> tuple[bool, str]:
            reasons = []
            is_anomaly = False
            
            if hour < 7 or hour > 22:
                reasons.append("Unusual access hour (nighttime/off-hours).")
                is_anomaly = True
            if duration > 7.0:
                reasons.append(f"Extended authentication duration ({duration:.1f}s).")
                is_anomaly = True
            if not face_success:
                reasons.append("Failed facial biometric alignment.")
                is_anomaly = True
                
            if is_anomaly:
                reason_str = " | ".join(reasons)
                return True, reason_str
            return False, "Normal pattern."

# Initialize singletons for startup use
password_analyzer = PasswordStrengthClassifier()
anomaly_detector = AnomalyDetector()

# Train models initially
password_analyzer.train()
anomaly_detector.train()

# ==========================================
# 3. SECURITY ACTIVITY LOGGING
# ==========================================

def log_security_event(event_type: str, details: str, anomaly_flag: bool = False, photo_filename: str = None):
    """Appends security logs with timestamps, status, anomaly alerts, and photo attachments."""
    log_path = current_app.config['LOG_PATH']
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    
    log_entry = {
        "timestamp": timestamp,
        "event_type": event_type,
        "details": details,
        "anomaly": "YES" if anomaly_flag else "NO",
        "photo": photo_filename or ""
    }
    
    try:
        with open(log_path, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
    except Exception:
        # Fail silently in write-locked serverless filesystems
        pass
