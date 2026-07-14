# A.I.-Powered File & Folder Locker Application

This project is a secure, local multi-factor File and Folder Locker application developed in Python with a premium dark glassmorphism Web GUI, advanced cryptography, and machine learning components.

---

## 📁 Directory Structure

The files and folders in this project are arranged as follows:

```text
├── Output File/                  # Directory for user output files
├── Related or Required Files/    # Security vaults, logs, and biometrics datasets
│   ├── face_data/                # User registered face photos & PCA model
│   ├── intruders/                # Snapshots of unauthorized access attempts
│   ├── secure_vault/             # Encrypted file blocks and metadata inventory
│   └── security_log.txt          # Event logs with anomaly records
├── Source Code/                  # Application source code
│   ├── app/                      # Flask application package
│   │   ├── core/                 # Cryptography and machine learning engines
│   │   │   ├── ai_security.py
│   │   │   ├── crypto.py
│   │   │   └── face_rec.py
│   │   ├── static/               # CSS, JS, and image elements
│   │   ├── templates/            # HTML Dashboard layouts
│   │   ├── __init__.py           # Flask app initializer and directories setup
│   │   └── routes.py             # Server endpoints & camera streams
│   └── locker_app.py             # Application entrypoint launcher
├── README.md                     # Project documentation (this file)
└── Used Libraries.txt            # Details of libraries used
```

---

## ⚙️ Installation & Setup

1. Make sure you have **Python 3.8+** installed.
2. Install the required Python packages:
   ```bash
   pip install cryptography opencv-python numpy scikit-learn flask
   ```

---

## 🚀 How to Run

1. Open your terminal inside the **`Source Code`** directory:
   ```bash
   cd "Source Code"
   ```
2. Start the application:
   ```bash
   python locker_app.py
   ```
3. The server will launch a local background daemon and automatically open the security dashboard in your default browser at:
   `http://127.0.0.1:5050`

---

## 🛡️ Security Features Overview

- **Double-Salted Cryptography**: Uses Fernet AES encryption with 100,000 PBKDF2 iterations. Separate salts are generated for password hashing and key derivation.
- **Biometric PCA Eigenfaces**: Captures 30 face frames to construct a custom local dimension-reduction PCA model. Bypasses the need for unstable C++ modules.
- **Behavioral Isolation Forest**: Detects atypical login durations or abnormal timing patterns to identify possible shoulder-surfing or brute-forcing threats.
- **Intruder Snapping**: Snaps web-camera snapshots of unauthorized users when face validation fails or an incorrect password is typed.

---

## 🎭 Extra Enhancement: Decoy Vault (Duress Mode)

The application implements a **Deniable Cryptography** decoy database layout to protect user safety under coercion or duress:

- **Secondary Duress Password**: During setup, the user configures both a **Master Password** and a **Decoy Password**.
- **Automatic Catalog Redirection**:
  - Unlocking the vault with the **Master Password** loads the actual metadata registry and unlocks real secure items.
  - Unlocking with the **Decoy Password** loads a simulated read-only catalog containing realistic decoy files (e.g., mock corporate tax summaries or salary spreadsheets) to pacify attackers.
- **Decoy Unlock Simulation**: Clicking "Unlock" on a decoy file simulates the decryption phase and generates a dummy text/CSV document containing fake financial or HR tables inside the `Output File/` folder, completing the illusion of a successful data leak.

