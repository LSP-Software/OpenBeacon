import { describe, expect, test } from "bun:test";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { createFcmClient, resolveFcmSettings } from "./fcm.ts";

const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const pem = await exportPKCS8(privateKey);
const tokenUrl = "https://oauth2.googleapis.com/token";
const sendUrl = "https://fcm.googleapis.com/v1/projects/openbeacon-test/messages:send";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const fcmError = (status: number, errorStatus: string, errorCode?: string, badField?: string) =>
  json(
    {
      error: {
        code: status,
        message: "Requested entity was not found.",
        status: errorStatus,
        details: [
          ...(errorCode
            ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }]
            : []),
          ...(badField
            ? [
                {
                  "@type": "type.googleapis.com/google.rpc.BadRequest",
                  fieldViolations: [{ field: badField, description: "Invalid value" }],
                },
              ]
            : []),
        ],
      },
    },
    status,
  );

const setup = (sendReplies: (() => Response | Promise<Response>)[] = []) => {
  const calls: { url: string; init: RequestInit }[] = [];
  let clock = 1_800_000_000_000;
  let tokens = 0;
  const client = createFcmClient({
    projectId: "openbeacon-test",
    clientEmail: "push-relay@openbeacon-test.iam.gserviceaccount.com",
    privateKey: pem,
    now: () => clock,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === tokenUrl) {
        tokens += 1;
        return json({ access_token: `access-${tokens}`, expires_in: 3599, token_type: "Bearer" });
      }
      const reply = sendReplies.shift();
      return reply ? reply() : json({ name: "projects/openbeacon-test/messages/1" });
    },
  });
  return {
    client,
    calls,
    sends: () => calls.filter(({ url }) => url === sendUrl),
    tokenRequests: () => calls.filter(({ url }) => url === tokenUrl),
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

describe("resolveFcmSettings", () => {
  test("push is off when none of the three are set", () => {
    expect(resolveFcmSettings({})).toEqual({ settings: null, error: null });
    expect(
      resolveFcmSettings({ FCM_PROJECT_ID: " ", FCM_CLIENT_EMAIL: "", FCM_PRIVATE_KEY: undefined }),
    ).toEqual({ settings: null, error: null });
  });

  test("setting only some of them is an error", () => {
    for (const source of [
      { FCM_PROJECT_ID: "openbeacon-test" },
      { FCM_PROJECT_ID: "openbeacon-test", FCM_CLIENT_EMAIL: "push@example.test" },
      { FCM_PRIVATE_KEY: "key" },
    ]) {
      expect(resolveFcmSettings(source)).toEqual({
        settings: null,
        error: "FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY: set all three or none",
      });
    }
  });

  test("accepts a private key with escaped newlines", () => {
    expect(
      resolveFcmSettings({
        FCM_PROJECT_ID: "openbeacon-test",
        FCM_CLIENT_EMAIL: "push@example.test",
        FCM_PRIVATE_KEY: pem.trim().replaceAll("\n", "\\n"),
      }).settings,
    ).toEqual({
      projectId: "openbeacon-test",
      clientEmail: "push@example.test",
      privateKey: pem.trim(),
    });
  });
});

describe("access token", () => {
  test("signs a JWT for the messaging scope and caches the token until close to expiry", async () => {
    const fcm = setup();
    expect(await fcm.client.getAccessToken()).toBe("access-1");
    const [request] = fcm.tokenRequests();
    const form = new URLSearchParams(String(request?.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(decodeJwt(form.get("assertion") ?? "")).toMatchObject({
      iss: "push-relay@openbeacon-test.iam.gserviceaccount.com",
      aud: tokenUrl,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });

    expect(await fcm.client.getAccessToken()).toBe("access-1");
    fcm.advance(50 * 60_000);
    expect(await fcm.client.getAccessToken()).toBe("access-1");
    fcm.advance(6 * 60_000);
    expect(await fcm.client.getAccessToken()).toBe("access-2");
    expect(fcm.tokenRequests()).toHaveLength(2);
  });

  test("concurrent callers share one token request", async () => {
    const fcm = setup();
    await Promise.all([fcm.client.getAccessToken(), fcm.client.getAccessToken()]);
    expect(fcm.tokenRequests()).toHaveLength(1);
  });

  test("fails when Google refuses the key", async () => {
    const client = createFcmClient({
      projectId: "openbeacon-test",
      clientEmail: "push@example.test",
      privateKey: pem,
      fetch: async () => json({ error: "invalid_grant", error_description: "Invalid JWT" }, 400),
    });
    await expect(client.getAccessToken()).rejects.toMatchObject({ code: "FCM_AUTH_400" });
  });

  test("says Google couldn't be reached when the token request gets no answer", async () => {
    const client = createFcmClient({
      projectId: "openbeacon-test",
      clientEmail: "push@example.test",
      privateKey: pem,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(client.getAccessToken()).rejects.toMatchObject({
      code: "FCM_AUTH_UNREACHABLE",
    });
  });

  test("fails on a private key that isn't a PKCS #8 key, without calling Google", async () => {
    let called = false;
    const client = createFcmClient({
      projectId: "openbeacon-test",
      clientEmail: "push@example.test",
      privateKey: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----",
      fetch: async () => {
        called = true;
        return json({ access_token: "access" });
      },
    });
    await expect(client.getAccessToken()).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe("send", () => {
  test("sends a high-priority wake-up with nothing else in it", async () => {
    const fcm = setup();
    expect(await fcm.client.send("device-token")).toEqual({ outcome: "sent" });
    const [request] = fcm.sends();
    expect(request?.init.method).toBe("POST");
    expect(new Headers(request?.init.headers).get("authorization")).toBe("Bearer access-1");
    expect(JSON.parse(String(request?.init.body))).toStrictEqual({
      message: {
        token: "device-token",
        data: { t: "sync" },
        android: { priority: "high", collapse_key: "sync", ttl: "300s" },
      },
    });
  });

  test("reports a token Google no longer knows or says is malformed", async () => {
    const fcm = setup([
      () => fcmError(404, "NOT_FOUND", "UNREGISTERED"),
      () => fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.token"),
      () => fcmError(400, "INVALID_ARGUMENT", undefined, "message.token"),
    ]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "unregistered" });
    expect(await fcm.client.send("b")).toEqual({ outcome: "unregistered" });
    expect(await fcm.client.send("c")).toEqual({ outcome: "unregistered" });
  });

  test("an invalid argument that isn't the token is a failed send, keeping the token", async () => {
    const fcm = setup([
      () => fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"),
      () => fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.android.ttl"),
      () => fcmError(400, "INVALID_ARGUMENT"),
    ]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "failed", status: 400 });
    expect(await fcm.client.send("a")).toEqual({ outcome: "failed", status: 400 });
    expect(await fcm.client.send("a")).toEqual({ outcome: "failed", status: 400 });
  });

  test("asks for a retry when FCM is busy, honouring Retry-After up to a minute", async () => {
    const fcm = setup([
      () => json({ error: { status: "RESOURCE_EXHAUSTED" } }, 429, { "retry-after": "7" }),
      () => json({ error: { status: "UNAVAILABLE" } }, 503),
      () => json({ error: { status: "UNAVAILABLE" } }, 503, { "retry-after": "3600" }),
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "retry", afterMs: 7_000 });
    expect(await fcm.client.send("a")).toEqual({ outcome: "retry", afterMs: 5_000 });
    expect(await fcm.client.send("a")).toEqual({ outcome: "retry", afterMs: 60_000 });
    expect(await fcm.client.send("a")).toEqual({ outcome: "retry", afterMs: 5_000 });
  });

  test("drops a rejected access token and sends again straight away with a new one", async () => {
    const fcm = setup([() => json({ error: { status: "UNAUTHENTICATED" } }, 401)]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "sent" });
    expect(fcm.sends()).toHaveLength(2);
    expect(fcm.tokenRequests()).toHaveLength(2);
    expect(new Headers(fcm.sends()[1]?.init.headers).get("authorization")).toBe("Bearer access-2");
  });

  test("a refreshed token doesn't use up the retry for a busy FCM", async () => {
    const fcm = setup([
      () => json({ error: { status: "UNAUTHENTICATED" } }, 401),
      () => json({ error: { status: "UNAVAILABLE" } }, 503),
    ]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "retry", afterMs: 5_000 });
    expect(fcm.sends()).toHaveLength(2);
  });

  test("a second rejected access token in a row is a failed send, not another refresh", async () => {
    const fcm = setup([
      () => json({ error: { status: "UNAUTHENTICATED" } }, 401),
      () => json({ error: { status: "UNAUTHENTICATED" } }, 401),
    ]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "failed", status: 401 });
    expect(fcm.sends()).toHaveLength(2);
    expect(fcm.tokenRequests()).toHaveLength(2);
  });

  test("reports other refusals as failed", async () => {
    const fcm = setup([() => fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH")]);
    expect(await fcm.client.send("a")).toEqual({ outcome: "failed", status: 403 });
  });
});
