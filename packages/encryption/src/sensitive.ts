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
