// Global State Variables
let currentTab = 'vault';
let selectedItemId = null;
let passwordModalOpenTime = null;
let biometricPollInterval = null;
let isCameraActive = false;

// Page Load Setup
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initFileBrowsing();
    initPasswordAnalyzer();
    initLocker();
    initBiometricRegistration();
    initAuth();
    
    // Initial data load only if session is already active (e.g. reload after logging in)
    const lockScreen = document.getElementById('lock-screen-container');
    if (lockScreen && !lockScreen.classList.contains('active')) {
        loadVault();
        loadLogs();
        checkBiometricStatus();
    }
});

// ==========================================
// 1. NAVIGATION & TAB SWITCHING
// ==========================================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = item.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });
}

function switchTab(tabId) {
    // Hide active tabs and deactivate menu links
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    // Show selected tab and activate link
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');
    
    // Update headers
    const title = document.getElementById('tab-title');
    const subtitle = document.getElementById('tab-subtitle');
    
    currentTab = tabId;
    
    // If user navigates away from biometrics, make sure camera is stopped
    if (tabId !== 'biometrics' && isCameraActive) {
        stopBiometricCamera();
    }

    if (tabId === 'vault') {
        title.innerText = "Secure Vault Catalog";
        subtitle.innerText = "Manage your encrypted files and folders securely";
        loadVault();
    } else if (tabId === 'lock') {
        title.innerText = "Lock Files & Folders";
        subtitle.innerText = "Encrypt items and remove originals for maximum security";
        resetLockForm();
    } else if (tabId === 'biometrics') {
        title.innerText = "Biometric Setup";
        subtitle.innerText = "Configure face recognition login profiles";
        checkBiometricStatus();
    } else if (tabId === 'security') {
        title.innerText = "Security Control Center";
        subtitle.innerText = "Monitor login attempts, anomaly warnings, and lock activities";
        loadLogs();
    }
}

// ==========================================
// 2. NATIVE FILE BROWSING INTEGRATION
// ==========================================
function initFileBrowsing() {
    const fileBtn = document.getElementById('btn-browse-file');
    const folderBtn = document.getElementById('btn-browse-folder');
    const pathInput = document.getElementById('target-path');
    const lockSubmitBtn = document.getElementById('btn-lock-submit');

    const triggerBrowse = (mode) => {
        fetch(`/api/browse?mode=${mode}`)
            .then(res => res.json())
            .then(data => {
                if (data.path) {
                    pathInput.value = data.path;
                    validateLockForm();
                }
            })
            .catch(err => {
                console.error("Browse failed:", err);
                alert("Could not trigger file selection dialogue.");
            });
    };

    fileBtn.addEventListener('click', () => triggerBrowse('file'));
    folderBtn.addEventListener('click', () => triggerBrowse('folder'));
}

// ==========================================
// 3. AI PASSWORD STRENGTH CLASSIFIER
// ==========================================
function initPasswordAnalyzer() {
    const passwordInput = document.getElementById('lock-password');
    let debounceTimer;

    passwordInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const password = e.target.value;
        
        if (!password) {
            updatePasswordUI({
                strength: "Enter Password",
                score: 0,
                suggestions: ["Type a password to start evaluation..."]
            });
            validateLockForm();
            return;
        }

        debounceTimer = setTimeout(() => {
            fetch('/api/password-strength', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            })
            .then(res => res.json())
            .then(data => {
                updatePasswordUI(data);
                validateLockForm();
            })
            .catch(err => console.error("Strength check failed:", err));
        }, 150);
    });
}

function updatePasswordUI(data) {
    const fill = document.getElementById('pwd-meter-fill');
    const label = document.getElementById('pwd-strength-label');
    const pct = document.getElementById('pwd-pct-label');
    const suggestions = document.getElementById('pwd-suggestions');

    // Update progress meter bar width & text percentage
    fill.style.width = `${data.score}%`;
    pct.innerText = `${data.score}%`;
    label.innerText = data.strength;

    // Reset meter classes and set current strength class
    fill.className = "meter-fill";
    label.className = "strength-val";
    
    if (data.strength === "Weak") {
        fill.classList.add('weak');
        label.classList.add('text-red');
    } else if (data.strength === "Medium") {
        fill.classList.add('medium');
        label.classList.add('text-orange');
    } else {
        fill.classList.add('strong');
        label.classList.add('text-green');
    }

    // List Recommendations
    suggestions.innerHTML = "";
    if (data.suggestions.length === 0) {
        const li = document.createElement('li');
        li.innerText = "Password is highly secure and meets all criteria!";
        li.style.color = "var(--neon-green)";
        suggestions.appendChild(li);
    } else {
        data.suggestions.forEach(tip => {
            const li = document.createElement('li');
            li.innerText = tip;
            suggestions.appendChild(li);
        });
    }
}

// ==========================================
// 4. LOCK FILE / FOLDER OPERATIONS
// ==========================================
function initLocker() {
    const lockSubmitBtn = document.getElementById('btn-lock-submit');
    
    lockSubmitBtn.addEventListener('click', () => {
        const path = document.getElementById('target-path').value;
        const password = document.getElementById('lock-password').value;
        const deleteOriginal = document.getElementById('delete-original').checked;

        if (!path || !password) return;

        lockSubmitBtn.disabled = true;
        lockSubmitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locking items...`;

        fetch('/api/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, password, delete_original: deleteOriginal })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(data.message);
                resetLockForm();
                switchTab('vault');
            } else {
                alert("Error: " + data.message);
                lockSubmitBtn.disabled = false;
                lockSubmitBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Secure & Lock Item`;
            }
        })
        .catch(err => {
            console.error("Locking failed:", err);
            alert("Error connecting to server.");
            lockSubmitBtn.disabled = false;
            lockSubmitBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Secure & Lock Item`;
        });
    });
}

function validateLockForm() {
    const path = document.getElementById('target-path').value;
    const password = document.getElementById('lock-password').value;
    const submitBtn = document.getElementById('btn-lock-submit');

    if (path && password.length >= 4) {
        submitBtn.disabled = false;
    } else {
        submitBtn.disabled = true;
    }
}

function resetLockForm() {
    document.getElementById('target-path').value = "";
    document.getElementById('lock-password').value = "";
    document.getElementById('delete-original').checked = true;
    document.getElementById('btn-lock-submit').disabled = true;
    updatePasswordUI({
        strength: "Enter Password",
        score: 0,
        suggestions: ["Type a password to start evaluation..."]
    });
}

// ==========================================
// 5. VAULT LOADER & UNLOCKING (WITH MULTI-FACTOR BIOMETRICS)
// ==========================================
function loadVault() {
    fetch('/api/vault')
        .then(res => res.json())
        .then(data => {
            const body = document.getElementById('vault-items-body');
            document.getElementById('stat-total-items').innerText = data.length;
            
            const folderCount = data.filter(i => i.type === 'directory').length;
            document.getElementById('stat-folders').innerText = folderCount;

            if (data.length === 0) {
                body.innerHTML = `
                    <tr class="empty-row">
                        <td colspan="5">
                            <div class="empty-state">
                                <i class="fa-solid fa-box-open"></i>
                                <p>Your secure vault is empty. Lock files to get started.</p>
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            body.innerHTML = "";
            data.forEach(item => {
                const tr = document.createElement('tr');
                
                const typeIcon = item.type === 'directory' 
                    ? `<i class="fa-solid fa-folder-closed file-type-icon text-orange"></i>`
                    : `<i class="fa-solid fa-file-shield file-type-icon text-blue"></i>`;
                
                tr.innerHTML = `
                    <td>${typeIcon}<strong>${item.name}</strong></td>
                    <td class="text-secondary">${item.type.toUpperCase()}</td>
                    <td class="text-secondary" title="${item.original_path}">${item.original_path}</td>
                    <td class="text-secondary">${item.locked_at}</td>
                    <td>
                        <button class="btn btn-secondary" onclick="initiateUnlock('${item.id}', '${item.name.replace(/'/g, "\\'")}')">
                            <i class="fa-solid fa-lock-open text-green"></i> Unlock
                        </button>
                    </td>`;
                body.appendChild(tr);
            });
        })
        .catch(err => console.error("Could not fetch vault catalog:", err));
}

function initiateUnlock(itemId, itemName) {
    selectedItemId = itemId;
    document.getElementById('unlock-item-label').innerText = `Unlocking: ${itemName}`;
    
    // Check if facial biometric is configured
    fetch('/api/biometrics/status')
        .then(res => res.json())
        .then(status => {
            if (status.registered) {
                // Biometrics is setup, trigger webcam verification overlay first
                openBiometricVerification();
            } else {
                // Biometrics is NOT setup, bypass straight to password unlock
                openPasswordUnlock();
            }
        })
        .catch(err => {
            console.error("Biometric status check failed:", err);
            // fallback directly to password prompt
            openPasswordUnlock();
        });
}

// 5a. BIOMETRIC SCAN VERIFICATION
function openBiometricVerification() {
    const modal = document.getElementById('modal-bio-verify');
    const stream = document.getElementById('bio-verify-stream');
    const label = document.getElementById('verify-overlay-lbl');
    const fill = document.getElementById('verify-progress-fill');
    const statsLbl = document.getElementById('verify-stats-lbl');
    
    label.innerText = "Activating Webcam...";
    fill.style.width = "0%";
    statsLbl.innerText = "Connecting camera...";
    
    modal.classList.add('active');
    
    // Set video feed sources
    stream.src = "/video_feed?mode=verify";
    
    biometricPollInterval = setInterval(() => {
        fetch('/api/biometrics/status')
            .then(res => res.json())
            .then(status => {
                if (status.camera_error) {
                    clearInterval(biometricPollInterval);
                    closeVerificationModal();
                    alert("Webcam connection failed. Falling back directly to password validation.");
                    openPasswordUnlock();
                    return;
                }
                
                // Update checking parameters
                const progress = (status.frames_checked / 40) * 100;
                fill.style.width = `${progress}%`;
                
                label.innerText = `Analyzing: ${status.success_count} matches`;
                statsLbl.innerText = `Frames evaluated: ${status.frames_checked}/40 (Looking for 12 profile matches)`;
                
                if (status.finished) {
                    clearInterval(biometricPollInterval);
                    stream.src = ""; // Stop camera stream request
                    modal.classList.remove('active');
                    
                    if (status.success) {
                        // Face matched! Proceed directly to typing password
                        openPasswordUnlock();
                    } else {
                        // Face recognition failed
                        alert("Access Denied: Biometric face scan could not verify identity. Attempt logged.");
                        loadLogs(); // Refresh activity logs to show intruder alert
                    }
                }
            })
            .catch(err => {
                console.error("Biometrics polling error:", err);
                clearInterval(biometricPollInterval);
            });
    }, 400);
}

function closeVerificationModal() {
    clearInterval(biometricPollInterval);
    document.getElementById('bio-verify-stream').src = "";
    document.getElementById('modal-bio-verify').classList.remove('active');
    
    // Cancel action on server
    fetch('/api/biometrics/reset', { method: 'POST' });
}

// 5b. PASSWORD UNLOCK INTERACTION
function openPasswordUnlock() {
    const modal = document.getElementById('modal-pwd-prompt');
    const input = document.getElementById('unlock-password');
    const errorAlert = document.getElementById('unlock-error-alert');
    
    input.value = "";
    errorAlert.classList.add('hidden');
    
    modal.classList.add('active');
    input.focus();
    
    // Mark precise start typing time to calculate anomaly heuristics duration
    passwordModalOpenTime = Date.now();
    
    // Assign handler to click confirm
    const confirmBtn = document.getElementById('btn-unlock-confirm');
    confirmBtn.onclick = submitUnlockPassword;
}

function submitUnlockPassword() {
    const password = document.getElementById('unlock-password').value;
    const errorAlert = document.getElementById('unlock-error-alert');
    const errorMsg = document.getElementById('unlock-error-msg');
    
    if (!password) return;

    // Calculate time taken typing password in seconds
    const duration = (Date.now() - passwordModalOpenTime) / 1000;

    fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedItemId, password, duration })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            closePasswordModal();
            alert(data.message);
            loadVault();
            loadLogs();
        } else {
            errorMsg.innerText = data.message;
            errorAlert.classList.remove('hidden');
            loadLogs(); // Reload logs to show incorrect password event snapshot
        }
    })
    .catch(err => {
        console.error("Unlock error:", err);
        errorMsg.innerText = "Error communicating with locker daemon.";
        errorAlert.classList.remove('hidden');
    });
}

function closePasswordModal() {
    document.getElementById('modal-pwd-prompt').classList.remove('active');
    // Clear biometric check on cancel to prevent reuse
    fetch('/api/biometrics/reset', { method: 'POST' });
}

// ==========================================
// 6. BIOMETRICS REGISTRATION CONTROLS
// ==========================================
function initBiometricRegistration() {
    const regBtn = document.getElementById('btn-register-face');
    const cancelBtn = document.getElementById('btn-cancel-cam');
    
    regBtn.addEventListener('click', () => {
        isCameraActive = true;
        regBtn.classList.add('hidden');
        cancelBtn.classList.remove('hidden');
        
        const stream = document.getElementById('camera-stream');
        const overlay = document.getElementById('camera-overlay');
        const overlayText = document.getElementById('camera-overlay-text');
        const samplesLbl = document.getElementById('captured-samples-lbl');
        
        overlay.classList.remove('hidden');
        overlayText.innerText = "Camera starting...";
        
        // Start streaming video feed with registration argument
        stream.src = "/video_feed?mode=register";
        
        biometricPollInterval = setInterval(() => {
            fetch('/api/biometrics/status')
                .then(res => res.json())
                .then(status => {
                    if (status.camera_error) {
                        clearInterval(biometricPollInterval);
                        stopBiometricCamera();
                        alert("Camera Error: Could not connect to webcam. Biometric face registration aborted.");
                        return;
                    }
                    
                    overlayText.innerText = `Align Face - Captured ${status.register_count}/30`;
                    samplesLbl.innerText = `${status.register_count} / 30`;
                    
                    if (status.finished) {
                        clearInterval(biometricPollInterval);
                        stopBiometricCamera();
                        alert("Face Registered Successfully! PCA Classifier models trained and deployed.");
                        checkBiometricStatus();
                    }
                })
                .catch(err => {
                    console.error("Registration poll error:", err);
                    clearInterval(biometricPollInterval);
                });
        }, 500);
    });

    cancelBtn.addEventListener('click', () => {
        stopBiometricCamera();
    });
}

function stopBiometricCamera() {
    clearInterval(biometricPollInterval);
    document.getElementById('camera-stream').src = "";
    document.getElementById('camera-overlay').classList.add('hidden');
    document.getElementById('btn-register-face').classList.remove('hidden');
    document.getElementById('btn-cancel-cam').classList.add('hidden');
    isCameraActive = false;
    
    // reset on server
    fetch('/api/biometrics/reset', { method: 'POST' });
}

function checkBiometricStatus() {
    fetch('/api/biometrics/status')
        .then(res => res.json())
        .then(status => {
            const badge = document.getElementById('bio-setup-status');
            const samplesLbl = document.getElementById('captured-samples-lbl');
            const globalBadge = document.getElementById('global-bio-badge');
            
            if (status.registered) {
                badge.innerText = "Configured";
                badge.className = "badge green";
                samplesLbl.innerText = "30 / 30 (Active PCA model)";
                
                globalBadge.classList.add('verified');
                globalBadge.querySelector('span').innerText = "Face ID Ready";
            } else {
                badge.innerText = "Not Configured";
                badge.className = "badge red";
                samplesLbl.innerText = "0 / 30";
                
                globalBadge.classList.remove('verified');
                globalBadge.querySelector('span').innerText = "Face ID Disabled";
            }
        })
        .catch(err => console.error("Could not load biometric status:", err));
}

// ==========================================
// 7. SECURITY activity DASHBOARD LOGS
// ==========================================
function loadLogs() {
    fetch('/api/logs')
        .then(res => res.json())
        .then(data => {
            const body = document.getElementById('log-entries-body');
            const totalAnomaliesLbl = document.getElementById('sec-total-anomalies');
            const normalLoginsLbl = document.getElementById('sec-normal-logins');
            const criticalAlertBox = document.getElementById('high-risk-alert');

            let anomalyCount = 0;
            let normalCount = 0;

            if (data.length === 0) {
                body.innerHTML = `<p class="text-center text-muted">No security events logged yet.</p>`;
                totalAnomaliesLbl.innerText = 0;
                normalLoginsLbl.innerText = 0;
                criticalAlertBox.classList.add('hidden');
                return;
            }

            body.innerHTML = "";
            data.forEach(log => {
                // Count statistics
                if (log.anomaly === "YES" || log.event_type === "BIOMETRIC_FAILED") {
                    anomalyCount++;
                } else if (log.event_type === "UNLOCK_SUCCESS" || log.event_type === "BIOMETRIC_SUCCESS") {
                    normalCount++;
                }

                const logItem = document.createElement('div');
                logItem.className = `log-item ${log.anomaly === "YES" ? "anomalous" : ""}`;

                // Set icons and classes based on event type
                let iconClass = "fa-circle-info text-blue";
                if (log.event_type === "LOCK") iconClass = "fa-lock text-blue";
                else if (log.event_type === "UNLOCK_SUCCESS") iconClass = "fa-lock-open text-green";
                else if (log.event_type === "UNLOCK_FAILED") iconClass = "fa-circle-exclamation text-red";
                else if (log.event_type === "BIOMETRIC_SUCCESS") iconClass = "fa-face-smile text-green";
                else if (log.event_type === "BIOMETRIC_FAILED") iconClass = "fa-face-frown text-red";

                // Check for intruder photo link
                let photoLink = "";
                if (log.photo) {
                    photoLink = `<button class="btn-photo-link" onclick="viewIntruderImage('${log.photo}', '${log.timestamp}')">
                                    <i class="fa-solid fa-image"></i> View Snapshot
                                 </button>`;
                }

                const anomalyBadge = log.anomaly === "YES" 
                    ? `<span class="badge red"><i class="fa-solid fa-triangle-exclamation"></i> Anomaly</span>`
                    : "";

                logItem.innerHTML = `
                    <div class="log-main">
                        <div class="log-icon-wrap"><i class="fa-solid ${iconClass}"></i></div>
                        <div class="log-details">
                            <h5>${log.event_type.replace('_', ' ')}</h5>
                            <p>${log.details}</p>
                            ${photoLink}
                        </div>
                    </div>
                    <div class="log-meta">
                        <span class="log-time">${log.timestamp}</span>
                        <div class="log-badges">${anomalyBadge}</div>
                    </div>`;
                
                body.appendChild(logItem);
            });

            totalAnomaliesLbl.innerText = anomalyCount;
            normalLoginsLbl.innerText = normalCount;

            // Trigger alert warning if anomalies exist
            if (anomalyCount > 0) {
                criticalAlertBox.classList.remove('hidden');
            } else {
                criticalAlertBox.classList.add('hidden');
            }
        })
        .catch(err => console.error("Could not fetch security activity logs:", err));
}

// 7a. INTRUDER PHOTOGRAPH LIGHTBOX VIEWER
function viewIntruderImage(filename, timestamp) {
    const modal = document.getElementById('modal-intruder-lightbox');
    const img = document.getElementById('intruder-lightbox-img');
    const timeLbl = document.getElementById('intruder-lightbox-time');
    
    img.src = `/api/intruders/${filename}`;
    timeLbl.innerText = `Bypass Event Snapshot: ${timestamp}`;
    
    modal.classList.add('active');
}

function closeIntruderLightbox() {
    document.getElementById('modal-intruder-lightbox').classList.remove('active');
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
}

// ==========================================
// 8. SECURITY MASTER & DECOY VAULT AUTHENTICATION
// ==========================================
function initAuth() {
    const setupCard = document.getElementById('setup-credentials-card');
    const loginCard = document.getElementById('login-credentials-card');
    const lockScreen = document.getElementById('lock-screen-container');
    
    // Setup Submit
    const btnSetup = document.getElementById('btn-setup-submit');
    if (btnSetup) {
        btnSetup.addEventListener('click', () => {
            const master = document.getElementById('setup-master-password').value;
            const decoy = document.getElementById('setup-decoy-password').value;
            const alertBox = document.getElementById('setup-error-alert');
            const alertMsg = document.getElementById('setup-error-msg');
            
            if (!master || !decoy) {
                alertMsg.innerText = "Passwords cannot be empty.";
                alertBox.classList.remove('hidden');
                return;
            }
            if (master === decoy) {
                alertMsg.innerText = "Master and Decoy passwords must be different.";
                alertBox.classList.remove('hidden');
                return;
            }
            
            fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ master_password: master, decoy_password: decoy })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setupCard.classList.add('hidden');
                    loginCard.classList.remove('hidden');
                    alert("Vault initialized! Please log in to continue.");
                } else {
                    alertMsg.innerText = data.message;
                    alertBox.classList.remove('hidden');
                }
            })
            .catch(err => {
                console.error("Setup error:", err);
                alert("Failed to connect to backend server.");
            });
        });
    }

    // Login Submit
    const btnLogin = document.getElementById('btn-login-submit');
    if (btnLogin) {
        btnLogin.addEventListener('click', () => {
            const password = document.getElementById('login-password').value;
            const alertBox = document.getElementById('login-error-alert');
            const alertMsg = document.getElementById('login-error-msg');
            
            if (!password) return;
            
            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    lockScreen.classList.remove('active');
                    
                    // Show global elements
                    document.getElementById('global-auth-badge').classList.remove('hidden');
                    document.getElementById('btn-logout').classList.remove('hidden');
                    
                    // Configure auth level visual
                    const authBadge = document.getElementById('global-auth-badge');
                    const authSpan = authBadge.querySelector('span');
                    const authIcon = authBadge.querySelector('i');
                    const lockTab = document.querySelector('.nav-item[data-tab="lock"]');
                    
                    authBadge.className = "auth-badge " + data.auth_level;
                    if (data.auth_level === 'decoy') {
                        authSpan.innerText = "Decoy Mode";
                        authIcon.className = "fa-solid fa-mask";
                        if (lockTab) lockTab.classList.add('hidden'); // Hide lock menu in Decoy mode
                    } else {
                        authSpan.innerText = "Master Mode";
                        authIcon.className = "fa-solid fa-user-gear";
                        if (lockTab) lockTab.classList.remove('hidden');
                    }
                    
                    // Clean fields
                    document.getElementById('login-password').value = "";
                    
                    // Load data
                    loadVault();
                    loadLogs();
                    checkBiometricStatus();
                } else {
                    alertMsg.innerText = data.message;
                    alertBox.classList.remove('hidden');
                }
            })
            .catch(err => {
                console.error("Login error:", err);
                alert("Failed to connect to backend server.");
            });
        });
    }

    // Logout Click
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            fetch('/api/logout', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Show login overlay
                    lockScreen.classList.add('active');
                    loginCard.classList.remove('hidden');
                    setupCard.classList.add('hidden');
                    
                    // Hide header elements
                    document.getElementById('global-auth-badge').classList.add('hidden');
                    btnLogout.classList.add('hidden');
                    
                    // Clear displays
                    document.getElementById('vault-items-body').innerHTML = "";
                    document.getElementById('log-entries-body').innerHTML = "";
                    
                    // Clear lock tab if hidden
                    const lockTab = document.querySelector('.nav-item[data-tab="lock"]');
                    if (lockTab) lockTab.classList.remove('hidden');
                    
                    switchTab('vault');
                }
            })
            .catch(err => console.error("Logout error:", err));
        });
    }
}
