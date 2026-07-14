import json
import math
import random
import string
import time
from collections import Counter
import numpy as np
from flask import current_app
from sklearn.ensemble import RandomForestClassifier, IsolationForest

# ==========================================
# 1. AI PASSWORD STRENGTH ANALYZER
# ==========================================

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
        # Generates ~600 synthetic password examples for classification training
        X = []
        y = []
        
        # 1. Weak Passwords (Label: 0)
        # Short, simple, lowercase-only or digits-only
        for _ in range(200):
            pw_len = random.randint(1, 7)
            charset = random.choice([string.ascii_lowercase, string.digits])
            pw = "".join(random.choices(charset, k=pw_len))
            X.append(self._extract_features(pw))
            y.append(0)

        # 2. Medium Passwords (Label: 1)
        # Moderate length, mix of lower/digits, no specials
        for _ in range(200):
            pw_len = random.randint(8, 12)
            charset = string.ascii_lowercase + string.digits + string.ascii_uppercase
            pw = "".join(random.choices(charset, k=pw_len))
            X.append(self._extract_features(pw))
            y.append(1)

        # 3. Strong Passwords (Label: 2)
        # Long, diverse character sets, high complexity
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
        # y contains: 0=Weak, 1=Medium, 2=Strong
        score = int((prob[1] * 50) + (prob[2] * 100))
        
        if score < 40:
            strength = "Weak"
        elif score < 80:
            strength = "Medium"
        else:
            strength = "Strong"

        # Generate suggestions
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
            "score": max(5, min(100, score)), # keep score between 5% and 100%
            "suggestions": suggestions
        }

# ==========================================
# 2. AI BEHAVIORAL ANOMALY DETECTOR
# ==========================================

class AnomalyDetector:
    def __init__(self):
        self.model = IsolationForest(contamination=0.1, random_state=42)
        self.is_trained = False

    def _generate_normal_login_data(self) -> np.ndarray:
        # Generates synthetic data representing "normal" login profiles:
        # Features: [hour_of_day, typing_duration_sec, face_success_score (0 or 1)]
        # Normal profile: Hour is between 8 AM and 9 PM (8-21), typing duration is between 1-5 sec, face score is 1 (success)
        np.random.seed(42)
        hours = np.random.uniform(9, 18, 150)  # Standard business hours
        durations = np.random.normal(2.5, 0.7, 150)  # Quick typing durations
        face_scores = np.ones(150)  # Face verification is successful (1.0)
        
        # Add a few off-hours logins that are still normal
        hours = np.append(hours, np.random.uniform(19, 22, 50))
        durations = np.append(durations, np.random.normal(3.5, 1.0, 50))
        face_scores = np.append(face_scores, np.ones(50))

        # Clamp durations to be positive
        durations = np.clip(durations, 0.5, 10.0)

        return np.column_stack((hours, durations, face_scores))

    def train(self):
        """Fits the Isolation Forest on normal login heuristics."""
        X = self._generate_normal_login_data()
        self.model.fit(X)
        self.is_trained = True

    def check_anomaly(self, hour: float, duration: float, face_success: bool) -> tuple[bool, str]:
        """
        Predicts if a login attempt is an anomaly.
        Returns (is_anomaly, reason).
        """
        if not self.is_trained:
            self.train()

        face_val = 1.0 if face_success else 0.0
        X_test = np.array([[hour, duration, face_val]])
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
        "event_type": event_type, # e.g. LOCK, UNLOCK_SUCCESS, UNLOCK_FAILED, REGISTRATION
        "details": details,
        "anomaly": "YES" if anomaly_flag else "NO",
        "photo": photo_filename or ""
    }
    
    # Store as JSON lines for easy dashboard parsing
    with open(log_path, "a") as f:
        f.write(json.dumps(log_entry) + "\n")
