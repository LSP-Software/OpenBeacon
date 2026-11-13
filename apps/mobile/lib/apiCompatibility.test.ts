import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  apiCompatibilityLevel,
  apiCompatibilityLevelHeader,
  minClientApiCompatibilityLevelHeader,
  minServerApiCompatibilityLevel,
} from "@openbeacon/shared";

const stored = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));

mock.module("./currentServer.ts", () => ({ baseUrl: "https://api.example.test" }));

const {
  apiCompatibilityFetch,
  checkServerCompatibility,
  decideApiCompatibility,
  decideUnknownProcedure,
  getApiCompatibility,
  markApiCompatibilityNotified,
  readApiCompatibilityResponse,
  refreshApiCompatibility,
} = await import("./apiCompatibility.ts");

const realFetch = globalThis.fetch;
let requests: { url: string; headers: Headers }[] = [];
let respond: (url: string) => Response | Promise<Response> = () => new Response("{}");

const levelHeaders = (level: number, minClient: number) => ({
  [apiCompatibilityLevelHeader]: String(level),
  [minClientApiCompatibilityLevelHeader]: String(minClient),
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const health = (level: number, minClient: number, version = "9.9.9") =>
  json({
    status: "ok",
    version,
    serverName: "Family server",
    apiCompatibilityLevel: level,
    minClientApiCompatibilityLevel: minClient,
  });

beforeEach(async () => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    return respond(url);
  }) as typeof fetch;
  respond = () => health(apiCompatibilityLevel, apiCompatibilityLevel);
  await refreshApiCompatibility({ userRequested: true });
  requests = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("decideApiCompatibility", () => {
  const app = { apiCompatibilityLevel: 5, minServerApiCompatibilityLevel: 3 };

  test.each([
    [{ apiCompatibilityLevel: 5, minClientApiCompatibilityLevel: 5 }, "ok"],
    [{ apiCompatibilityLevel: 3, minClientApiCompatibilityLevel: 1 }, "ok"],
    [{ apiCompatibilityLevel: 9, minClientApiCompatibilityLevel: 5 }, "ok"],
    [{ apiCompatibilityLevel: 9, minClientApiCompatibilityLevel: 6 }, "appTooOld"],
    [{ apiCompatibilityLevel: 2, minClientApiCompatibilityLevel: 1 }, "serverTooOld"],
  ] as const)("server %o gives %s", (server, verdict) => {
    expect(decideApiCompatibility({ app, server })).toBe(verdict);
  });

  test("an app and server that each keep min ≤ level can never both be too old", () => {
    const levels = [0, 1, 2, 3, 4, 5];
    for (const appLevel of levels) {
      for (const minServer of levels.filter((level) => level <= appLevel)) {
        for (const serverLevel of levels) {
          for (const minClient of levels.filter((level) => level <= serverLevel)) {
            const appTooOld = appLevel < minClient;
            const serverTooOld = serverLevel < minServer;
            expect(appTooOld && serverTooOld).toBe(false);
            expect(
              decideApiCompatibility({
                app: { apiCompatibilityLevel: appLevel, minServerApiCompatibilityLevel: minServer },
                server: {
                  apiCompatibilityLevel: serverLevel,
                  minClientApiCompatibilityLevel: minClient,
                },
              }),
            ).toBe(appTooOld ? "appTooOld" : serverTooOld ? "serverTooOld" : "ok");
          }
        }
      }
    }
  });
});

describe("decideUnknownProcedure", () => {
  test("blames whichever side has the lower level", () => {
    expect(decideUnknownProcedure({ appLevel: 4, serverLevel: 3 })).toBe("serverTooOld");
    expect(decideUnknownProcedure({ appLevel: 3, serverLevel: 4 })).toBe("appTooOld");
  });

  test("reports a missed level change when both sides claim the same level", () => {
    expect(decideUnknownProcedure({ appLevel: 4, serverLevel: 4 })).toBe("outOfSync");
  });
});

describe("readApiCompatibilityResponse", () => {
  test("reads the frozen 426 body as the app being too old", async () => {
    const response = json(
      { code: "CLIENT_TOO_OLD", minClientApiCompatibilityLevel: apiCompatibilityLevel + 1 },
      426,
    );
    expect(await readApiCompatibilityResponse(response)).toBe("appTooOld");
    expect(await response.json()).toEqual({
      code: "CLIENT_TOO_OLD",
      minClientApiCompatibilityLevel: apiCompatibilityLevel + 1,
    });
  });

  test("treats a 426 for an app that meets the minimum as out of sync", async () => {
    const response = json(
      { code: "CLIENT_TOO_OLD", minClientApiCompatibilityLevel: apiCompatibilityLevel },
      426,
    );
    expect(await readApiCompatibilityResponse(response)).toBe("outOfSync");
  });

  test("ignores a 426 that didn't come from an Open Beacon server", async () => {
    expect(await readApiCompatibilityResponse(new Response("Upgrade", { status: 426 }))).toBe(null);
  });

  test("reads an unknown procedure from an older server as the server being too old", async () => {
    const response = json(
      { code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel: apiCompatibilityLevel - 1 },
      404,
    );
    expect(await readApiCompatibilityResponse(response)).toBe("serverTooOld");
  });

  test("falls back to the level headers for any other 404", async () => {
    const response = json(
      { error: { json: { message: "Group not found" } } },
      404,
      levelHeaders(apiCompatibilityLevel, apiCompatibilityLevel),
    );
    expect(await readApiCompatibilityResponse(response)).toBe("ok");
  });

  test("reads the level headers on an ordinary response", async () => {
    expect(
      await readApiCompatibilityResponse(
        json({}, 200, levelHeaders(minServerApiCompatibilityLevel - 1, 0)),
      ),
    ).toBe("serverTooOld");
  });

  test.each([
    ["missing", {}],
    [
      "garbage",
      { [apiCompatibilityLevelHeader]: "new", [minClientApiCompatibilityLevelHeader]: "1" },
    ],
    ["half present", { [apiCompatibilityLevelHeader]: "1" }],
  ])("knows nothing when the level headers are %s", async (_, headers) => {
    expect(await readApiCompatibilityResponse(json({}, 200, headers))).toBe(null);
  });
});

describe("checkServerCompatibility", () => {
  test("reads the levels and version from /health", async () => {
    respond = () => health(apiCompatibilityLevel + 1, apiCompatibilityLevel + 1);
    expect(await checkServerCompatibility("https://family.example.test")).toEqual({
      verdict: "appTooOld",
      serverVersion: "9.9.9",
    });
    expect(requests[0]?.url).toBe("https://family.example.test/health");
  });

  test.each([
    ["the network fails", () => Promise.reject(new Error("offline"))],
    ["the server errors", () => new Response("Bad gateway", { status: 502 })],
    ["the body isn't JSON", () => new Response("<html>")],
    ["the server isn't ready", () => json({ status: "starting", version: "0.4.4" })],
    [
      "the levels are unreadable",
      () => json({ status: "ok", version: "1.0.0", apiCompatibilityLevel: "new" }),
    ],
  ])("knows nothing when %s", async (_, response) => {
    respond = response;
    expect(await checkServerCompatibility("https://family.example.test")).toEqual({
      verdict: null,
      serverVersion: null,
    });
  });

  test("treats a server that predates compatibility levels as level 0", async () => {
    respond = () => json({ status: "ok", version: "0.4.4", serverName: "Family server" });
    expect(await checkServerCompatibility("https://family.example.test")).toEqual({
      verdict: decideApiCompatibility({
        server: { apiCompatibilityLevel: 0, minClientApiCompatibilityLevel: 0 },
      }),
      serverVersion: "0.4.4",
    });
  });
});

describe("apiCompatibilityFetch", () => {
  test("sends the app's level and keeps the caller's headers", async () => {
    respond = () => json({});
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a", {
      headers: { cookie: "session=1" },
    });
    expect(requests[0]?.headers.get(apiCompatibilityLevelHeader)).toBe(
      String(apiCompatibilityLevel),
    );
    expect(requests[0]?.headers.get("cookie")).toBe("session=1");
  });

  test("blocks on a 426 and saves the result for this server and app level", async () => {
    respond = () =>
      json(
        { code: "CLIENT_TOO_OLD", minClientApiCompatibilityLevel: apiCompatibilityLevel + 1 },
        426,
      );
    const response = await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    expect(response.status).toBe(426);
    expect(getApiCompatibility()).toEqual({
      problem: "appTooOld",
      serverVersion: null,
      notified: false,
    });
    expect(JSON.parse(stored.get("api_compatibility") ?? "null")).toEqual({
      serverUrl: "https://api.example.test",
      appLevel: apiCompatibilityLevel,
      problem: "appTooOld",
      serverVersion: null,
      notified: false,
    });
  });

  test("unblocks when a later response shows the levels now match", async () => {
    respond = () => json({}, 200, levelHeaders(minServerApiCompatibilityLevel - 1, 0));
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    expect(getApiCompatibility()?.problem).toBe("serverTooOld");

    respond = () => json({}, 200, levelHeaders(apiCompatibilityLevel, apiCompatibilityLevel));
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    expect(getApiCompatibility()).toBeNull();
    expect(stored.has("api_compatibility")).toBe(false);
  });

  test("keeps an out-of-sync result until the person checks again", async () => {
    respond = () =>
      json({ code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel }, 404, levelHeaders(1, 1));
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    expect(getApiCompatibility()?.problem).toBe("outOfSync");

    respond = () => json({}, 200, levelHeaders(apiCompatibilityLevel, apiCompatibilityLevel));
    await apiCompatibilityFetch("https://api.example.test/api/trpc/b");
    expect(getApiCompatibility()?.problem).toBe("outOfSync");

    respond = () => health(apiCompatibilityLevel, apiCompatibilityLevel);
    await refreshApiCompatibility({ userRequested: true });
    expect(getApiCompatibility()).toBeNull();
  });

  test("leaves the state alone when a response says nothing about levels", async () => {
    respond = () =>
      json(
        { code: "CLIENT_TOO_OLD", minClientApiCompatibilityLevel: apiCompatibilityLevel + 1 },
        426,
      );
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    respond = () => new Response("Bad gateway", { status: 502 });
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    expect(await refreshApiCompatibility({ userRequested: true })).toBeNull();
    expect(getApiCompatibility()?.problem).toBe("appTooOld");
  });
});

describe("notification tracking", () => {
  test("remembers the notice for the same problem and resets it for a new one", async () => {
    respond = () => health(apiCompatibilityLevel + 1, apiCompatibilityLevel + 1);
    await refreshApiCompatibility({ userRequested: false });
    markApiCompatibilityNotified();
    expect(getApiCompatibility()).toEqual({
      problem: "appTooOld",
      serverVersion: "9.9.9",
      notified: true,
    });

    await refreshApiCompatibility({ userRequested: false });
    expect(getApiCompatibility()?.notified).toBe(true);

    respond = () => health(minServerApiCompatibilityLevel - 1, 0);
    await refreshApiCompatibility({ userRequested: false });
    expect(getApiCompatibility()).toEqual({
      problem: "serverTooOld",
      serverVersion: "9.9.9",
      notified: false,
    });
  });
});

describe("out of sync", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const goOutOfSync = async (serverVersion = "9.9.9") => {
    respond = (url) =>
      url.endsWith("/health")
        ? health(apiCompatibilityLevel, apiCompatibilityLevel, serverVersion)
        : json(
            { code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel },
            404,
            levelHeaders(apiCompatibilityLevel, apiCompatibilityLevel),
          );
    await apiCompatibilityFetch("https://api.example.test/api/trpc/missing");
    await settle();
  };

  test("records the server version from /health without clearing", async () => {
    await goOutOfSync();
    expect(getApiCompatibility()).toEqual({
      problem: "outOfSync",
      serverVersion: "9.9.9",
      notified: false,
    });
  });

  test("is never cleared by a background check against the same server", async () => {
    await goOutOfSync();
    markApiCompatibilityNotified();

    for (let check = 0; check < 3; check += 1) {
      expect(await refreshApiCompatibility({ userRequested: false })).toBe("ok");
      await apiCompatibilityFetch("https://api.example.test/api/trpc/missing");
      await settle();
    }

    expect(getApiCompatibility()).toEqual({
      problem: "outOfSync",
      serverVersion: "9.9.9",
      notified: true,
    });
  });

  test("clears when the person presses Try again", async () => {
    await goOutOfSync();
    await refreshApiCompatibility({ userRequested: true });
    expect(getApiCompatibility()).toBeNull();
  });

  test("clears when the server has been updated since", async () => {
    await goOutOfSync();
    respond = () => health(apiCompatibilityLevel, apiCompatibilityLevel, "10.0.0");
    await refreshApiCompatibility({ userRequested: false });
    expect(getApiCompatibility()).toBeNull();
  });
});

describe("refreshApiCompatibility", () => {
  test("drops a /health result that a newer response overtook", async () => {
    let answerHealth = (_: Response) => {};
    respond = (url) =>
      url.endsWith("/health")
        ? new Promise<Response>((resolve) => (answerHealth = resolve))
        : json(
            { code: "CLIENT_TOO_OLD", minClientApiCompatibilityLevel: apiCompatibilityLevel + 1 },
            426,
          );

    const refresh = refreshApiCompatibility({ userRequested: true });
    await apiCompatibilityFetch("https://api.example.test/api/trpc/a");
    answerHealth(health(apiCompatibilityLevel, apiCompatibilityLevel));

    expect(await refresh).toBe("ok");
    expect(getApiCompatibility()?.problem).toBe("appTooOld");
  });
});

const importFresh = async (key: string): Promise<typeof import("./apiCompatibility.ts")> =>
  import(`./apiCompatibility.ts?${key}`);

describe("refreshApiCompatibilityInBackground", () => {
  test("checks /health at most once every five minutes", async () => {
    const { refreshApiCompatibilityInBackground } = await importFresh("throttle");
    const healthChecks = () => requests.filter(({ url }) => url.endsWith("/health")).length;

    await refreshApiCompatibilityInBackground(1_000);
    expect(healthChecks()).toBe(1);

    expect(await refreshApiCompatibilityInBackground(1_000 + 4 * 60_000)).toBeNull();
    expect(healthChecks()).toBe(1);

    await refreshApiCompatibilityInBackground(1_000 + 5 * 60_000);
    expect(healthChecks()).toBe(2);
  });
});

describe("saved result", () => {
  test("is only restored for the same server and app level", async () => {
    const saved = {
      serverUrl: "https://api.example.test",
      appLevel: apiCompatibilityLevel,
      problem: "serverTooOld",
      serverVersion: "0.1.0",
      notified: true,
    };
    stored.set("api_compatibility", JSON.stringify(saved));
    const sameServer = await importFresh("same-server");
    expect(sameServer.getApiCompatibility()).toEqual({
      problem: "serverTooOld",
      serverVersion: "0.1.0",
      notified: true,
    });

    stored.set(
      "api_compatibility",
      JSON.stringify({ ...saved, serverUrl: "https://family.example.test" }),
    );
    const otherServer = await importFresh("other-server");
    expect(otherServer.getApiCompatibility()).toBeNull();
    expect(stored.has("api_compatibility")).toBe(false);

    stored.set(
      "api_compatibility",
      JSON.stringify({ ...saved, appLevel: apiCompatibilityLevel - 1 }),
    );
    const olderApp = await importFresh("older-app");
    expect(olderApp.getApiCompatibility()).toBeNull();

    stored.set("api_compatibility", "{not json");
    const corrupt = await importFresh("corrupt");
    expect(corrupt.getApiCompatibility()).toBeNull();
  });
});
