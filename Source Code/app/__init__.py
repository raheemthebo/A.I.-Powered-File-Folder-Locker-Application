import os
from flask import Flask

# Base directory is the workspace root (parent of parent of this file)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REQUIRED_DIR = os.path.join(BASE_DIR, "Related or Required Files")

SECURE_DIR = os.path.join(REQUIRED_DIR, "secure_vault")
FACE_DATA_DIR = os.path.join(REQUIRED_DIR, "face_data")
INTRUDERS_DIR = os.path.join(REQUIRED_DIR, "intruders")
LOG_PATH = os.path.join(REQUIRED_DIR, "security_log.txt")

# Create required directories
try:
    os.makedirs(SECURE_DIR, exist_ok=True)
    os.makedirs(FACE_DATA_DIR, exist_ok=True)
    os.makedirs(INTRUDERS_DIR, exist_ok=True)
except Exception:
    pass

def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.secret_key = "secure_vault_super_secret_key_change_me_in_production"
    
    # Configure variables on the app instance
    app.config['SECURE_DIR'] = SECURE_DIR
    app.config['FACE_DATA_DIR'] = FACE_DATA_DIR
    app.config['INTRUDERS_DIR'] = INTRUDERS_DIR
    app.config['LOG_PATH'] = LOG_PATH
    app.config['BASE_DIR'] = BASE_DIR

    # Register blueprints or import routes
    with app.app_context():
        from . import routes
        
    return app
