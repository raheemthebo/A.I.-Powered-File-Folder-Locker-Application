import os
import json
import uuid
import shutil
import hashlib
import base64
import time
from flask import current_app
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

def get_metadata_path():
    from flask import session
    email = session.get('email', 'global')
    import hashlib
    email_hash = hashlib.sha256(email.lower().strip().encode()).hexdigest()[:16]
    return os.path.join(current_app.config['SECURE_DIR'], f"vault_metadata_{email_hash}.json")

def load_metadata():
    path = get_metadata_path()
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_metadata(metadata):
    path = get_metadata_path()
    with open(path, "w") as f:
        json.dump(metadata, f, indent=4)

def hash_password(password: str, salt_hex: str) -> str:
    salt = bytes.fromhex(salt_hex)
    hasher = hashlib.sha256()
    hasher.update(salt)
    hasher.update(password.encode())
    return hasher.hexdigest()

def derive_key(password: str, salt_hex: str) -> bytes:
    salt = bytes.fromhex(salt_hex)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))

def encrypt_item(item_path: str, password: str, delete_original: bool = True) -> tuple[bool, str]:
    """
    Encrypts a file or folder and stores it in the secure vault.
    Returns (success, message).
    """
    if not os.path.exists(item_path):
        return False, "Selected item does not exist."

    is_dir = os.path.isdir(item_path)
    name = os.path.basename(os.path.normpath(item_path))
    temp_zip = None

    try:
        # If it's a directory, zip it first
        if is_dir:
            temp_zip_base = os.path.join(current_app.config['SECURE_DIR'], f"temp_{uuid.uuid4().hex}")
            # shutil.make_archive appends .zip automatically
            temp_zip = shutil.make_archive(temp_zip_base, 'zip', item_path)
            encrypt_target = temp_zip
        else:
            encrypt_target = item_path

        # Read content
        with open(encrypt_target, "rb") as f:
            data = f.read()

        # Security salts
        pwd_salt = os.urandom(16).hex()
        enc_salt = os.urandom(16).hex()
        
        pwd_hash = hash_password(password, pwd_salt)
        key = derive_key(password, enc_salt)

        # Encrypt with Fernet
        fernet = Fernet(key)
        encrypted_data = fernet.encrypt(data)

        # Write to secure vault under unique ID
        item_id = str(uuid.uuid4())
        secure_file_name = f"{item_id}.enc"
        secure_file_path = os.path.join(current_app.config['SECURE_DIR'], secure_file_name)

        with open(secure_file_path, "wb") as f:
            f.write(encrypted_data)

        # Clean up temporary zip if created
        if temp_zip and os.path.exists(temp_zip):
            os.remove(temp_zip)

        # Save metadata
        metadata = load_metadata()
        metadata[item_id] = {
            "name": name,
            "type": "directory" if is_dir else "file",
            "original_path": os.path.abspath(item_path),
            "password_hash": pwd_hash,
            "password_salt": pwd_salt,
            "encryption_salt": enc_salt,
            "locked_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        save_metadata(metadata)

        # Clean up original item
        if delete_original:
            if is_dir:
                shutil.rmtree(item_path)
            else:
                os.remove(item_path)

        return True, f"Successfully locked and encrypted '{name}'."
    except Exception as e:
        # Clean up temp files if exception occurs
        if temp_zip and os.path.exists(temp_zip):
            try:
                os.remove(temp_zip)
            except Exception:
                pass
        return False, f"Encryption failed: {str(e)}"

def decrypt_item(item_id: str, password: str) -> tuple[bool, str]:
    """
    Decrypts a locked item using the password and restores it to its original path.
    Returns (success, message).
    """
    metadata = load_metadata()
    if item_id not in metadata:
        return False, "Item not found in vault metadata."

    info = metadata[item_id]
    original_path = info["original_path"]
    is_dir = (info["type"] == "directory")

    # Verify Password
    expected_hash = info["password_hash"]
    pwd_salt = info["password_salt"]
    if hash_password(password, pwd_salt) != expected_hash:
        return False, "Incorrect Password."

    secure_file_path = os.path.join(current_app.config['SECURE_DIR'], f"{item_id}.enc")
    if not os.path.exists(secure_file_path):
        return False, "Encrypted file is missing from the secure vault."

    temp_zip = None
    try:
        # Derive key and decrypt data
        enc_salt = info["encryption_salt"]
        key = derive_key(password, enc_salt)
        fernet = Fernet(key)

        with open(secure_file_path, "rb") as f:
            encrypted_data = f.read()

        decrypted_data = fernet.decrypt(encrypted_data)

        # Ensure the destination parent directory exists
        dest_dir = os.path.dirname(original_path)
        os.makedirs(dest_dir, exist_ok=True)

        if is_dir:
            # For directories, restore the temporary zip and unpack it
            temp_zip = os.path.join(current_app.config['SECURE_DIR'], f"temp_dec_{item_id}.zip")
            with open(temp_zip, "wb") as f:
                f.write(decrypted_data)
            
            # Unpack zip
            shutil.unpack_archive(temp_zip, original_path, 'zip')
            
            # Clean up temp zip
            os.remove(temp_zip)
        else:
            # For files, write decrypted data directly to destination
            with open(original_path, "wb") as f:
                f.write(decrypted_data)

        # Remove encrypted file and clear metadata entry
        os.remove(secure_file_path)
        del metadata[item_id]
        save_metadata(metadata)

        return True, f"Successfully unlocked and restored '{info['name']}'."
    except Exception as e:
        if temp_zip and os.path.exists(temp_zip):
            try:
                os.remove(temp_zip)
            except Exception:
                pass
        return False, f"Decryption failed: {str(e)}"
