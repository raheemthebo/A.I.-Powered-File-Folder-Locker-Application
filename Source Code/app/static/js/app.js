
// ==========================================
// Global State Variables
let selectedItemId = null;
let passwordModalOpenTime = null;
let biometricPollInterval = null;
let isCameraActive = false;

// Page Load Setup
document.addEventListener('DOMContentLoaded', () => {
    initDragAndDrop();
    initFileBrowsing();
    initPasswordAnalyzer();
    initLocker();
    initLockResetAndCancelHandlers();
    initBiometricRegistration();
    initAuth();
    
    // Initial data load only if session is already active (e.g. reload after logging in)
    const lockScreen = document.getElementById('lock-screen-container');
    if (lockScreen && !lockScreen.classList.contains('active')) {
        const view = document.getElementById('jumpshare-dashboard-view');
        if (view) view.classList.remove('hidden');
        const headerControls = document.getElementById('dashboard-header-controls');
        if (headerControls) headerControls.classList.remove('hidden');
        
        loadVault();
        loadLogs();
        checkBiometricStatus();
    }
});

// ==========================================
// 1. DRAG AND DROP & ACCORDIONS INTEGRATION
// ==========================================
function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone-container');
    
    if (!dropZone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            handleSelectedTarget(files[0].name, 'file');
        }
    });
}

// Global Accordion Controller
window.toggleAccordion = function(id) {
    const content = document.getElementById(id);
    const card = content.closest('.accordion-card');
    
    if (card.classList.contains('active')) {
        card.classList.remove('active');
        content.style.maxHeight = null;
    } else {
        // Close others
        document.querySelectorAll('.accordion-card').forEach(c => {
            c.classList.remove('active');
            const cnt = c.querySelector('.accordion-content');
            if (cnt) cnt.style.maxHeight = null;
        });
        
        card.classList.add('active');
        content.style.maxHeight = content.scrollHeight + "px";
        
        if (id === 'acc-biometrics') {
            checkBiometricStatus();
        } else if (id === 'acc-security-logs') {
            loadLogs();
        }
    }
};

// Handle transitions when file/folder is selected
function handleSelectedTarget(path, type) {
    const readyState = document.getElementById('drop-zone-ready');
    const formState = document.getElementById('drop-zone-form');
    const successState = document.getElementById('drop-zone-success');
    
    const hiddenPath = document.getElementById('target-path');
    const pathText = document.getElementById('selected-item-path');
    const nameText = document.getElementById('selected-item-name');
    const iconEl = document.getElementById('selected-item-icon');
    
    // Set paths
    hiddenPath.value = path;
    pathText.innerText = path;
    
    // Extract base name
    const parts = path.split(/[\\/]/);
    nameText.innerText = parts[parts.length - 1] || path;
    
    // Icon configurations
    if (type === 'directory') {
        iconEl.className = "fa-solid fa-folder-closed text-orange";
    } else {
        iconEl.className = "fa-solid fa-file-shield text-blue";
    }
    
    // Switch states
    readyState.classList.add('hidden');
    successState.classList.add('hidden');
    formState.classList.remove('hidden');
    
    validateLockForm();
}

function initLockResetAndCancelHandlers() {
    const cancelBtn = document.getElementById('btn-lock-cancel');
    const resetBtn = document.getElementById('btn-lock-reset');
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            resetLockForm();
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetLockForm();
        });
    }
}

// ==========================================
// 2. NATIVE FILE BROWSING INTEGRATION
// ==========================================
function initFileBrowsing() {
    const fileBtn = document.getElementById('btn-browse-file');
    const folderBtn = document.getElementById('btn-browse-folder');
    const webFilePicker = document.getElementById('web-file-picker');

    const isCloud = window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost';

    const triggerBrowse = (mode) => {
        fetch(`/api/browse?mode=${mode}`)
            .then(res => res.json())
            .then(data => {
                if (data.path) {
                    handleSelectedTarget(data.path, mode === 'folder' ? 'directory' : 'file');
                }
            })
            .catch(err => {
                console.error("Browse failed:", err);
                alert("Could not trigger file selection dialogue. You can type the path manually.");
            });
    };

    if (fileBtn) {
        fileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isCloud) {
                webFilePicker.click();
            } else {
                triggerBrowse('file');
            }
        });
    }

    if (folderBtn) {
        folderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isCloud) {
                alert("Folder selection is only supported in local desktop mode. Please select a file instead.");
            } else {
                triggerBrowse('folder');
            }
        });
    }

    if (webFilePicker) {
        webFilePicker.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleSelectedTarget(file.name, 'file');
            }
        });
    }
}

// ==========================================
// 3. AI PASSWORD STRENGTH CLASSIFIER
// ==========================================
function initPasswordAnalyzer() {
    const passwordInput = document.getElementById('lock-password');
    let debounceTimer;

    if (!passwordInput) return;

    passwordInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const password = e.target.value;
        
        if (!password) {
            updatePasswordUI({
                strength: "Enter Password",
                score: 0,
                suggestions: []
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
    const fill = document.getElementById('strength-bar-fill');
    const label = document.getElementById('strength-label');
    const badge = document.getElementById('classification-badge');

    if (!fill || !label || !badge) return;

    fill.style.width = `${data.score}%`;
    label.innerText = `Password Strength: ${data.strength} (${data.score}%)`;
    badge.innerText = data.strength;

    fill.className = "strength-bar-fill";
    badge.className = "classification-badge";
    
    if (data.strength === "Weak") {
        fill.classList.add('weak');
        badge.classList.add('weak');
    } else if (data.strength === "Medium") {
        fill.classList.add('medium');
        badge.classList.add('medium');
    } else {
        fill.classList.add('strong');
        badge.classList.add('strong');
    }
}

// ==========================================
// 4. LOCK FILE / FOLDER OPERATIONS
// ==========================================
function initLocker() {
    const lockSubmitBtn = document.getElementById('btn-lock-submit');
    if (!lockSubmitBtn) return;
    
    lockSubmitBtn.addEventListener('click', () => {
        const path = document.getElementById('target-path').value;
        const password = document.getElementById('lock-password').value;
        const deleteOriginal = document.getElementById('delete-original').checked;

        if (!path || !password) return;

        lockSubmitBtn.disabled = true;
        lockSubmitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Securing Vault...`;

        fetch('/api/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, password, delete_original: deleteOriginal })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Transition to success state card
                const parts = path.split(/[\\/]/);
                document.getElementById('success-item-name').innerText = parts[parts.length - 1] || path;
                
                document.getElementById('drop-zone-ready').classList.add('hidden');
                document.getElementById('drop-zone-form').classList.add('hidden');
                document.getElementById('drop-zone-success').classList.remove('hidden');
                
                loadVault();
                loadLogs();
            } else {
                alert("Error: " + data.message);
                lockSubmitBtn.disabled = false;
                lockSubmitBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Secure & Lock`;
            }
        })
        .catch(err => {
            console.error("Locking failed:", err);
            alert("Error connecting to server.");
            lockSubmitBtn.disabled = false;
            lockSubmitBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Secure & Lock`;
        });
    });
}

function validateLockForm() {
    const path = document.getElementById('target-path').value;
    const password = document.getElementById('lock-password').value;
    const submitBtn = document.getElementById('btn-lock-submit');

    if (!submitBtn) return;

    if (path && password.length >= 4) {
        submitBtn.disabled = false;
    } else {
        submitBtn.disabled = true;
    }
}

function resetLockForm() {
    const readyState = document.getElementById('drop-zone-ready');
    const formState = document.getElementById('drop-zone-form');
    const successState = document.getElementById('drop-zone-success');
    
    document.getElementById('target-path').value = "";
    document.getElementById('lock-password').value = "";
    if (document.getElementById('lock-decoy-password')) {
        document.getElementById('lock-decoy-password').value = "";
    }
    document.getElementById('delete-original').checked = true;
    
    readyState.classList.remove('hidden');
    formState.classList.add('hidden');
    successState.classList.add('hidden');
    
    updatePasswordUI({
        strength: "Enter Password",
        score: 0,
        suggestions: []
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
    const lockScreen = document.getElementById('lock-screen-container');
    
    // Cards
    const emailCard = document.getElementById('auth-email-card');
    const passwordCard = document.getElementById('auth-password-card');
    const otpCard = document.getElementById('auth-otp-card');
    const setupCard = document.getElementById('auth-setup-card');

    // Inputs
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const otpInput = document.getElementById('auth-otp-code');
    const masterInput = document.getElementById('setup-master-password');
    const decoyInput = document.getElementById('setup-decoy-password');

    // State variables
    let currentEmail = "";
    let isSignUpMode = false;

    // Show single card helper
    function showCard(activeCard) {
        [emailCard, passwordCard, otpCard, setupCard].forEach(card => {
            if (card) card.classList.add('hidden');
        });
        if (activeCard) activeCard.classList.remove('hidden');
    }

    // Toggle Sign-In vs Sign-Up modes dynamically
    function bindToggleAuthMode() {
        const toggleLink = document.getElementById('link-toggle-auth-mode');
        const toggleParagraph = document.getElementById('auth-mode-toggle-paragraph');
        const authTitle = document.getElementById('auth-email-title');
        const authSubtitle = document.getElementById('auth-email-subtitle');
        const authLabel = document.getElementById('lbl-auth-email');

        if (toggleLink) {
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                isSignUpMode = !isSignUpMode;
                
                if (isSignUpMode) {
                    authTitle.innerText = "Create Account";
                    authSubtitle.innerText = "Register your email address to initialize your secure vault.";
                    authLabel.innerText = "Register email address";
                    toggleParagraph.innerHTML = 'Already have an account? <a href="#" id="link-toggle-auth-mode" style="color: var(--neon-blue); text-decoration: none;">Sign In</a>';
                } else {
                    authTitle.innerText = "Sign in to AI Locker";
                    authSubtitle.innerText = "Enter your email address to initialize or load your secure vault.";
                    authLabel.innerText = "Username or email address";
                    toggleParagraph.innerHTML = 'Don\'t have an account? <a href="#" id="link-toggle-auth-mode" style="color: var(--neon-blue); text-decoration: none;">Create Account</a>';
                }
                
                bindToggleAuthMode();
            });
        }
    }
    bindToggleAuthMode();

    // Go back to Email screen
    const backFromPwd = document.getElementById('btn-back-to-email-from-pwd');
    if (backFromPwd) {
        backFromPwd.addEventListener('click', (e) => {
            e.preventDefault();
            showCard(emailCard);
        });
    }
    const backFromOtp = document.getElementById('btn-back-to-email-from-otp');
    if (backFromOtp) {
        backFromOtp.addEventListener('click', (e) => {
            e.preventDefault();
            showCard(emailCard);
        });
    }

    // Step 1: Email Address Verification Click
    const btnEmailNext = document.getElementById('btn-auth-email-next');
    if (btnEmailNext) {
        btnEmailNext.addEventListener('click', () => {
            const email = emailInput.value.trim();
            const alertBox = document.getElementById('email-error-alert');
            const alertMsg = document.getElementById('email-error-msg');
            
            if (!email || !email.includes('@')) {
                alertMsg.innerText = "Please enter a valid email address.";
                alertBox.classList.remove('hidden');
                return;
            }
            alertBox.classList.add('hidden');
            
            fetch('/api/auth/check_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, is_signup: isSignUpMode })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    currentEmail = email;
                    if (data.registered) {
                        // User exists: transition to Password view
                        document.getElementById('lbl-password-email').innerText = email;
                        passwordInput.value = "";
                        showCard(passwordCard);
                    } else {
                        // User is new: transition to OTP verification view
                        document.getElementById('lbl-otp-email').innerText = email;
                        otpInput.value = "";
                        showCard(otpCard);
                    }
                } else {
                    alertMsg.innerText = data.message;
                    alertBox.classList.remove('hidden');
                }
            })
            .catch(err => {
                console.error("Check email error:", err);
                alert("Failed to connect to backend server.");
            });
        });
    }

    // Step 2: Password Login Submit
    const btnPwdSubmit = document.getElementById('btn-auth-password-submit');
    if (btnPwdSubmit) {
        btnPwdSubmit.addEventListener('click', () => {
            const password = passwordInput.value;
            const alertBox = document.getElementById('password-error-alert');
            const alertMsg = document.getElementById('password-error-msg');
            
            if (!password) {
                alertMsg.innerText = "Password cannot be empty.";
                alertBox.classList.remove('hidden');
                return;
            }
            alertBox.classList.add('hidden');
            
            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentEmail, password })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    if (data.face_required) {
                        showCard(emailCard); // Hide modal overlay internally
                        lockScreen.classList.add('active'); // Keep screen container backdrop active
                        // Open biometric Verification popup
                        openBiometricVerificationForLogin(data.auth_level);
                    } else {
                        handleSuccessfulLogin(data);
                    }
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

    // Step 3: OTP Code verification
    const btnOtpSubmit = document.getElementById('btn-auth-otp-submit');
    if (btnOtpSubmit) {
        btnOtpSubmit.addEventListener('click', () => {
            const otp = otpInput.value.trim();
            const alertBox = document.getElementById('otp-error-alert');
            const alertMsg = document.getElementById('otp-error-msg');
            
            if (!otp || otp.length < 6) {
                alertMsg.innerText = "Please enter a 6-digit verification code.";
                alertBox.classList.remove('hidden');
                return;
            }
            alertBox.classList.add('hidden');
            
            fetch('/api/auth/verify_otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentEmail, otp })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // OTP Verified! Show password creation view
                    document.getElementById('lbl-setup-email').innerText = currentEmail;
                    masterInput.value = "";
                    decoyInput.value = "";
                    showCard(setupCard);
                } else {
                    alertMsg.innerText = data.message;
                    alertBox.classList.remove('hidden');
                }
            })
            .catch(err => {
                console.error("Verify OTP error:", err);
                alert("Failed to verify code.");
            });
        });
    }

    // Step 4: Register & Setup Submit
    const btnSetupSubmit = document.getElementById('btn-auth-setup-submit');
    if (btnSetupSubmit) {
        btnSetupSubmit.addEventListener('click', () => {
            const master = masterInput.value;
            const decoy = decoyInput.value;
            const alertBox = document.getElementById('setup-error-alert');
            const alertMsg = document.getElementById('setup-error-msg');
            
            if (!master || !decoy) {
                alertMsg.innerText = "Master and Decoy passwords cannot be empty.";
                alertBox.classList.remove('hidden');
                return;
            }
            if (master === decoy) {
                alertMsg.innerText = "Master and Decoy passwords must be different.";
                alertBox.classList.remove('hidden');
                return;
            }
            alertBox.classList.add('hidden');
            
            fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentEmail, master_password: master, decoy_password: decoy })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert("Account registered and initialized successfully!");
                    // Log in automatically
                    handleSuccessfulLogin({ success: true, auth_level: 'master' });
                } else {
                    alertMsg.innerText = data.message;
                    alertBox.classList.remove('hidden');
                }
            })
            .catch(err => {
                console.error("Setup error:", err);
                alert("Failed to initialize account.");
            });
        });
    }

    // Helper to complete login after auth checks clear
    function handleSuccessfulLogin(data) {
        lockScreen.classList.remove('active');
        
        // Show global elements
        const view = document.getElementById('jumpshare-dashboard-view');
        if (view) view.classList.remove('hidden');
        const headerControls = document.getElementById('dashboard-header-controls');
        if (headerControls) headerControls.classList.remove('hidden');
        
        // Configure auth level visual
        const authBadge = document.getElementById('global-auth-badge');
        const authSpan = authBadge.querySelector('span');
        const authIcon = authBadge.querySelector('i');
        
        authBadge.className = "auth-badge " + data.auth_level;
        if (data.auth_level === 'decoy') {
            authSpan.innerText = "Decoy Mode";
            authIcon.className = "fa-solid fa-mask";
            document.getElementById('btn-browse-folder').classList.add('hidden');
            document.getElementById('btn-browse-file').classList.add('hidden');
            document.getElementById('drop-zone-ready').querySelector('.drop-zone-text').innerText = "Vault is in Read-Only Decoy mode.";
        } else {
            authSpan.innerText = "Master Mode";
            authIcon.className = "fa-solid fa-user-gear";
            document.getElementById('btn-browse-folder').classList.remove('hidden');
            document.getElementById('btn-browse-file').classList.remove('hidden');
            document.getElementById('drop-zone-ready').querySelector('.drop-zone-text').innerText = "or, drop items here";
        }
        
        // Clean fields
        emailInput.value = "";
        passwordInput.value = "";
        otpInput.value = "";
        masterInput.value = "";
        decoyInput.value = "";
        
        // Return view state to Step 1
        showCard(emailCard);
        
        // Load data
        loadVault();
        loadLogs();
        checkBiometricStatus();
    }

    // Helper for biometric verification login loop
    function openBiometricVerificationForLogin(authLevel) {
        const modal = document.getElementById('modal-bio-verify');
        const stream = document.getElementById('bio-verify-stream');
        const label = document.getElementById('verify-overlay-lbl');
        const fill = document.getElementById('verify-progress-fill');
        const statsLbl = document.getElementById('verify-stats-lbl');
        
        label.innerText = "Activating Webcam...";
        fill.style.width = "0%";
        statsLbl.innerText = "Connecting camera...";
        
        modal.classList.add('active');
        stream.src = "/video_feed?mode=verify";
        
        biometricPollInterval = setInterval(() => {
            fetch('/api/biometrics/status')
                .then(res => res.json())
                .then(status => {
                    if (status.camera_error) {
                        clearInterval(biometricPollInterval);
                        stream.src = "";
                        modal.classList.remove('active');
                        alert("Webcam connection failed. Bypassing face ID biometrics and logging in directly.");
                        handleSuccessfulLogin({ success: true, auth_level: authLevel });
                        return;
                    }
                    
                    const progress = (status.frames_checked / 40) * 100;
                    fill.style.width = `${progress}%`;
                    label.innerText = `Analyzing: ${status.success_count} matches`;
                    statsLbl.innerText = `Frames evaluated: ${status.frames_checked}/40 (Looking for 12 profile matches)`;
                    
                    if (status.finished) {
                        clearInterval(biometricPollInterval);
                        stream.src = "";
                        modal.classList.remove('active');
                        
                        if (status.success) {
                            handleSuccessfulLogin({ success: true, auth_level: authLevel });
                        } else {
                            alert("Face recognition failed to verify user identity. Access denied.");
                            fetch('/api/logout', { method: 'POST' }).then(() => {
                                showCard(emailCard);
                            });
                        }
                    }
                })
                .catch(err => {
                    console.error("Biometric poll error:", err);
                    clearInterval(biometricPollInterval);
                });
        }, 500);
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
                    showCard(emailCard);
                    
                    // Hide dashboard elements
                    const view = document.getElementById('jumpshare-dashboard-view');
                    if (view) view.classList.add('hidden');
                    const headerControls = document.getElementById('dashboard-header-controls');
                    if (headerControls) headerControls.classList.add('hidden');
                    
                    // Clear displays
                    document.getElementById('vault-items-body').innerHTML = "";
                    document.getElementById('log-entries-body').innerHTML = "";
                    
                    // Reset lock form
                    resetLockForm();
                }
            })
            .catch(err => console.error("Logout error:", err));
        });
    }
}

// ==========================================
// 9. OAUTH LOGIN TRIGGERS (GOOGLE / APPLE)
// ==========================================
function triggerGoogleAuth() {
    const width = 500;
    const height = 620;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    
    window.open('/api/auth/google', 'Google Sign-In', `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`);
}

function triggerAppleAuth() {
    alert("Apple Sign-In is only supported on iOS devices in production mode. Falling back to Google Login.");
}

// Global callback triggered by OAuth popup upon successful authentication
window.handleOauthLoginSuccess = function(data) {
    const lockScreen = document.getElementById('lock-screen-container');
    if (lockScreen) lockScreen.classList.remove('active');
    
    // Show navigation controls
    const view = document.getElementById('jumpshare-dashboard-view');
    if (view) view.classList.remove('hidden');
    const headerControls = document.getElementById('dashboard-header-controls');
    if (headerControls) headerControls.classList.remove('hidden');
    
    // Configure visual mode
    const authBadge = document.getElementById('global-auth-badge');
    const authSpan = authBadge.querySelector('span');
    const authIcon = authBadge.querySelector('i');
    
    authBadge.className = "auth-badge master";
    authSpan.innerText = "Master Mode";
    authIcon.className = "fa-solid fa-user-gear";
    document.getElementById('btn-browse-folder').classList.remove('hidden');
    document.getElementById('btn-browse-file').classList.remove('hidden');
    document.getElementById('drop-zone-ready').querySelector('.drop-zone-text').innerText = "or, drop items here";
    
    // Clear forms
    document.getElementById('auth-password').value = "";
    document.getElementById('auth-email').value = "";
    
    // Refresh content feeds
    loadVault();
    loadLogs();
    checkBiometricStatus();
};
