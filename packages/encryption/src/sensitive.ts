export class SensitiveBytes {
  #bytes: Uint8Array;
  #label: string;

  constructor(bytes: Uint8Array, label: string) {
    this.#bytes = Uint8Array.from(bytes);
    this.#label = label;
  }

  expose() {
    return Uint8Array.from(this.#bytes);
  }

  toJSON() {
    return `[REDACTED ${this.#label}]`;
  }

  toString() {
    return `[REDACTED ${this.#label}]`;
  }
}

export class EpochKeyMaterial extends SensitiveBytes {
  constructor(bytes: Uint8Array) {
    super(bytes, "epoch key");
  }
}

export class SensitivePayloadBytes extends SensitiveBytes {
  constructor(bytes: Uint8Array) {
    super(bytes, "payload");
  }
}

export class DevicePrivateKeyMaterial extends SensitiveBytes {
  constructor(bytes: Uint8Array) {
    super(bytes, "device private key");
  }
}

export class RecoveryPhrase extends SensitiveBytes {
  constructor(bytes: Uint8Array) {
    super(bytes, "recovery phrase");
  }

  words() {
    return new TextDecoder().decode(this.expose()).split(" ");
  }
}

export class RecoveryPrivateKeyMaterial extends SensitiveBytes {
  constructor(bytes: Uint8Array) {
    super(bytes, "recovery private key");
  }
}

export class HistoryPrivateKeyMaterial extends SensitiveBytes {
  constructor(bytes: Uint8Array) {
    super(bytes, "history private key");
  }
}
