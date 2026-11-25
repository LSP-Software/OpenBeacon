import { describe, expect, test } from "bun:test";
import {
  type CrashAlertMessage,
  decodeCrashAlert,
  ENCRYPTED_CRASH_ALERT_LENGTH,
  EpochKeyMaterial,
  encodeCrashAlert,
  openCrashAlert,
  sealCrashAlert,
} from "./index.ts";

const crash: CrashAlertMessage = {
  type: "CRASH",
  messageId: "0123456789abcdef0123456789abcdef",
  alertId: "0123456789abcdef0123456789abcdef",
  crash: {
    time: 1_795_975_440_000,
    latitude: 51.6512345,
    longitude: -0.2001234,
    speedBefore: 18.78,
  },
  sharingUntil: 1_795_976_400_000,
  okAt: null,
  placeLabel: "Barnet Lane, EN5",
};

const ok: CrashAlertMessage = {
  ...crash,
  type: "OK",
  messageId: "fedcba9876543210fedcba9876543210",
  okAt: 1_795_975_740_000,
};

const metadata = {
  epochId: "epoch_1",
  groupId: "group_1",
  senderDeviceId: "device_1",
};

const epochKey = () => new EpochKeyMaterial(new Uint8Array(32).fill(7));

describe("crash alert messages", () => {
  test("a crash alert and its OK follow-up survive encoding unchanged", () => {
    expect(decodeCrashAlert(encodeCrashAlert(crash))).toEqual(crash);
    expect(decodeCrashAlert(encodeCrashAlert(ok))).toEqual(ok);
  });

  test("every message is the same size whatever the place label", () => {
    const sizes = [null, "A", "Barnet Lane, EN5", "x".repeat(200)].map(
      (placeLabel) =>
        sealCrashAlert({ ...metadata, epochKey: epochKey(), message: { ...crash, placeLabel } })
          .ciphertext.length,
    );
    expect(new Set(sizes).size).toBe(1);
    const sealed = sealCrashAlert({ ...metadata, epochKey: epochKey(), message: crash });
    expect(Buffer.from(sealed.ciphertext, "base64").length).toBe(ENCRYPTED_CRASH_ALERT_LENGTH);
  });

  test("a long place label is cut at a character boundary, never mid-letter", () => {
    const label = `${"é".repeat(40)}`;
    const decoded = decodeCrashAlert(encodeCrashAlert({ ...crash, placeLabel: label }));
    expect(decoded.placeLabel).toBe("é".repeat(32));
  });

  test("members open the alert with the Epoch key and the same metadata", () => {
    const sealed = sealCrashAlert({ ...metadata, epochKey: epochKey(), message: crash });
    expect(openCrashAlert({ ...metadata, epochKey: epochKey(), sealed })).toEqual(crash);
  });

  test("a server that moves an alert to another group, epoch, device or message can't get it read", () => {
    const sealed = sealCrashAlert({ ...metadata, epochKey: epochKey(), message: crash });
    const swaps = [
      { ...metadata, groupId: "group_2" },
      { ...metadata, epochId: "epoch_2" },
      { ...metadata, senderDeviceId: "device_2" },
    ];
    for (const swapped of swaps) {
      expect(() => openCrashAlert({ ...swapped, epochKey: epochKey(), sealed })).toThrow(
        "Unreadable crash alert.",
      );
    }
    expect(() =>
      openCrashAlert({
        ...metadata,
        epochKey: epochKey(),
        sealed: { ...sealed, messageId: ok.messageId },
      }),
    ).toThrow("Unreadable crash alert.");
  });

  test("a drive record can't be passed off as a crash alert", () => {
    const sealed = sealCrashAlert({ ...metadata, epochKey: epochKey(), message: crash });
    expect(() =>
      openCrashAlert({
        ...metadata,
        epochKey: new EpochKeyMaterial(new Uint8Array(32).fill(8)),
        sealed,
      }),
    ).toThrow("Unreadable crash alert.");
  });

  test("refuses messages that don't make sense", () => {
    const invalid = [
      { ...crash, okAt: 1 },
      { ...ok, okAt: null },
      { ...crash, alertId: ok.messageId },
      { ...crash, messageId: "not-hex" },
      { ...crash, crash: { ...crash.crash, latitude: 91 } },
      { ...crash, crash: { ...crash.crash, speedBefore: -1 } },
    ];
    for (const message of invalid) {
      expect(() => encodeCrashAlert(message)).toThrow("Invalid crash alert.");
    }
    const bytes = encodeCrashAlert(crash);
    bytes[bytes.length - 1] = 1;
    expect(() => decodeCrashAlert(bytes)).toThrow("Invalid crash alert.");
  });
});
