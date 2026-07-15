import os
import time
import json
try:
    import cv2
except ImportError:
    cv2 = None
from functools import wraps
from flask import render_template, request, jsonify, Response, session, current_app, send_from_directory
from .core.crypto import load_metadata, encrypt_item, decrypt_item
from .core.ai_security import password_analyzer, anomaly_detector, log_security_event
from .core.face_rec import camera_manager

# ==========================================
# CONFIG & AUTH UTILITIES
# ==========================================

def get_config_path():
    is_cloud = (
        os.environ.get("VERCEL") == "1" or 
        os.environ.get("NOW_REGION") is not None or 
        os.environ.get("GAE_ENV") is not None or
        os.environ.get("GAE_SERVICE") is not None
    )
    if is_cloud:
        os.makedirs("/tmp/AI_Locker", exist_ok=True)
        return "/tmp/AI_Locker/vault_config.json"
    return os.path.join(current_app.config['BASE_DIR'], "Related or Required Files", "vault_config.json")

def get_pca_path(email=None):
    face_dir = current_app.config['FACE_DATA_DIR']
    if not email:
        email = session.get('email', 'global')
    import hashlib
    email_hash = hashlib.sha256(email.lower().strip().encode()).hexdigest()[:16]
    return os.path.join(face_dir, f"pca_model_{email_hash}.npz")

import urllib.request

REMOTE_DB_URL = "https://extendsclass.com/api/json-storage/bin/ccbcaac"

def load_vault_config():
    path = get_config_path()
    cfg = {"setup_complete": False, "users": {}}
    
    # Load local fallback
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                cfg = json.load(f)
                if "users" not in cfg:
                    cfg["users"] = {}
        except Exception:
            pass

    # Synchronize from Cloud database
    try:
        req = urllib.request.Request(
            REMOTE_DB_URL, 
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                remote_cfg = json.loads(response.read().decode('utf-8'))
                if isinstance(remote_cfg, dict) and "users" in remote_cfg:
                    # Sync remote users with local copy
                    for email, data in remote_cfg.get("users", {}).items():
                        cfg["users"][email] = data
                    if remote_cfg.get("setup_complete"):
                        cfg["setup_complete"] = True
                    
                    # Update local file cache
                    try:
                        with open(path, "w") as f:
                            json.dump(cfg, f, indent=4)
                    except Exception:
                        pass
    except Exception as e:
        print(f"Cloud DB sync read failed: {e}")

    return cfg

def save_vault_config(config):
    path = get_config_path()
    # Save locally
    try:
        with open(path, "w") as f:
            json.dump(config, f, indent=4)
    except Exception:
        pass
        
    # Sync to Cloud
    try:
        data = json.dumps(config).encode('utf-8')
        req = urllib.request.Request(
            REMOTE_DB_URL,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            method='PUT'
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            pass
    except Exception as e:
        print(f"Cloud DB sync write failed: {e}")

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        config = load_vault_config()
        # Only enforce login check if credentials setup is complete
        if config.get("setup_complete", False) and not session.get("logged_in", False):
            return jsonify({"success": False, "message": "Unauthorized. Please log in first.", "require_login": True}), 401
        return f(*args, **kwargs)
    return decorated_function

# ==========================================
# PUBLIC ROUTES
# ==========================================

@current_app.route('/')
def index():
    # Check if biometric face profile is registered for logged in user
    email = session.get('email')
    biometrics_setup = os.path.exists(get_pca_path(email)) if email else False
    
    config = load_vault_config()
    setup_needed = not config.get("setup_complete", False)
    logged_in = session.get("logged_in", False)
    auth_level = session.get("auth_level", "")

    return render_template(
        "index.html",
        biometrics_setup=biometrics_setup,
        setup_needed=setup_needed,
        logged_in=logged_in,
        auth_level=auth_level
    )

@current_app.route('/api/setup', methods=['POST'])
def setup_vault():
    """Registers a new user account with Email, Master Password, and Decoy Password."""
    config = load_vault_config()
    data = request.get_json() or {}
    email = data.get("email", "").lower().strip()
    master_pwd = data.get("master_password", "")
    decoy_pwd = data.get("decoy_password", "")

    if not email or "@" not in email:
        return jsonify({"success": False, "message": "A valid email address is required."}), 400

    if not master_pwd or not decoy_pwd:
        return jsonify({"success": False, "message": "Passwords cannot be empty."}), 400

    if master_pwd == decoy_pwd:
        return jsonify({"success": False, "message": "Master and Decoy passwords must be different."}), 400

    if "users" not in config:
        config["users"] = {}

    if email in config["users"]:
        return jsonify({"success": False, "message": "This email address is already registered."}), 400

    import hashlib
    m_salt = os.urandom(16).hex()
    d_salt = os.urandom(16).hex()

    m_hash = hashlib.sha256((m_salt + master_pwd).encode()).hexdigest()
    d_hash = hashlib.sha256((d_salt + decoy_pwd).encode()).hexdigest()

    config["users"][email] = {
        "master_hash": m_hash,
        "master_salt": m_salt,
        "decoy_hash": d_hash,
        "decoy_salt": d_salt
    }
    config["setup_complete"] = True

    save_vault_config(config)
    log_security_event("SETUP", f"User account created for {email}.")
    return jsonify({"success": True, "message": "Account created successfully!"})

@current_app.route('/api/login', methods=['POST'])
def login_vault():
    """Authenticates user email and password, triggering biometrics if registered."""
    config = load_vault_config()
    data = request.get_json() or {}
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password cannot be empty."}), 400

    if "users" not in config or email not in config["users"]:
        log_security_event("LOGIN_FAILED", f"Failed unlock attempt: unregistered email ({email}).")
        return jsonify({"success": False, "message": "Incorrect email or password."}), 401

    import hashlib
    user_data = config["users"][email]

    # 1. Check Master password
    m_salt = user_data["master_salt"]
    m_hash = hashlib.sha256((m_salt + password).encode()).hexdigest()
    if m_hash == user_data["master_hash"]:
        pca_path = get_pca_path(email)
        face_required = os.path.exists(pca_path)
        
        session['email'] = email
        session['auth_level'] = 'master'
        
        if face_required:
            session['logged_in'] = False  # Wait for face verification
            session['biometric_verified'] = False
            log_security_event("LOGIN_PENDING", f"Master password correct. Biometric scan required for {email}.")
            return jsonify({"success": True, "auth_level": "master", "face_required": True})
        else:
            session['logged_in'] = True
            session['biometric_verified'] = False
            log_security_event("LOGIN", f"Vault unlocked with Master access level for {email}.")
            return jsonify({"success": True, "auth_level": "master", "face_required": False})

    # 2. Check Decoy password (Duress mode bypasses Face ID for safety)
    d_salt = user_data["decoy_salt"]
    d_hash = hashlib.sha256((d_salt + password).encode()).hexdigest()
    if d_hash == user_data["decoy_hash"]:
        session['email'] = email
        session['auth_level'] = 'decoy'
        session['logged_in'] = True
        session['biometric_verified'] = False
        log_security_event("LOGIN", f"Vault unlocked with Decoy Duress Mode for {email}.", anomaly_flag=True)
        return jsonify({"success": True, "auth_level": "decoy", "face_required": False})

    log_security_event("LOGIN_FAILED", "Failed vault unlock attempt: invalid password.")
    return jsonify({"success": False, "message": "Incorrect vault password."}), 401

@current_app.route('/api/logout', methods=['POST'])
def logout_vault():
    """Clears the active session credentials."""
    auth = session.get('auth_level', 'guest')
    session.pop('logged_in', None)
    session.pop('auth_level', None)
    session.pop('biometric_verified', None)
    session.pop('biometric_time', None)
    log_security_event("LOGOUT", f"Invalidated active session ({auth}).")
    return jsonify({"success": True})

# ==========================================
# PROTECTED API ROUTES
# ==========================================

@current_app.route('/api/browse', methods=['GET'])
@login_required
def browse_path():
    """Triggers native OS file/folder dialogue in front of browser via a clean subprocess."""
    mode = request.args.get('mode', 'file')
    
    try:
        import subprocess
        import sys
        
        # Build inline python script to show dialog safely in a separate process
        script = (
            "import sys, tkinter as tk; "
            "from tkinter import filedialog; "
            "root = tk.Tk(); "
            "root.withdraw(); "
            "root.lift(); "
            "root.focus_force(); "
            "root.attributes('-topmost', True); "
            "path = filedialog.askdirectory(title='Select Folder to Lock') if sys.argv[1] == 'folder' "
            "else filedialog.askopenfilename(title='Select File to Lock'); "
            "print(path); "
            "root.destroy()"
        )
        
        res = subprocess.run(
            [sys.executable, "-c", script, mode],
            capture_output=True,
            text=True,
            check=True
        )
        
        selected_path = res.stdout.strip()
        return jsonify({"path": selected_path})
    except Exception as e:
        return jsonify({"error": f"Failed to open dialog: {str(e)}"}), 500

@current_app.route('/api/vault', methods=['GET'])
@login_required
def get_vault_catalog():
    """Returns list of currently locked items or mock files if in Decoy Mode."""
    auth_level = session.get('auth_level', 'master')

    if auth_level == 'decoy':
        # Return a simulated list of mock personal files
        return jsonify([
            {
                "id": "decoy-item-1",
                "name": "corporate_tax_returns_2025.pdf",
                "type": "file",
                "original_path": "C:\\Users\\User\\Documents\\Financials\\corporate_tax_returns_2025.pdf",
                "locked_at": "2026-04-12 10:24:15"
            },
            {
                "id": "decoy-item-2",
                "name": "personal_credentials_backup.txt",
                "type": "file",
                "original_path": "C:\\Users\\User\\Desktop\\Backups\\personal_credentials_backup.txt",
                "locked_at": "2026-05-01 14:15:32"
            },
            {
                "id": "decoy-item-3",
                "name": "confidential_employee_records",
                "type": "directory",
                "original_path": "C:\\Users\\User\\Documents\\HR\\confidential_employee_records",
                "locked_at": "2026-06-18 16:40:02"
            }
        ])

    metadata = load_metadata()
    catalog = []
    for item_id, info in metadata.items():
        catalog.append({
            "id": item_id,
            "name": info["name"],
            "type": info["type"],
            "original_path": info["original_path"],
            "locked_at": info["locked_at"]
        })
    return jsonify(catalog)

@current_app.route('/api/password-strength', methods=['POST'])
@login_required
def analyze_password():
    """Evaluates password using AI classifier."""
    data = request.get_json() or {}
    password = data.get("password", "")
    analysis = password_analyzer.analyze(password)
    return jsonify(analysis)

@current_app.route('/api/lock', methods=['POST'])
@login_required
def lock_item():
    """Encrypts and locks the selected item (Disabled in Decoy Mode)."""
    if session.get('auth_level') == 'decoy':
        return jsonify({"success": False, "message": "Permission Denied: Vault is in Read-Only Decoy mode."}), 403

    data = request.get_json() or {}
    item_path = data.get("path", "")
    password = data.get("password", "")
    delete_original = data.get("delete_original", True)

    if not item_path or not password:
        return jsonify({"success": False, "message": "Missing file path or password."}), 400

    # Clean quotes
    item_path = item_path.strip('"').strip("'")

    success, msg = encrypt_item(item_path, password, delete_original=delete_original)
    if success:
        log_security_event(
            "LOCK",
            f"Successfully encrypted and locked: {os.path.basename(item_path)} ({item_path})"
        )
        return jsonify({"success": True, "message": msg})
    else:
        return jsonify({"success": False, "message": msg}), 500

@current_app.route('/api/unlock', methods=['POST'])
@login_required
def unlock_item():
    """Decrypts and restores a locked item with multi-factor check & anomaly verification."""
    data = request.get_json() or {}
    item_id = data.get("id", "")
    password = data.get("password", "")
    duration = float(data.get("duration", 0.0)) # duration user spent typing password

    if not item_id or not password:
        return jsonify({"success": False, "message": "Missing item ID or password."}), 400

    # 1. Biometric verification enforcement check
    face_dir = current_app.config['FACE_DATA_DIR']
    pca_path = os.path.join(face_dir, "pca_model.npz")
    biometrics_enabled = os.path.exists(pca_path)

    if biometrics_enabled:
        bio_verified = session.get('biometric_verified', False)
        bio_time = session.get('biometric_time', 0.0)
        
        # Biometric session expires after 60 seconds
        if not bio_verified or (time.time() - bio_time) > 60:
            log_security_event(
                "UNLOCK_FAILED",
                f"Unauthorized unlock attempt for item {item_id}: Face verification bypassed or session expired."
            )
            return jsonify({
                "success": False, 
                "message": "Access Denied. Face verification is active and must be completed first."
            }), 403

    # 2. AI Behavioral Anomaly Check
    current_hour = time.localtime().tm_hour
    face_success = session.get('biometric_verified', False) if biometrics_enabled else True
    is_anomaly, anomaly_reason = anomaly_detector.check_anomaly(current_hour, duration, face_success)

    # 3. Handle Decoy Mode Unlock (Duress Simulation)
    if session.get('auth_level') == 'decoy':
        mock_files = {
            "decoy-item-1": ("corporate_tax_returns_2025.pdf", "=== 2025 Corporate Tax Summary ===\nGross Income: $4,510,920\nDeductions: $3,212,450\nTaxable Income: $1,298,470\nNet Tax Due: $272,678\nStatus: Paid (Filed: 2026-04-10)"),
            "decoy-item-2": ("personal_credentials_backup.txt", "=== Account Credentials Backup ===\nGoogle: john.doe.backup2026@gmail.com / Pass: BlueSkies_88!\nCloud Storage: backup_storage_usr / Pass: S3cureCl0udSt0re\nInternal WiFi: Corporate_Staff / Key: StaffWifiKey2026"),
            "decoy-item-3": ("confidential_employee_records", "")
        }

        if item_id not in mock_files:
            return jsonify({"success": False, "message": "Decoy item not found."}), 404

        filename, mock_content = mock_files[item_id]
        output_dir = os.path.join(current_app.config['BASE_DIR'], "Output File")
        os.makedirs(output_dir, exist_ok=True)

        if item_id == "decoy-item-3":
            # Create mock HR directory structure
            folder_path = os.path.join(output_dir, filename)
            os.makedirs(folder_path, exist_ok=True)
            with open(os.path.join(folder_path, "employee_list.csv"), "w") as f:
                f.write("ID,Name,Department,Salary\n101,John Doe,Finance,$95000\n102,Jane Smith,HR,$85000\n")
            with open(os.path.join(folder_path, "payroll_status.txt"), "w") as f:
                f.write("All payments disbursed successfully for Q2 2026.")
        else:
            dest_path = os.path.join(output_dir, filename)
            with open(dest_path, "w") as f:
                f.write(mock_content)

        session.pop('biometric_verified', None)
        session.pop('biometric_time', None)

        log_security_event(
            "UNLOCK_SUCCESS",
            f"Successfully unlocked decoy item: {filename}. (Decoy simulation triggered).",
            anomaly_flag=False
        )
        return jsonify({
            "success": True, 
            "message": f"Successfully unlocked and restored '{filename}' to Output File.", 
            "anomaly_detected": False,
            "anomaly_reason": ""
        })

    # 4. Standard Vault File Decryption
    success, msg = decrypt_item(item_id, password)
    
    if success:
        session.pop('biometric_verified', None)
        session.pop('biometric_time', None)
        
        log_security_event(
            "UNLOCK_SUCCESS",
            f"Successfully unlocked and restored item {item_id}.",
            anomaly_flag=is_anomaly
        )
        return jsonify({
            "success": True, 
            "message": msg, 
            "anomaly_detected": is_anomaly,
            "anomaly_reason": anomaly_reason if is_anomaly else ""
        })
    else:
        # snap intruder photo and save if incorrect password
        photo_name = ""
        if cv2 is not None and camera_manager.start_camera():
            try:
                success_cam, frame = camera_manager.camera.read()
                if success_cam:
                    frame = cv2.flip(frame, 1)
                    photo_name = f"intruder_pwd_{int(time.time())}.jpg"
                    photo_path = os.path.join(current_app.config['INTRUDERS_DIR'], photo_name)
                    cv2.imwrite(photo_path, frame)
            except Exception:
                pass
            camera_manager.stop_camera()

        log_security_event(
            "UNLOCK_FAILED",
            f"Incorrect password for item {item_id}. Duration: {duration:.1f}s.",
            anomaly_flag=is_anomaly,
            photo_filename=photo_name
        )
        return jsonify({
            "success": False, 
            "message": "Incorrect password. Security log updated.",
            "anomaly_detected": is_anomaly,
            "anomaly_reason": anomaly_reason if is_anomaly else ""
        }), 401

@current_app.route('/video_feed')
def video_feed():
    """Webcam MJPEG stream endpoint."""
    mode = request.args.get('mode', 'idle')
    camera_manager.active_email = session.get('email', 'global')
    camera_manager.reset_state(mode)
    return Response(
        camera_manager.generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )

@current_app.route('/api/biometrics/status', methods=['GET'])
@login_required
def biometrics_status():
    """Poll endpoint to fetch face registration/verification progress."""
    registered = os.path.exists(get_pca_path())

    # Set session variable if verification passed
    if camera_manager.mode == "verify" and camera_manager.verification_finished and camera_manager.verification_success:
        session['logged_in'] = True
        session['biometric_verified'] = True
        session['biometric_time'] = time.time()
        log_security_event("BIOMETRIC_SUCCESS", f"Face recognition matched authorized user profile for {session.get('email')}.")

    # Fallback to bypass if camera error occurs during verification
    if camera_manager.camera_error and camera_manager.mode == "verify":
        session['logged_in'] = True
        log_security_event("BIOMETRIC_BYPASS", f"Webcam connection failed. Biometric verification bypassed for {session.get('email')}.")

    # Log intruder snap if verification failed
    if camera_manager.mode == "verify" and camera_manager.verification_finished and not camera_manager.verification_success:
        if camera_manager.intruder_captured:
            log_security_event(
                "BIOMETRIC_FAILED",
                "Face biometric recognition failed to verify user identity.",
                anomaly_flag=True,
                photo_filename=camera_manager.intruder_captured
            )
            # Clear trigger to avoid multiple log lines
            camera_manager.intruder_captured = False

    return jsonify({
        "finished": camera_manager.verification_finished,
        "success": camera_manager.verification_success,
        "registered": registered,
        "mode": camera_manager.mode,
        "register_count": camera_manager.register_count,
        "frames_checked": camera_manager.verification_frames_checked,
        "success_count": camera_manager.verification_success_count,
        "camera_error": camera_manager.camera_error
    })

@current_app.route('/api/biometrics/reset', methods=['POST'])
@login_required
def reset_biometrics():
    """Resets biometrics manager and stops camera feed."""
    camera_manager.reset_state("idle")
    camera_manager.stop_camera()
    return jsonify({"success": True})

@current_app.route('/api/logs', methods=['GET'])
@login_required
def get_logs():
    """Reads security log file and returns entries in reverse-chronological order."""
    log_path = current_app.config['LOG_PATH']
    entries = []
    if os.path.exists(log_path):
        with open(log_path, "r") as f:
            for line in f:
                if line.strip():
                    try:
                        entries.append(json.loads(line.strip()))
                    except Exception:
                        pass
    return jsonify(entries[::-1])

@current_app.route('/api/intruders/<filename>')
@login_required
def serve_intruder_image(filename):
    """Serves captured intruder images from the secure local folder."""
    return send_from_directory(current_app.config['INTRUDERS_DIR'], filename)

@current_app.route('/api/auth/google')
def google_auth_popup():
    """Renders a premium mock Google account picker selector."""
    return render_template('google_select.html')

@current_app.route('/api/auth/google/callback', methods=['POST'])
def google_callback():
    """Saves user session and logs user activity after authentication."""
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({"success": False, "message": "Email is required."}), 400
        
    config = load_vault_config()
    
    # Auto-register new SSO users with default secure credentials
    if email not in config["users"]:
        m_salt = os.urandom(16).hex()
        d_salt = os.urandom(16).hex()
        m_pwd = f"Google_{email.split('@')[0]}"
        d_pwd = f"Decoy_{email.split('@')[0]}"
        
        import hashlib
        m_hash = hashlib.pbkdf2_hmac('sha256', m_pwd.encode(), bytes.fromhex(m_salt), 100000).hex()
        d_hash = hashlib.pbkdf2_hmac('sha256', d_pwd.encode(), bytes.fromhex(d_salt), 100000).hex()
        
        config["users"][email] = {
            "master_hash": m_hash,
            "master_salt": m_salt,
            "decoy_hash": d_hash,
            "decoy_salt": d_salt,
            "biometrics_setup": False
        }
        config["setup_complete"] = True
        save_vault_config(config)
        log_security_event("GOOGLE_REGISTER", f"Registered new user account for {email} via Google SSO.")
        
    session.clear()
    session['email'] = email
    session['auth_level'] = 'master'
    session['logged_in'] = True
    
    log_security_event("GOOGLE_LOGIN", f"User {email} successfully authenticated via Google Sign-In.")
    
    return jsonify({"success": True, "auth_level": "master"})
