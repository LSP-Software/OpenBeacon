import { tryCatch } from "@openbeacon/shared";
import { createRemoteJWKSet, jwtVerify } from "jose";

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
    nonce?: string | undefined;
  }) => {
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
    if (verified.error) return null;
    if (nonce && verified.data.payload["nonce"] !== nonce) return null;
    return verified.data.payload;
  };
};

export const verifyGoogleIdToken = createGoogleIdTokenVerifier({
  certsUrl: new URL("https://www.googleapis.com/oauth2/v3/certs"),
  timeoutMs: 5_000,
});
