import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { env } from "./env.ts";
import { verifyGoogleIdToken } from "./googleIdToken.ts";
import { getPublicUrl } from "./publicUrl.ts";

const redirectUri = () =>
  `${getPublicUrl(env.BETTER_AUTH_URL).baseUrl}/api/auth/google-deletion-callback`;

export const createGoogleDeletionAuthorization = () => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new Error("Google sign-in is not configured.");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    prompt: "select_account",
    state,
    nonce,
    code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { state, nonce, codeVerifier, url: url.toString() };
};

export const verifyGoogleDeletionCode = async ({
  code,
  codeVerifier,
  nonce,
}: {
  code: string;
  codeVerifier: string;
  nonce: string;
}) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const tokens = z.object({ id_token: z.string().min(1) }).safeParse(await response.json());
  if (!tokens.success) return null;
  const claims = await verifyGoogleIdToken({
    token: tokens.data.id_token,
    audience: env.GOOGLE_CLIENT_ID,
    nonce,
  });
  return typeof claims?.sub === "string" && claims.sub ? claims.sub : null;
};
