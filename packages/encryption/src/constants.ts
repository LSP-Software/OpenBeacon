export const DEVICE_KEY_ALGORITHM = "X25519" as const;
export const PAYLOAD_ENCRYPTION_ALGORITHM = "XChaCha20-Poly1305" as const;
export const WRAPPED_EPOCH_KEY_ALGORITHM = "X25519+HKDF-SHA-256+XChaCha20-Poly1305" as const;

export const GROUP_EPOCH_KEY_LENGTH = 32;
export const XCHACHA20_NONCE_LENGTH = 24;
