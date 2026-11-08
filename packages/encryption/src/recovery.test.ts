import { describe, expect, test } from "bun:test";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  deriveRecoveryKeyPair,
  diagnoseRecoveryPhraseInput,
  generateGroupEpochKey,
  generateRecoveryPhrase,
  getHistoryPublicKey,
  HistoryPrivateKeyMaterial,
  openHistoryKeyEscrow,
  parseRecoveryPhrase,
  RecoveryPrivateKeyMaterial,
  sealHistoryKeyEscrow,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
  wrapEpochKeyForRecipient,
  X25519_KEY_ALGORITHM,
} from "./index.ts";

const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const userId = "user_1";

const createEnrolledAccount = () => {
  const recovery = deriveRecoveryKeyPair(generateRecoveryPhrase());
  const history = createHistoryKeyPair();
  const escrow = sealHistoryKeyEscrow({
    historyPrivateKey: history.privateKey,
    recoveryPublicKey: recovery.publicKey,
    userId,
    version: 1,
  });

  return { escrow, history, recovery };
};

const createHistoryWrap = () => {
  const history = createHistoryKeyPair();
  const sender = createDeviceKeyPair();
  const epochKey = generateGroupEpochKey();
  const wrapped = wrapEpochKeyForHistoryKey({
    epochId: "epoch_1",
    epochKey,
    historyKey: { publicKey: history.publicKey, userId, version: 1 },
    senderPrivateKey: sender.privateKey,
  });

  return { epochKey, history, sender, wrapped };
};

describe("recovery phrase", () => {
  test("generates distinct, valid 12 word phrases", () => {
    const first = generateRecoveryPhrase();
    const second = generateRecoveryPhrase();

    expect(first.words()).toHaveLength(12);
    expect(first.words()).not.toEqual(second.words());
    expect(parseRecoveryPhrase(first.words().join(" ")).words()).toEqual(first.words());
  });

  test("accepts phrases with different case, spacing and compatible characters", () => {
    const expected = deriveRecoveryKeyPair(parseRecoveryPhrase(phrase)).publicKey;
    const fullWidthFirstWord = "ｌｅｇａｌ";

    for (const input of [
      phrase.toUpperCase(),
      `  ${phrase.replaceAll(" ", " \t\n ")}  `,
      phrase.replace("legal", fullWidthFirstWord),
    ]) {
      const parsed = parseRecoveryPhrase(input);

      expect(parsed.words().join(" ")).toBe(phrase);
      expect(deriveRecoveryKeyPair(parsed).publicKey).toBe(expected);
    }
  });

  test("rejects a bad checksum, unknown word or wrong length", () => {
    const badChecksum = phrase.replace(/yellow$/, "winner");
    const unknownWord = phrase.replace(/yellow$/, "beacon");
    const twentyFourWords = generateMnemonic(wordlist, 256);

    for (const input of [badChecksum, unknownWord, twentyFourWords, "", phrase.slice(0, -7)]) {
      expect(() => parseRecoveryPhrase(input)).toThrow("Invalid recovery phrase.");
    }
  });

  test("redacts phrases and private keys when serialised", () => {
    const parsed = parseRecoveryPhrase(phrase);
    const recovery = deriveRecoveryKeyPair(parsed);
    const history = createHistoryKeyPair();
    const serialised = JSON.stringify({ parsed, recovery, history });

    expect(serialised).toContain("[REDACTED recovery phrase]");
    expect(serialised).toContain("[REDACTED recovery private key]");
    expect(serialised).toContain("[REDACTED history private key]");
    expect(serialised).not.toContain("legal");
    expect(String(parsed)).toBe("[REDACTED recovery phrase]");
    expect(`${recovery.privateKey}`).toBe("[REDACTED recovery private key]");
    expect(`${history.privateKey}`).toBe("[REDACTED history private key]");
  });
});

describe("history key", () => {
  test("derives the published public key from the private key", () => {
    const history = createHistoryKeyPair();

    expect(history.algorithm).toBe(X25519_KEY_ALGORITHM);
    expect(getHistoryPublicKey(new HistoryPrivateKeyMaterial(history.privateKey.expose()))).toBe(
      history.publicKey,
    );
  });
});

describe("recovery escrow", () => {
  test("restores the history key with the phrase", () => {
    const recoveryPhrase = generateRecoveryPhrase();
    const recovery = deriveRecoveryKeyPair(recoveryPhrase);
    const history = createHistoryKeyPair();
    const escrow = sealHistoryKeyEscrow({
      historyPrivateKey: history.privateKey,
      recoveryPublicKey: recovery.publicKey,
      userId,
      version: 1,
    });
    const restoredRecovery = deriveRecoveryKeyPair(
      parseRecoveryPhrase(recoveryPhrase.words().join(" ")),
    );

    const restored = openHistoryKeyEscrow({
      escrow,
      historyKey: { publicKey: history.publicKey, userId, version: 1 },
      recoveryPrivateKey: restoredRecovery.privateKey,
    });

    expect(restored.expose()).toEqual(history.privateKey.expose());
  });

  test("rejects another phrase, user or version", () => {
    const { escrow, history, recovery } = createEnrolledAccount();
    const historyKey = { publicKey: history.publicKey, userId, version: 1 };

    expect(() =>
      openHistoryKeyEscrow({
        escrow,
        historyKey,
        recoveryPrivateKey: deriveRecoveryKeyPair(generateRecoveryPhrase()).privateKey,
      }),
    ).toThrow();
    expect(() =>
      openHistoryKeyEscrow({
        escrow,
        historyKey: { ...historyKey, userId: "user_2" },
        recoveryPrivateKey: recovery.privateKey,
      }),
    ).toThrow();
    expect(() =>
      openHistoryKeyEscrow({
        escrow,
        historyKey: { ...historyKey, version: 2 },
        recoveryPrivateKey: recovery.privateKey,
      }),
    ).toThrow();
  });

  test("rejects an escrow that doesn't match the published history key", () => {
    const { history, recovery } = createEnrolledAccount();
    const swappedEscrow = sealHistoryKeyEscrow({
      historyPrivateKey: createHistoryKeyPair().privateKey,
      recoveryPublicKey: recovery.publicKey,
      userId,
      version: 1,
    });

    expect(() =>
      openHistoryKeyEscrow({
        escrow: swappedEscrow,
        historyKey: { publicKey: history.publicKey, userId, version: 1 },
        recoveryPrivateKey: recovery.privateKey,
      }),
    ).toThrow("Recovery data doesn't match.");
  });

  test("rejects an escrow that doesn't hold a private key", () => {
    const { history, recovery } = createEnrolledAccount();
    const truncatedEscrow = sealHistoryKeyEscrow({
      historyPrivateKey: new HistoryPrivateKeyMaterial(history.privateKey.expose().slice(1)),
      recoveryPublicKey: recovery.publicKey,
      userId,
      version: 1,
    });

    expect(() =>
      openHistoryKeyEscrow({
        escrow: truncatedEscrow,
        historyKey: { publicKey: history.publicKey, userId, version: 1 },
        recoveryPrivateKey: recovery.privateKey,
      }),
    ).toThrow("Recovery data doesn't match.");
  });

  test("rejects a tampered escrow or unknown algorithm", () => {
    const { escrow, history, recovery } = createEnrolledAccount();
    const historyKey = { publicKey: history.publicKey, userId, version: 1 };
    const tampered = `${escrow.ciphertext.startsWith("A") ? "B" : "A"}${escrow.ciphertext.slice(1)}`;

    expect(() =>
      openHistoryKeyEscrow({
        escrow: { ...escrow, ciphertext: tampered },
        historyKey,
        recoveryPrivateKey: recovery.privateKey,
      }),
    ).toThrow();
    expect(() =>
      openHistoryKeyEscrow({
        escrow: { ...escrow, algorithm: "other" as typeof escrow.algorithm },
        historyKey,
        recoveryPrivateKey: recovery.privateKey,
      }),
    ).toThrow("Unsupported history key escrow algorithm.");
  });

  test("can't be opened with the history key itself", () => {
    const { escrow, history } = createEnrolledAccount();

    expect(() =>
      openHistoryKeyEscrow({
        escrow,
        historyKey: { publicKey: history.publicKey, userId, version: 1 },
        recoveryPrivateKey: new RecoveryPrivateKeyMaterial(history.privateKey.expose()),
      }),
    ).toThrow();
  });
});

describe("history wrap", () => {
  test("round trips an epoch key", () => {
    const { epochKey, history, sender, wrapped } = createHistoryWrap();

    expect(wrapped.senderPublicKey).toBe(sender.publicKey);
    expect(
      unwrapHistoryEpochKey({
        epochId: "epoch_1",
        historyKeyVersion: 1,
        historyPrivateKey: history.privateKey,
        userId,
        wrappedEpochKey: wrapped,
      }).expose(),
    ).toEqual(epochKey.expose());
  });

  test("rejects the wrong epoch, user, version or history key", () => {
    const { history, wrapped } = createHistoryWrap();
    const expected = {
      epochId: "epoch_1",
      historyKeyVersion: 1,
      historyPrivateKey: history.privateKey,
      userId,
      wrappedEpochKey: wrapped,
    };

    for (const changed of [
      { epochId: "epoch_2" },
      { userId: "user_2" },
      { historyKeyVersion: 2 },
      { historyPrivateKey: createHistoryKeyPair().privateKey },
    ]) {
      expect(() => unwrapHistoryEpochKey({ ...expected, ...changed })).toThrow();
    }
  });

  test("rejects a swapped sender key", () => {
    const { history, wrapped } = createHistoryWrap();

    expect(() =>
      unwrapHistoryEpochKey({
        epochId: "epoch_1",
        historyKeyVersion: 1,
        historyPrivateKey: history.privateKey,
        userId,
        wrappedEpochKey: { ...wrapped, senderPublicKey: createDeviceKeyPair().publicKey },
      }),
    ).toThrow();
  });

  test("can't be opened as a device wrap", () => {
    const { history, wrapped } = createHistoryWrap();

    expect(() =>
      unwrapEpochKey({
        recipientDeviceId: userId,
        recipientPrivateKey: new DevicePrivateKeyMaterial(history.privateKey.expose()),
        wrappedEpochKey: { ...wrapped, createdAt: new Date(), recipientDeviceId: userId },
      }),
    ).toThrow();
  });

  test("a device wrap can't be opened as a history wrap", () => {
    const history = createHistoryKeyPair();
    const sender = createDeviceKeyPair();
    const deviceWrap = wrapEpochKeyForRecipient({
      epoch: {
        createdAt: new Date(),
        createdByDeviceId: "device_sender",
        epochId: "epoch_1",
        epochNumber: 1,
        groupId: "group_1",
      },
      epochKey: generateGroupEpochKey(),
      recipient: {
        algorithm: DEVICE_KEY_ALGORITHM,
        createdAt: new Date(),
        deviceId: userId,
        publicKey: history.publicKey,
        revokedAt: null,
        userId,
      },
      senderPrivateKey: sender.privateKey,
    });

    expect(() =>
      unwrapHistoryEpochKey({
        epochId: "epoch_1",
        historyKeyVersion: 1,
        historyPrivateKey: history.privateKey,
        userId,
        wrappedEpochKey: deviceWrap,
      }),
    ).toThrow();
  });
});

describe("diagnoseRecoveryPhraseInput", () => {
  test("reports no problem for a valid phrase in any casing or spacing", () => {
    expect(
      diagnoseRecoveryPhraseInput(`  ${phrase.toUpperCase().replaceAll(" ", "\n ")} `),
    ).toEqual({
      problem: null,
    });
  });

  test("reports the word count when it isn't 12", () => {
    expect(diagnoseRecoveryPhraseInput("")).toEqual({ count: 0, problem: "wrong-word-count" });
    expect(diagnoseRecoveryPhraseInput("legal winner thank")).toEqual({
      count: 3,
      problem: "wrong-word-count",
    });
    expect(diagnoseRecoveryPhraseInput(`${phrase} legal`)).toEqual({
      count: 13,
      problem: "wrong-word-count",
    });
  });

  test("reports the 1-based positions of words outside the word list", () => {
    const words = phrase.split(" ");
    words[3] = "yeer";
    words[8] = "legall";
    expect(diagnoseRecoveryPhraseInput(words.join(" "))).toEqual({
      positions: [4, 9],
      problem: "unknown-words",
    });
  });

  test("reports a checksum failure when every word is valid", () => {
    const words = phrase.split(" ");
    words[11] = "legal";
    expect(diagnoseRecoveryPhraseInput(words.join(" "))).toEqual({ problem: "invalid-checksum" });
  });

  test("agrees with parseRecoveryPhrase about what is valid", () => {
    const words = phrase.split(" ");
    words[11] = "legal";
    const invalid = words.join(" ");
    expect(() => parseRecoveryPhrase(invalid)).toThrow();
    expect(diagnoseRecoveryPhraseInput(invalid).problem).not.toBeNull();
    expect(() => parseRecoveryPhrase(phrase)).not.toThrow();
    expect(diagnoseRecoveryPhraseInput(phrase).problem).toBeNull();
  });
});
