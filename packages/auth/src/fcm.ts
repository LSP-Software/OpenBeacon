import { optionalEnvString } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { importPKCS8, SignJWT } from "jose";

export const fcmEnvSchema = {
  FCM_PROJECT_ID: optionalEnvString,
  FCM_CLIENT_EMAIL: optionalEnvString,
  FCM_PRIVATE_KEY: optionalEnvString,
};

export const resolveFcmSettings = (source: Record<string, string | undefined>) => {
  const values = {
    projectId: source["FCM_PROJECT_ID"]?.trim() ?? "",
    clientEmail: source["FCM_CLIENT_EMAIL"]?.trim() ?? "",
    privateKey: (source["FCM_PRIVATE_KEY"] ?? "").replaceAll("\\n", "\n").trim(),
  };
  const set = Object.values(values).filter(Boolean).length;
  if (set === 0) return { settings: null, error: null };
  if (set < 3) {
    return {
      settings: null,
      error: "FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY: set all three or none",
    };
  }
  return { settings: values, error: null };
};

export type FcmSendResult =
  | { outcome: "sent" }
  | { outcome: "unregistered" }
  | { outcome: "retry"; afterMs: number }
  | { outcome: "failed"; status: number };

export const createFcmClient = ({
  projectId,
  clientEmail,
  privateKey,
  fetch = globalThis.fetch,
  now = Date.now,
}: {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}) => {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  let cached: { token: string; refreshAt: number } | null = null;
  let pending: Promise<string> | null = null;

  const fetchAccessToken = async () => {
    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(clientEmail)
      .setAudience(tokenUrl)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await importPKCS8(privateKey, "RS256"));
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json().catch(() => null);
    const token =
      body && typeof body === "object" && "access_token" in body ? body.access_token : null;
    const expiresIn =
      body && typeof body === "object" && "expires_in" in body ? Number(body.expires_in) : 3600;
    if (!response.ok || typeof token !== "string") {
      throw Object.assign(new Error("Could not get an FCM access token"), {
        code: `FCM_AUTH_${response.status}`,
      });
    }
    cached = { token, refreshAt: now() + Math.max(60, expiresIn - 300) * 1000 };
    return token;
  };

  const getAccessToken = async () => {
    if (cached && now() < cached.refreshAt) return cached.token;
    pending ??= fetchAccessToken().finally(() => {
      pending = null;
    });
    return pending;
  };

  const send = async (token: string): Promise<FcmSendResult> => {
    const accessToken = await tryCatch(getAccessToken());
    if (accessToken.error) return { outcome: "retry", afterMs: 5_000 };
    const response = await tryCatch(
      fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken.data}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              data: { t: "sync" },
              android: { priority: "high", collapse_key: "sync", ttl: "300s" },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      ),
    );
    if (response.error) return { outcome: "retry", afterMs: 5_000 };
    if (response.data.ok) return { outcome: "sent" };
    const { status } = response.data;
    if (status === 401) {
      cached = null;
      return { outcome: "retry", afterMs: 0 };
    }
    if (status === 429 || status >= 500) {
      const retryAfter = Number(response.data.headers.get("retry-after"));
      return {
        outcome: "retry",
        afterMs:
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 5_000,
      };
    }
    const body: unknown = await response.data.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const errorStatus =
      error && typeof error === "object" && "status" in error ? error.status : null;
    const details =
      error && typeof error === "object" && "details" in error && Array.isArray(error.details)
        ? (error.details as unknown[])
        : [];
    const errorCodes = details.flatMap((detail) =>
      detail && typeof detail === "object" && "errorCode" in detail ? [detail.errorCode] : [],
    );
    if (
      errorCodes.includes("UNREGISTERED") ||
      errorCodes.includes("INVALID_ARGUMENT") ||
      errorStatus === "INVALID_ARGUMENT"
    ) {
      return { outcome: "unregistered" };
    }
    return { outcome: "failed", status };
  };

  return { getAccessToken, send };
};

export type FcmClient = ReturnType<typeof createFcmClient>;
