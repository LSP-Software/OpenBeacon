import {
  apiCompatibilityLevel,
  apiCompatibilityLevelHeader,
  minClientApiCompatibilityLevelHeader,
  minServerApiCompatibilityLevel,
  parseApiCompatibilityLevel,
  tryCatch,
} from "@openbeacon/shared";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { baseUrl } from "./currentServer.ts";
import { storage } from "./storage.ts";

const problemSchema = z.enum(["appTooOld", "serverTooOld", "outOfSync"]);

export type ApiCompatibilityProblem = z.infer<typeof problemSchema>;

const appLevels = { apiCompatibilityLevel, minServerApiCompatibilityLevel };

export const decideApiCompatibility = ({
  app = appLevels,
  server,
}: {
  app?: typeof appLevels;
  server: { apiCompatibilityLevel: number; minClientApiCompatibilityLevel: number };
}): "appTooOld" | "serverTooOld" | "ok" => {
  if (app.apiCompatibilityLevel < server.minClientApiCompatibilityLevel) return "appTooOld";
  if (server.apiCompatibilityLevel < app.minServerApiCompatibilityLevel) return "serverTooOld";
  return "ok";
};

export const decideUnknownProcedure = ({
  appLevel = apiCompatibilityLevel,
  serverLevel,
}: {
  appLevel?: number;
  serverLevel: number;
}): ApiCompatibilityProblem => {
  if (appLevel > serverLevel) return "serverTooOld";
  if (appLevel < serverLevel) return "appTooOld";
  return "outOfSync";
};

const levelSchema = z.number().int().nonnegative();

const messageSchema = z
  .string()
  .max(280)
  .optional()
  .catch(undefined)
  .transform((message) => message ?? null);

const clientTooOldSchema = z.object({
  code: z.literal("CLIENT_TOO_OLD"),
  minClientApiCompatibilityLevel: levelSchema,
  message: messageSchema,
});

const unknownProcedureSchema = z.object({
  code: z.literal("UNKNOWN_PROCEDURE"),
  apiCompatibilityLevel: levelSchema,
});

const healthSchema = z.union([
  z.object({
    version: z.string(),
    apiCompatibilityLevel: levelSchema,
    minClientApiCompatibilityLevel: levelSchema,
    message: messageSchema,
  }),
  z
    .object({
      status: z.literal("ok"),
      version: z.string(),
      apiCompatibilityLevel: z.never().optional(),
      minClientApiCompatibilityLevel: z.never().optional(),
    })
    .transform(({ version }) => ({
      version,
      apiCompatibilityLevel: 0,
      minClientApiCompatibilityLevel: 0,
      message: null,
    })),
]);

const readJson = async (response: Response) => {
  const body = await tryCatch<unknown>(response.clone().json());
  return body.error ? null : body.data;
};

export const readApiCompatibilityResponse = async (
  response: Response,
): Promise<{
  verdict: ApiCompatibilityProblem | "ok" | null;
  message?: string | null;
  sticky: boolean;
}> => {
  if (response.status === 426) {
    const body = clientTooOldSchema.safeParse(await readJson(response));
    if (!body.success) return { verdict: null, sticky: false };
    return {
      verdict:
        apiCompatibilityLevel < body.data.minClientApiCompatibilityLevel
          ? "appTooOld"
          : "outOfSync",
      message: body.data.message,
      sticky: true,
    };
  }
  if (response.status === 404) {
    const body = unknownProcedureSchema.safeParse(await readJson(response));
    if (body.success) {
      return {
        verdict: decideUnknownProcedure({ serverLevel: body.data.apiCompatibilityLevel }),
        sticky: true,
      };
    }
  }
  const serverLevel = parseApiCompatibilityLevel(response.headers.get(apiCompatibilityLevelHeader));
  const minClientLevel = parseApiCompatibilityLevel(
    response.headers.get(minClientApiCompatibilityLevelHeader),
  );
  if (serverLevel === null || minClientLevel === null) return { verdict: null, sticky: false };
  return {
    verdict: decideApiCompatibility({
      server: {
        apiCompatibilityLevel: serverLevel,
        minClientApiCompatibilityLevel: minClientLevel,
      },
    }),
    sticky: false,
  };
};

export const checkServerCompatibility = async (serverUrl: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const response = await tryCatch(fetch(`${serverUrl}/health`, { signal: controller.signal }));
  const body = response.error || !response.data.ok ? null : await readJson(response.data);
  clearTimeout(timer);
  const health = healthSchema.safeParse(body);
  if (!health.success) return { verdict: null, serverVersion: null };
  return {
    verdict: decideApiCompatibility({ server: health.data }),
    serverVersion: health.data.version,
    message: health.data.message,
  };
};

const storageKey = "api_compatibility";

const savedSchema = z.object({
  serverUrl: z.string(),
  appLevel: z.number(),
  problem: problemSchema,
  serverVersion: z.string().nullable(),
  message: z.string().max(280).nullable().catch(null),
  sticky: z.boolean(),
  notified: z.boolean(),
});

type ApiCompatibilityState = Omit<z.infer<typeof savedSchema>, "serverUrl" | "appLevel">;

const loadSaved = (): ApiCompatibilityState | null => {
  const raw = storage.getString(storageKey);
  if (raw === undefined) return null;
  let saved: z.infer<typeof savedSchema>;
  try {
    saved = savedSchema.parse(JSON.parse(raw));
  } catch {
    storage.remove(storageKey);
    return null;
  }
  if (saved.serverUrl !== baseUrl || saved.appLevel !== apiCompatibilityLevel) {
    storage.remove(storageKey);
    return null;
  }
  return {
    problem: saved.problem,
    serverVersion: saved.serverVersion,
    message: saved.message,
    sticky: saved.sticky,
    notified: saved.notified,
  };
};

let state = loadSaved();
const listeners = new Set<() => void>();

const setState = (next: ApiCompatibilityState | null) => {
  state = next;
  if (next) {
    storage.set(
      storageKey,
      JSON.stringify({ serverUrl: baseUrl, appLevel: apiCompatibilityLevel, ...next }),
    );
  } else {
    storage.remove(storageKey);
  }
  for (const listener of listeners) listener();
};

let revision = 0;
let lastBackgroundRefreshAt: number | null = null;

const applyVerdict = ({
  verdict,
  serverVersion,
  message,
  sticky,
  userRequested,
}: {
  verdict: ApiCompatibilityProblem | "ok" | null;
  serverVersion: string | null;
  message: string | null | undefined;
  sticky: boolean;
  userRequested: boolean;
}) => {
  if (verdict === null) return;
  const nextMessage = message === undefined ? (state?.message ?? null) : message;
  if (verdict === "ok") {
    if (!state) return;
    if (!state.sticky || userRequested) {
      setState(null);
      return;
    }
    if (
      serverVersion !== null &&
      state.serverVersion !== null &&
      state.serverVersion !== serverVersion
    ) {
      setState(null);
      return;
    }
    if (
      state.serverVersion !== (serverVersion ?? state.serverVersion) ||
      state.message !== nextMessage
    ) {
      setState({
        ...state,
        serverVersion: serverVersion ?? state.serverVersion,
        message: nextMessage,
      });
    }
    return;
  }
  const nextSticky = sticky || (state?.problem === verdict && state.sticky);
  if (
    state?.problem === verdict &&
    (serverVersion === null || state.serverVersion === serverVersion) &&
    state.message === nextMessage &&
    state.sticky === nextSticky
  ) {
    return;
  }
  setState({
    problem: verdict,
    serverVersion: serverVersion ?? (state?.problem === verdict ? state.serverVersion : null),
    message: nextMessage,
    sticky: nextSticky,
    notified: state?.problem === verdict && state.notified,
  });
};

export const withApiCompatibilityHeader = (init?: RequestInit): RequestInit => {
  const headers = new Headers(init?.headers);
  headers.set(apiCompatibilityLevelHeader, String(apiCompatibilityLevel));
  return { ...init, headers };
};

export const refreshApiCompatibility = async ({ userRequested }: { userRequested: boolean }) => {
  const startedAt = revision;
  const { verdict, serverVersion, message } = await checkServerCompatibility(baseUrl);
  if (revision === startedAt) {
    applyVerdict({ verdict, serverVersion, message, sticky: false, userRequested });
  }
  return verdict;
};

export const refreshApiCompatibilityInBackground = async (now = Date.now()) => {
  if (lastBackgroundRefreshAt !== null && now - lastBackgroundRefreshAt < 5 * 60_000) return null;
  lastBackgroundRefreshAt = now;
  return refreshApiCompatibility({ userRequested: false });
};

export const apiCompatibilityFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await fetch(input, withApiCompatibilityHeader(init));
  const { verdict, message, sticky } = await readApiCompatibilityResponse(response);
  if (verdict !== null && verdict !== "ok") revision += 1;
  applyVerdict({ verdict, serverVersion: null, message, sticky, userRequested: false });
  if (sticky && state?.serverVersion === null) {
    void refreshApiCompatibility({ userRequested: false });
  }
  return response;
};

export const getApiCompatibility = () => state;

export const clearApiCompatibility = () => setState(null);

export const markApiCompatibilityNotified = () => {
  if (state && !state.notified) setState({ ...state, notified: true });
};

export const useApiCompatibility = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
