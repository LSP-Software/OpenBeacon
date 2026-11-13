import { expect, spyOn, test } from "bun:test";

process.env["BETTER_AUTH_URL"] = "https://example.com/openbeacon/";
process.env["GOOGLE_CLIENT_ID"] = "client-id";
process.env["GOOGLE_CLIENT_SECRET"] = "client-secret";

const { createGoogleDeletionAuthorization, verifyGoogleDeletionCode } =
  await import("./googleDeletion.ts");

test("sends Google back to the callback under the server's public path", () => {
  const { url } = createGoogleDeletionAuthorization();
  expect(new URL(url).searchParams.get("redirect_uri")).toBe(
    "https://example.com/openbeacon/api/auth/google-deletion-callback",
  );
});

test("gives up on a Google token endpoint that never answers", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const requestedTimeouts: number[] = [];
  const shortTimeout = spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    requestedTimeouts.push(ms);
    return timeout(100);
  });
  const hangingFetch = spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  const start = performance.now();

  await expect(
    verifyGoogleDeletionCode({ code: "code", codeVerifier: "verifier", nonce: "nonce" }),
  ).rejects.toThrow();
  expect(performance.now() - start).toBeLessThan(2_000);
  expect(requestedTimeouts).toEqual([10_000]);

  hangingFetch.mockRestore();
  shortTimeout.mockRestore();
});
