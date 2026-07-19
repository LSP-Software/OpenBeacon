import { describe, expect, test } from "bun:test";
import {
  MAX_AUTO_FORCE_REFRESH_ATTEMPTS,
  nextMapLoadFailureState,
  shouldForceRefreshAfterMapLoadFailure,
} from "./mapPmtilesLoadFailure.ts";

describe("shouldForceRefreshAfterMapLoadFailure", () => {
  test("retries once when the map fails to load", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        autoForceRefreshAttempts: 0,
        isForceRefreshPending: false,
        isSignedUrlFetching: false,
        showRecoverableError: false,
      }),
    ).toBe(true);
  });

  test("does not auto-retry after the attempt budget is used", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        autoForceRefreshAttempts: MAX_AUTO_FORCE_REFRESH_ATTEMPTS,
        isForceRefreshPending: false,
        isSignedUrlFetching: false,
        showRecoverableError: false,
      }),
    ).toBe(false);
  });

  test("does not auto-retry while recoverable error UI is showing", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        autoForceRefreshAttempts: 0,
        isForceRefreshPending: false,
        isSignedUrlFetching: false,
        showRecoverableError: true,
      }),
    ).toBe(false);
  });

  test("waits while a signed url fetch or force refresh is already in flight", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        autoForceRefreshAttempts: 0,
        isForceRefreshPending: true,
        isSignedUrlFetching: false,
        showRecoverableError: false,
      }),
    ).toBe(false);

    expect(
      shouldForceRefreshAfterMapLoadFailure({
        autoForceRefreshAttempts: 0,
        isForceRefreshPending: false,
        isSignedUrlFetching: true,
        showRecoverableError: false,
      }),
    ).toBe(false);
  });
});

describe("nextMapLoadFailureState", () => {
  test("increments the auto-refresh attempt when a forced refresh starts", () => {
    expect(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: 0,
        event: "auto_force_refresh_started",
      }),
    ).toEqual({
      autoForceRefreshAttempts: 1,
      showRecoverableError: false,
    });
  });

  test("resets retry eligibility and shows recoverable UI when force refresh fails", () => {
    expect(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: 1,
        event: "force_refresh_failed",
      }),
    ).toEqual({
      autoForceRefreshAttempts: 0,
      showRecoverableError: true,
    });
  });

  test("shows recoverable UI when auto retries are exhausted", () => {
    expect(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: 1,
        event: "auto_retries_exhausted",
      }),
    ).toEqual({
      autoForceRefreshAttempts: 1,
      showRecoverableError: true,
    });
  });

  test("clears the failure episode after the style finishes loading", () => {
    expect(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: 1,
        event: "style_loaded",
      }),
    ).toEqual({
      autoForceRefreshAttempts: 0,
      showRecoverableError: false,
    });
  });

  test("clears recoverable error state for a manual retry", () => {
    expect(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: 1,
        event: "manual_retry",
      }),
    ).toEqual({
      autoForceRefreshAttempts: 0,
      showRecoverableError: false,
    });
  });
});
