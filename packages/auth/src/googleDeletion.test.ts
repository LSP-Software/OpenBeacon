import { expect, test } from "bun:test";

process.env["BETTER_AUTH_URL"] = "https://example.com/openbeacon/";
process.env["GOOGLE_CLIENT_ID"] = "client-id";
process.env["GOOGLE_CLIENT_SECRET"] = "client-secret";

const { createGoogleDeletionAuthorization } = await import("./googleDeletion.ts");

test("sends Google back to the callback under the server's public path", () => {
  const { url } = createGoogleDeletionAuthorization();
  expect(new URL(url).searchParams.get("redirect_uri")).toBe(
    "https://example.com/openbeacon/api/auth/google-deletion-callback",
  );
});
