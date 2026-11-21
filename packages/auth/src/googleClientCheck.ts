import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";

export const createGoogleClientCheck =
  ({ tokenUrl, timeoutMs }: { tokenUrl: URL; timeoutMs: number }) =>
  async ({
    clientId,
    clientSecret,
    redirectUri,
  }: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<{ status: "valid" | "rejected" | "unreachable" | "unexpected"; detail: string }> => {
    const response = await tryCatch(
      fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: "openbeacon-startup-check",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    if (response.error) return { status: "unreachable", detail: response.error.name };
    const body = await tryCatch(response.data.json());
    const error = z
      .object({ error: z.string(), error_description: z.string().optional() })
      .safeParse(body.data).data;
    const detail = error
      ? [error.error, error.error_description].filter(Boolean).join(": ")
      : `HTTP ${response.data.status.toString()}`;
    if (error?.error === "invalid_grant") return { status: "valid", detail };
    if (error?.error === "invalid_client" || error?.error === "unauthorized_client")
      return { status: "rejected", detail };
    if (response.data.status === 429 || response.data.status >= 500)
      return { status: "unreachable", detail };
    return { status: "unexpected", detail };
  };

export const checkGoogleClient = createGoogleClientCheck({
  tokenUrl: new URL("https://oauth2.googleapis.com/token"),
  timeoutMs: 5_000,
});
