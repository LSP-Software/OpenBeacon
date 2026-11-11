import { describe, expect, test } from "bun:test";
import { historyLossRisk } from "./historyLossRisk.ts";

const activatedAt = new Date("2026-11-01T00:00:00.000Z");
const noPhrase = { currentHistoryKey: { version: 2 }, recoveryKey: null };
const thisPhone = { activatedAt, id: "this", isCurrent: true };
const otherPhone = { activatedAt, id: "other", isCurrent: false };
const onlyCopy = {
  devices: [thisPhone],
  heldVersions: [1, 2],
  recoveryStatus: noPhrase,
  thisDeviceId: "this",
};

describe("historyLossRisk", () => {
  test("the only phone holding the History key with no recovery phrase will lose history", () => {
    expect(historyLossRisk(onlyCopy)).toBe("certain");
  });

  test("a recovery phrase, another active phone or not holding the key means nothing is lost", () => {
    expect(historyLossRisk({ ...onlyCopy, recoveryStatus: { ...noPhrase, recoveryKey: {} } })).toBe(
      "none",
    );
    expect(historyLossRisk({ ...onlyCopy, devices: [thisPhone, otherPhone] })).toBe("none");
    expect(historyLossRisk({ ...onlyCopy, heldVersions: [1] })).toBe("none");
  });

  test("an account with no History key has nothing to lose, even before held keys are checked", () => {
    expect(
      historyLossRisk({
        ...onlyCopy,
        heldVersions: undefined,
        recoveryStatus: { currentHistoryKey: null, recoveryKey: null },
      }),
    ).toBe("none");
  });

  test("anything still loading makes the loss only possible", () => {
    expect(historyLossRisk({ ...onlyCopy, recoveryStatus: undefined })).toBe("possible");
    expect(historyLossRisk({ ...onlyCopy, heldVersions: undefined })).toBe("possible");
    expect(historyLossRisk({ ...onlyCopy, devices: undefined })).toBe("possible");
  });

  test("on an unverified session this phone is found by its registered id, not counted as another", () => {
    const unverifiedThisPhone = { ...thisPhone, isCurrent: false };
    expect(historyLossRisk({ ...onlyCopy, devices: [unverifiedThisPhone] })).toBe("certain");
    expect(historyLossRisk({ ...onlyCopy, devices: [unverifiedThisPhone, otherPhone] })).toBe(
      "none",
    );
  });

  test("when this phone can't be picked out, one active phone might be this one", () => {
    const devices = [{ ...otherPhone, id: "unknown-1" }];
    expect(historyLossRisk({ ...onlyCopy, devices, thisDeviceId: undefined })).toBe("possible");
    expect(
      historyLossRisk({
        ...onlyCopy,
        devices: [...devices, { ...otherPhone, id: "unknown-2" }],
        thisDeviceId: undefined,
      }),
    ).toBe("none");
  });
});
