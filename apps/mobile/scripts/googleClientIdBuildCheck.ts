import { apiCompatibilityLevel, apiCompatibilityLevelHeader, tryCatch } from "@openbeacon/shared";
import { z } from "zod";

export const checkServerGoogleClientId = async ({
  serverUrl,
  webClientId,
  timeoutMs = 10_000,
}: {
  serverUrl: string;
  webClientId: string;
  timeoutMs?: number;
}): Promise<{ problem: null } | { problem: "fail" | "warn"; message: string }> => {
  const skip = "Pass --skip-server-check to build anyway.";
  const response = await tryCatch(
    fetch(new URL("api/trpc/auth.providers", `${serverUrl.replace(/\/+$/, "")}/`), {
      headers: { [apiCompatibilityLevelHeader]: apiCompatibilityLevel.toString() },
      signal: AbortSignal.timeout(timeoutMs),
    }),
  );
  if (response.error || !response.data.ok) {
    return {
      problem: "fail",
      message: `Could not ask ${serverUrl} which Google client ID it uses (${response.error?.name ?? `HTTP ${response.data?.status.toString()}`}). ${skip}`,
    };
  }
  const body = await tryCatch(response.data.json());
  const providers = z
    .object({
      result: z.object({
        data: z.object({
          json: z.object({ google: z.boolean(), googleClientId: z.string().nullable().optional() }),
        }),
      }),
    })
    .safeParse(body.data).data?.result.data.json;
  if (!providers) {
    return {
      problem: "fail",
      message: `${serverUrl} didn't answer like an OpenBeacon server when asked which Google client ID it uses. ${skip}`,
    };
  }
  if (!providers.google) {
    return {
      problem: "fail",
      message: `${serverUrl} has Google sign-in turned off, so this build wouldn't offer it. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server. ${skip}`,
    };
  }
  if (providers.googleClientId === undefined) {
    return {
      problem: "warn",
      message: `${serverUrl} is too old to say which Google client ID it uses, so EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID couldn't be checked against it.`,
    };
  }
  if (providers.googleClientId !== webClientId) {
    return {
      problem: "fail",
      message: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is ${webClientId}, but ${serverUrl} uses GOOGLE_CLIENT_ID ${providers.googleClientId ?? "(none)"}, so this build would hide Google sign-in. Use the same web client ID in both places. ${skip}`,
    };
  }
  return { problem: null };
};
