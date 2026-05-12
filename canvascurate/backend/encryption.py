import os
import base64
from cryptography.fernet import Fernet


def _get_fernet() -> Fernet:
    key_hex = os.getenv("ENCRYPTION_KEY", "")
    if not key_hex:
        raise RuntimeError("ENCRYPTION_KEY not set")
    key_bytes = bytes.fromhex(key_hex)
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()
