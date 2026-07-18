import { describe, expect, test } from "bun:test";
import { shouldForceRefreshAfterMapLoadFailure } from "./mapPmtilesLoadFailure.ts";

describe("shouldForceRefreshAfterMapLoadFailure", () => {
  test("retries once when the map fails to load", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        didRetryAfterMapFailure: false,
        isForceRefreshPending: false,
        isSignedUrlFetching: false,
      }),
    ).toBe(true);
  });

  test("does not retry again for the same url", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        didRetryAfterMapFailure: true,
        isForceRefreshPending: false,
        isSignedUrlFetching: false,
      }),
    ).toBe(false);
  });

  test("waits while a signed url fetch or force refresh is already in flight", () => {
    expect(
      shouldForceRefreshAfterMapLoadFailure({
        didRetryAfterMapFailure: false,
        isForceRefreshPending: true,
        isSignedUrlFetching: false,
      }),
    ).toBe(false);

    expect(
      shouldForceRefreshAfterMapLoadFailure({
        didRetryAfterMapFailure: false,
        isForceRefreshPending: false,
        isSignedUrlFetching: true,
      }),
    ).toBe(false);
  });
});
