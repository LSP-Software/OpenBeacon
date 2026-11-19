import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  decryptGroupPayload,
  deriveRecoveryKeyPair,
  type DeviceKeyPair,
  encodeBase64,
  encodeTrackingPoint,
  encryptGroupPayload,
  type EpochKeyMaterial,
  type GroupEpoch,
  generateRecoveryPhrase,
  type HistoryPublicKey,
  openDeviceLinkHandover,
  openHistoryKeyEscrow,
  openPersonalData,
  sealDeviceLinkHandover,
  sealHistoryKeyEscrow,
  sealPersonalDataForHistoryKey,
  serializeRecipientPublicKeyMaterial,
  TRACKING_POINT_KIND,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  type WrappedEpochKey,
  wrapEpochKeyForHistoryKey,
} from "../index.ts";

const people = {
  alice: createDeviceKeyPair(),
  bob: createDeviceKeyPair(),
  carol: createDeviceKeyPair(),
  dave: createDeviceKeyPair(),
};
type Person = keyof typeof people;

const recipientsFor = (names: Person[]) =>
  names.map((name) =>
    serializeRecipientPublicKeyMaterial({
      algorithm: "X25519",
      createdAt: "2026-11-19T00:00:00.000Z",
      deviceId: `${name}-phone`,
      publicKey: people[name].publicKey,
      revokedAt: null,
      userId: name,
    }),
  );

const creator = (name: Person) => ({
  deviceId: `${name}-phone`,
  privateKey: people[name].privateKey,
});

const tryUnwrap = (name: Person, wraps: WrappedEpochKey[]) => {
  const wrap = wraps.find((candidate) => candidate.recipientDeviceId === `${name}-phone`);
  if (!wrap) return null;
  return unwrapEpochKey({
    recipientDeviceId: `${name}-phone`,
    recipientPrivateKey: people[name].privateKey,
    wrappedEpochKey: wrap,
  });
};

const locationAt = (time: number) =>
  encodeTrackingPoint({
    accuracy: 5,
    battery: { charging: false, level: 50 },
    latitude: 51.5,
    longitude: -0.12,
    speed: null,
    stayUntil: null,
    time,
  });

const upload = (epoch: GroupEpoch, epochKey: EpochKeyMaterial, sender: Person, time: number) =>
  encryptGroupPayload({
    epochId: epoch.epochId,
    epochKey,
    groupId: epoch.groupId,
    kind: TRACKING_POINT_KIND,
    payload: locationAt(time),
    senderDeviceId: `${sender}-phone`,
  });

const read = (
  payload: ReturnType<typeof upload>,
  epochKey: EpochKeyMaterial | null,
  epochId = payload.epochId,
) => {
  if (!epochKey) throw new Error("No epoch key.");
  return decryptGroupPayload({
    encryptedPayload: { ...payload, epochId },
    epochKey,
    expectedMetadata: {
      epochId,
      groupId: payload.groupId,
      kind: TRACKING_POINT_KIND,
      senderDeviceId: payload.senderDeviceId,
    },
  }).bytes.expose();
};

const sameKey = (left: EpochKeyMaterial | null, right: EpochKeyMaterial) =>
  left !== null && encodeBase64(left.expose()) === encodeBase64(right.expose());

describe("group epoch rotation", () => {
  const first = createInitialGroupEpoch({
    creator: creator("alice"),
    groupId: "group-1",
    recipients: recipientsFor(["alice", "bob", "carol"]),
  });
  const second = createNextGroupEpoch({
    creator: creator("bob"),
    previousEpoch: first.epoch,
    recipients: recipientsFor(["alice", "bob", "dave"]),
  });
  const third = createNextGroupEpoch({
    creator: creator("alice"),
    previousEpoch: second.epoch,
    recipients: recipientsFor(["alice", "bob", "dave"]),
  });

  test("an upload sealed just before a rotation still opens with the epoch it was sealed under", () => {
    const inFlight = upload(first.epoch, first.epochKey, "carol", 1_000);

    expect(read(inFlight, tryUnwrap("bob", first.wrappedKeys))).toEqual(locationAt(1_000));
    expect(() => read(inFlight, tryUnwrap("bob", second.wrappedKeys))).toThrow();
    expect(() =>
      read(inFlight, tryUnwrap("bob", second.wrappedKeys), second.epoch.epochId),
    ).toThrow();
  });

  test("an upload sealed under a stale epoch can't be relabelled into the new one", () => {
    const stale = upload(first.epoch, first.epochKey, "alice", 2_000);

    expect(() => read(stale, second.epochKey, second.epoch.epochId)).toThrow();
    expect(() => read(stale, first.epochKey, second.epoch.epochId)).toThrow();
  });

  test("a removed member has no wrap for the next epoch and their old key opens nothing in it", () => {
    const carolOld = tryUnwrap("carol", first.wrappedKeys);
    const afterRemoval = upload(second.epoch, second.epochKey, "alice", 3_000);

    expect(tryUnwrap("carol", second.wrappedKeys)).toBeNull();
    expect(() => read(afterRemoval, carolOld)).toThrow();
    expect(() => read(afterRemoval, carolOld, first.epoch.epochId)).toThrow();
  });

  test("a removed member's private key can't open a wrap made for someone else", () => {
    for (const wrap of second.wrappedKeys) {
      expect(() =>
        unwrapEpochKey({
          recipientDeviceId: wrap.recipientDeviceId,
          recipientPrivateKey: people.carol.privateKey,
          wrappedEpochKey: wrap,
        }),
      ).toThrow();
    }
  });

  test("someone who joins after a rotation reads the new epoch but not the old one", () => {
    const before = upload(first.epoch, first.epochKey, "alice", 4_000);
    const after = upload(second.epoch, second.epochKey, "alice", 5_000);
    const daveKey = tryUnwrap("dave", second.wrappedKeys);

    expect(tryUnwrap("dave", first.wrappedKeys)).toBeNull();
    expect(read(after, daveKey)).toEqual(locationAt(5_000));
    expect(() => read(before, daveKey)).toThrow();
    expect(() => read(before, daveKey, second.epoch.epochId)).toThrow();
  });

  test("each epoch key is independent, so a missing middle epoch doesn't stop the others opening", () => {
    const one = upload(first.epoch, first.epochKey, "alice", 6_000);
    const two = upload(second.epoch, second.epochKey, "alice", 7_000);
    const three = upload(third.epoch, third.epochKey, "alice", 8_000);
    const bobFirst = tryUnwrap("bob", first.wrappedKeys);
    const bobThird = tryUnwrap("bob", third.wrappedKeys);

    expect(read(one, bobFirst)).toEqual(locationAt(6_000));
    expect(read(three, bobThird)).toEqual(locationAt(8_000));
    expect(() => read(two, bobFirst)).toThrow();
    expect(() => read(two, bobThird)).toThrow();
    expect(sameKey(bobFirst, second.epochKey)).toBe(false);
    expect(sameKey(bobThird, second.epochKey)).toBe(false);
    expect(third.epoch.epochNumber).toBe(3);
    expect(new Set([first.epoch.epochId, second.epoch.epochId, third.epoch.epochId]).size).toBe(3);
  });

  test("every recipient of an epoch unwraps the same key", () => {
    for (const name of ["alice", "bob", "dave"] as const) {
      expect(sameKey(tryUnwrap(name, third.wrappedKeys), third.epochKey)).toBe(true);
    }
  });
});

describe("History wraps across History key versions", () => {
  const group = createInitialGroupEpoch({
    creator: creator("alice"),
    groupId: "group-1",
    recipients: recipientsFor(["alice", "bob"]),
  });
  const v1 = createHistoryKeyPair();
  const v2 = createHistoryKeyPair();
  const historyKey = (keyPair: typeof v1, version: number): HistoryPublicKey => ({
    publicKey: keyPair.publicKey,
    userId: "bob",
    version,
  });
  const wrapFor = (keyPair: typeof v1, version: number, sender: DeviceKeyPair = people.alice) =>
    wrapEpochKeyForHistoryKey({
      epochId: group.epoch.epochId,
      epochKey: group.epochKey,
      historyKey: historyKey(keyPair, version),
      senderPrivateKey: sender.privateKey,
    });
  const unwrap = (
    wrap: ReturnType<typeof wrapFor>,
    keyPair: typeof v1,
    version: number,
    epochId = group.epoch.epochId,
  ) =>
    unwrapHistoryEpochKey({
      epochId,
      historyKeyVersion: version,
      historyPrivateKey: keyPair.privateKey,
      userId: "bob",
      wrappedEpochKey: wrap,
    });

  test("a wrap to version 1 opens only with version 1's key and number", () => {
    const wrap = wrapFor(v1, 1);

    expect(sameKey(unwrap(wrap, v1, 1), group.epochKey)).toBe(true);
    expect(() => unwrap(wrap, v2, 2)).toThrow();
    expect(() => unwrap(wrap, v1, 2)).toThrow();
    expect(() => unwrap(wrap, v2, 1)).toThrow();
  });

  test("a wrap relabelled to a version it wasn't made for doesn't open", () => {
    const wrap = wrapFor(v1, 1);

    expect(() => unwrap({ ...wrap, historyKeyVersion: 2 }, v1, 2)).toThrow();
  });

  test("a wrap moved to another epoch doesn't open", () => {
    const later = createNextGroupEpoch({
      creator: creator("alice"),
      previousEpoch: group.epoch,
      recipients: recipientsFor(["alice", "bob"]),
    });

    expect(() => unwrap(wrapFor(v1, 1), v1, 1, later.epoch.epochId)).toThrow();
  });
});

describe("History key escrow chain", () => {
  const phrase = generateRecoveryPhrase();
  const recovery = deriveRecoveryKeyPair(phrase);
  const versions = [createHistoryKeyPair(), createHistoryKeyPair(), createHistoryKeyPair()];
  const escrows = versions.map((keyPair, index) =>
    sealHistoryKeyEscrow({
      historyPrivateKey: keyPair.privateKey,
      recoveryPrivateKey: recovery.privateKey,
      userId: "alice",
      version: index + 1,
    }),
  );
  const versionAt = (index: number) => {
    const keyPair = versions[index];
    if (!keyPair) throw new Error(`Missing History key ${index + 1}.`);
    return keyPair;
  };
  const escrowAt = (index: number) => {
    const escrow = escrows[index];
    if (!escrow) throw new Error(`Missing escrow ${index + 1}.`);
    return escrow;
  };
  const published = (index: number): HistoryPublicKey => ({
    publicKey: versionAt(index).publicKey,
    userId: "alice",
    version: index + 1,
  });

  test("each version's escrow restores only that version", () => {
    for (const [escrowIndex, escrow] of escrows.entries()) {
      for (const versionIndex of versions.keys()) {
        const open = () =>
          openHistoryKeyEscrow({
            escrow,
            historyKey: published(versionIndex),
            recoveryPrivateKey: recovery.privateKey,
          });
        if (escrowIndex === versionIndex) {
          expect(open().expose()).toEqual(versionAt(versionIndex).privateKey.expose());
        } else {
          expect(open).toThrow();
        }
      }
    }
  });

  test("a missing middle escrow doesn't stop older or newer versions restoring", () => {
    const restored = [0, 2].map((index) =>
      openHistoryKeyEscrow({
        escrow: escrowAt(index),
        historyKey: published(index),
        recoveryPrivateKey: recovery.privateKey,
      }),
    );

    expect(restored.map((key) => encodeBase64(key.expose()))).toEqual(
      [0, 2].map((index) => encodeBase64(versionAt(index).privateKey.expose())),
    );
  });

  test("a new recovery phrase can't open escrows sealed under the old one", () => {
    const newRecovery = deriveRecoveryKeyPair(generateRecoveryPhrase());

    for (const [index, escrow] of escrows.entries()) {
      expect(() =>
        openHistoryKeyEscrow({
          escrow,
          historyKey: published(index),
          recoveryPrivateKey: newRecovery.privateKey,
        }),
      ).toThrow();
    }
  });

  test("records sealed to an older History key stay readable on a phone holding every version, and only there", () => {
    const sealedPerVersion = versions.map((keyPair, index) =>
      sealPersonalDataForHistoryKey({
        binding: ["alice", "group-1"],
        historyKey: { publicKey: keyPair.publicKey, version: index + 1 },
        plaintext: `colour ${index + 1}`,
        purpose: "group-color",
      }),
    );
    const allKeys = new Map(versions.map((keyPair, index) => [index + 1, keyPair.privateKey]));
    const latestOnly = new Map([[3, versionAt(2).privateKey]]);

    expect(
      sealedPerVersion.map((sealed) =>
        openPersonalData({
          binding: ["alice", "group-1"],
          historyPrivateKeys: allKeys,
          purpose: "group-color",
          sealed,
        }),
      ),
    ).toEqual(["colour 1", "colour 2", "colour 3"]);
    for (const sealed of sealedPerVersion.slice(0, 2)) {
      expect(() =>
        openPersonalData({
          binding: ["alice", "group-1"],
          historyPrivateKeys: latestOnly,
          purpose: "group-color",
          sealed,
        }),
      ).toThrow();
    }
  });

  test("a device link hands over the full chain, and a handover missing the current version is refused", () => {
    const newDevice = createDeviceKeyPair();
    const psk = createDeviceLinkSecret();
    const link = {
      linkId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
      newDeviceId: "alice-tablet",
      userId: "alice",
    };
    const seal = (indexes: number[]) =>
      sealDeviceLinkHandover({
        ...link,
        approverPrivateKey: people.alice.privateKey,
        historyKeys: indexes.map((index) => ({
          privateKey: versionAt(index).privateKey,
          version: index + 1,
        })),
        newDevicePublicKey: newDevice.publicKey,
        psk,
      });
    const open = (sealed: ReturnType<typeof seal>) =>
      openDeviceLinkHandover({
        ...link,
        approverPublicKey: people.alice.publicKey,
        currentHistoryKeyVersion: 3,
        devicePrivateKey: newDevice.privateKey,
        psk,
        publishedHistoryKeys: versions.map((_, index) => published(index)),
        sealed,
      });

    expect(open(seal([2, 0, 1])).map(({ version }) => version)).toEqual([1, 2, 3]);
    expect(open(seal([0, 2])).map(({ version }) => version)).toEqual([1, 3]);
    expect(() => open(seal([0, 1]))).toThrow();
  });
});
