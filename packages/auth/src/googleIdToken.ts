import { tryCatch } from "@openbeacon/shared";
import { createRemoteJWKSet, decodeJwt, errors, type JWTPayload, jwtVerify } from "jose";

export const createGoogleIdTokenVerifier = ({
  certsUrl,
  timeoutMs,
}: {
  certsUrl: URL;
  timeoutMs: number;
}) => {
  const keys = createRemoteJWKSet(certsUrl, { timeoutDuration: timeoutMs });
  return async ({
    token,
    audience,
    nonce,
  }: {
    token: string;
    audience: string;
    nonce: string;
  }): Promise<GoogleIdTokenResult> => {
    const verified = await tryCatch(
      jwtVerify(token, keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience,
        algorithms: ["RS256"],
        maxTokenAge: "1h",
        requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
        clockTolerance: 30,
      }),
    );
    if (verified.error) {
      const error = verified.error;
      if (error instanceof errors.JWTExpired) return { ok: false, refused: "expired" };
      if (error instanceof errors.JWTClaimValidationFailed && error.claim === "aud") {
        return {
          ok: false,
          refused: "wrong-client",
          tokenClientId: [decodeJwt(token).aud ?? []].flat().join(", "),
        };
      }
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        return { ok: false, refused: "keys-unreachable" };
      }
      return { ok: false, refused: "invalid" };
    }
    const tokenNonce = verified.data.payload["nonce"];
    if (!nonce || typeof tokenNonce !== "string") return { ok: false, refused: "invalid" };
    if (tokenNonce !== nonce) return { ok: false, refused: "wrong-nonce" };
    return { ok: true, payload: verified.data.payload };
  };
};

export const verifyGoogleIdToken = createGoogleIdTokenVerifier({
  certsUrl: new URL("https://www.googleapis.com/oauth2/v3/certs"),
  timeoutMs: 5_000,
});

export const googleRefusalReason = ({
  result,
  clientId,
  serverUrl,
}: {
  result: Extract<GoogleIdTokenResult, { ok: false }>;
  clientId: string;
  serverUrl: string;
}) => {
  if (result.refused === "wrong-client")
    return `because Google issued the token for client ${result.tokenClientId}, but GOOGLE_CLIENT_ID is ${clientId}. Set GOOGLE_CLIENT_ID to the web client ID the app was built with (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID), and GOOGLE_CLIENT_SECRET to that client's secret.`;
  if (result.refused === "wrong-nonce")
    return `because the phone asked Google for it on behalf of a different server address. If phones can't sign in with Google, set BETTER_AUTH_URL to the exact address phones use, with the same scheme, host and port. It is ${new URL(serverUrl).origin} now.`;
  if (result.refused === "expired")
    return "because the token had expired. If this keeps happening, check this server's clock.";
  if (result.refused === "keys-unreachable")
    return "because Google's signing keys couldn't be fetched from https://www.googleapis.com/oauth2/v3/certs. Check this server can reach Google.";
  return "because the token wasn't a valid Google ID token for this sign-in.";
};

type GoogleIdTokenResult =
  | { ok: true; payload: JWTPayload }
  | { ok: false; refused: "wrong-client"; tokenClientId: string }
  | { ok: false; refused: "wrong-nonce" | "expired" | "keys-unreachable" | "invalid" };
