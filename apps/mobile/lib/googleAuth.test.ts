import { beforeEach, describe, expect, mock, test } from "bun:test";

const alertMock = mock(() => {});
const completeAuthenticatedSessionSetupMock = mock(
  async (): Promise<{
    data: null | undefined;
    error: null | { message: string };
  }> => ({ data: undefined, error: null }),
);
const signInWithGoogleMock = mock(
  async (): Promise<{
    data?: { ok: true };
    error?: { message: string };
  }> => ({ data: { ok: true } }),
);

mock.module("./auth.ts", () => ({
  completeAuthenticatedSessionSetup: completeAuthenticatedSessionSetupMock,
  signInWithGoogle: signInWithGoogleMock,
}));

const importGoogleAuthModule = async () =>
  import(`./googleAuth.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./googleAuth.ts")
  >;

describe("performGoogleAuth", () => {
  beforeEach(() => {
    alertMock.mockClear();
    completeAuthenticatedSessionSetupMock.mockClear();
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
    expect(completeAuthenticatedSessionSetupMock).not.toHaveBeenCalled();
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
    expect(completeAuthenticatedSessionSetupMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  test("resets loading and shows an alert when device setup fails", async () => {
    completeAuthenticatedSessionSetupMock.mockImplementationOnce(async () => ({
      data: null,
      error: {
        message: "Unable to register this device.",
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
    expect(completeAuthenticatedSessionSetupMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(
      "Google sign in failed",
      "Unable to register this device.",
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
