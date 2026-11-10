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
import { baseUrl } from "./base-url.ts";
import { storage } from "./storage.ts";

const problemSchema = z.enum(["appTooOld", "serverTooOld", "outOfSync"]);

type ApiCompatibilityProblem = z.infer<typeof problemSchema>;

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

const clientTooOldSchema = z.object({
  code: z.literal("CLIENT_TOO_OLD"),
  minClientApiCompatibilityLevel: levelSchema,
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
    })),
]);

const readJson = async (response: Response) => {
  const body = await tryCatch<unknown>(response.clone().json());
  return body.error ? null : body.data;
};

export const readApiCompatibilityResponse = async (
  response: Response,
): Promise<ApiCompatibilityProblem | "ok" | null> => {
  if (response.status === 426) {
    const body = clientTooOldSchema.safeParse(await readJson(response));
    if (!body.success) return null;
    return apiCompatibilityLevel < body.data.minClientApiCompatibilityLevel
      ? "appTooOld"
      : "outOfSync";
  }
  if (response.status === 404) {
    const body = unknownProcedureSchema.safeParse(await readJson(response));
    if (body.success) {
      return decideUnknownProcedure({ serverLevel: body.data.apiCompatibilityLevel });
    }
  }
  const serverLevel = parseApiCompatibilityLevel(response.headers.get(apiCompatibilityLevelHeader));
  const minClientLevel = parseApiCompatibilityLevel(
    response.headers.get(minClientApiCompatibilityLevelHeader),
  );
  if (serverLevel === null || minClientLevel === null) return null;
  return decideApiCompatibility({
    server: {
      apiCompatibilityLevel: serverLevel,
      minClientApiCompatibilityLevel: minClientLevel,
    },
  });
};

export const checkServerCompatibility = async (serverUrl: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const response = await tryCatch(
    fetch(`${serverUrl.replace(/\/+$/, "")}/health`, { signal: controller.signal }),
  );
  const body = response.error || !response.data.ok ? null : await readJson(response.data);
  clearTimeout(timer);
  const health = healthSchema.safeParse(body);
  if (!health.success) return { verdict: null, serverVersion: null };
  return {
    verdict: decideApiCompatibility({ server: health.data }),
    serverVersion: health.data.version,
  };
};

const storageKey = "api_compatibility";

const savedSchema = z.object({
  serverUrl: z.string(),
  appLevel: z.number(),
  problem: problemSchema,
  serverVersion: z.string().nullable(),
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
  return { problem: saved.problem, serverVersion: saved.serverVersion, notified: saved.notified };
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
  userRequested,
}: {
  verdict: ApiCompatibilityProblem | "ok" | null;
  serverVersion: string | null;
  userRequested: boolean;
}) => {
  if (verdict === null) return;
  if (verdict === "ok") {
    if (!state) return;
    if (state.problem !== "outOfSync" || userRequested) {
      setState(null);
      return;
    }
    if (serverVersion === null || state.serverVersion === serverVersion) return;
    if (state.serverVersion === null) {
      setState({ ...state, serverVersion });
      return;
    }
    setState(null);
    return;
  }
  if (
    state?.problem === verdict &&
    (serverVersion === null || state.serverVersion === serverVersion)
  ) {
    return;
  }
  setState({
    problem: verdict,
    serverVersion: serverVersion ?? (state?.problem === verdict ? state.serverVersion : null),
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
  const { verdict, serverVersion } = await checkServerCompatibility(baseUrl);
  if (revision === startedAt) applyVerdict({ verdict, serverVersion, userRequested });
  return verdict;
};

export const refreshApiCompatibilityInBackground = async (now = Date.now()) => {
  if (lastBackgroundRefreshAt !== null && now - lastBackgroundRefreshAt < 5 * 60_000) return null;
  lastBackgroundRefreshAt = now;
  return refreshApiCompatibility({ userRequested: false });
};

export const apiCompatibilityFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await fetch(input, withApiCompatibilityHeader(init));
  const verdict = await readApiCompatibilityResponse(response);
  if (verdict !== null && verdict !== "ok") revision += 1;
  applyVerdict({ verdict, serverVersion: null, userRequested: false });
  if (verdict === "outOfSync" && state?.serverVersion === null) {
    void refreshApiCompatibility({ userRequested: false });
  }
  return response;
};

export const getApiCompatibility = () => state;

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

export const apiCompatibilityNotice = ({
  problem,
  selfHosted,
}: {
  problem: ApiCompatibilityProblem;
  selfHosted: boolean;
}) => {
  if (problem === "appTooOld") {
    return {
      title: "Update Open Beacon",
      body: "Open Beacon has stopped sharing your location. Update the app to start again.",
    };
  }
  if (problem === "serverTooOld") {
    return {
      title: "Location sharing paused",
      body: selfHosted
        ? "Your server needs updating before Open Beacon can share your location again."
        : "We're updating Open Beacon's servers. Sharing will start again shortly.",
    };
  }
  return {
    title: "Location sharing paused",
    body: "The app and your server don't match. Open Open Beacon for details.",
  };
};
