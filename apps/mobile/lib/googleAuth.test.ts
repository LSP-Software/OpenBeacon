import { beforeEach, describe, expect, mock, test } from "bun:test";

const alertMock = mock(() => {});
const ensureDeviceKeyRegistrationMock = mock(async () => {});
const revokePendingSessionTokenMock = mock(async () => {});
const signInWithGoogleMock = mock(
  async (): Promise<{
    data?: { ok: true };
    error?: { message: string };
  }> => ({ data: { ok: true } }),
);

mock.module("./auth.ts", () => ({
  revokePendingSessionToken: revokePendingSessionTokenMock,
  signInWithGoogle: signInWithGoogleMock,
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: ensureDeviceKeyRegistrationMock,
}));

const importGoogleAuthModule = async () =>
  import(`./googleAuth.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./googleAuth.ts")
  >;

describe("performGoogleAuth", () => {
  beforeEach(() => {
    alertMock.mockClear();
    ensureDeviceKeyRegistrationMock.mockClear();
    revokePendingSessionTokenMock.mockClear();
    signInWithGoogleMock.mockClear();
  });

  test("resets loading and shows an alert when Google sign-in fails", async () => {
    signInWithGoogleMock.mockImplementationOnce(async () => ({
      error: {
        message: "No token",
      },
    }));

    const loadingStates: boolean[] = [];
    const onSuccess = mock(async () => {});
    const { performGoogleAuth } = await importGoogleAuthModule();

    await performGoogleAuth({
      setLoading: (loading) => {
        loadingStates.push(loading);
      },
      failureTitle: "Google sign in failed",
      onSuccess,
      alert: alertMock,
    });

    expect(loadingStates).toEqual([true, false]);
    expect(alertMock).toHaveBeenCalledWith("Google sign in failed", "No token");
    expect(revokePendingSessionTokenMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("revokes the pending session token and runs success callback on success", async () => {
    const loadingStates: boolean[] = [];
    const onSuccess = mock(async () => {});
    const { performGoogleAuth } = await importGoogleAuthModule();

    await performGoogleAuth({
      setLoading: (loading) => {
        loadingStates.push(loading);
      },
      failureTitle: "Google sign in failed",
      onSuccess,
      alert: alertMock,
    });

    expect(loadingStates).toEqual([true]);
    expect(ensureDeviceKeyRegistrationMock).toHaveBeenCalledTimes(1);
    expect(revokePendingSessionTokenMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });
});
