import { describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret } from "@openbeacon/cache/testing";
import { tryCatch } from "@openbeacon/shared";
import { DevicePendingError } from "../lib/deviceActivation.ts";
import { DeviceUnverifiedError } from "../lib/deviceUnverified.ts";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const publicProcedures = ["auth.providers", "feedback.submit"];

const setupProcedures = [
  "account.deletionVerificationMethods",
  "account.removeThisDevice",
  "account.version",
  "accountRecovery.escrows",
  "accountRecovery.requestResetCode",
  "accountRecovery.reset",
  "accountRecovery.status",
  "accountRecovery.verifyResetCode",
  "auth.deviceKeyContext",
  "auth.registerDeviceKey",
  "device.activate",
  "device.activationChallenge",
  "device.linkSession",
  "device.sessionChallenge",
  "device.status",
  "deviceLink.create",
  "deviceLink.status",
];

const procedures = Object.keys(appRouter._def.procedures);

const callEach = async (
  device: { deviceId: string | null; unverifiedDeviceId: string | null; deviceActive: boolean },
  paths: string[],
) => {
  const caller = appRouter.createCaller({
    cache: new TestCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    }),
    clientIp: "203.0.113.10",
    db: new Proxy(
      {},
      {
        get: () => {
          throw new Error("The database was reached.");
        },
      },
    ),
    emailCodes: null,
    securityAlerts: null,
    session: {
      session: { id: "session-1", createdAt: new Date() },
      user: { id: "user-1", email: "user@example.com" },
    },
    ...device,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  const routes = caller as unknown as Record<
    string,
    Record<string, (input?: unknown) => Promise<unknown>>
  >;
  return new Map(
    await Promise.all(
      paths.map(async (path) => {
        const [router, procedure] = path.split(".");
        return [path, (await tryCatch(routes[router!]![procedure!]!())).error] as const;
      }),
    ),
  );
};

const causeOf = (error: unknown) =>
  error instanceof Error && "cause" in error ? error.cause : undefined;

describe("API authentication", () => {
  test("rejects anonymous access to every non-public procedure", async () => {
    const caller = appRouter.createCaller({ session: null } as Parameters<
      typeof appRouter.createCaller
    >[0]);
    expect(procedures).toContain("auth.providers");
    for (const path of procedures.filter((name) => !publicProcedures.includes(name))) {
      const [router, procedure] = path.split(".");
      const routes = caller as unknown as Record<
        string,
        Record<string, (input?: unknown) => Promise<unknown>>
      >;
      await expect(routes[router!]![procedure!]()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  test("lets a phone that isn't set up yet call only the setup procedures", async () => {
    const errors = await callEach(
      { deviceId: "pending-device", unverifiedDeviceId: null, deviceActive: false },
      procedures.filter((path) => !publicProcedures.includes(path)),
    );
    const allowed = [...errors]
      .filter(([, error]) => !(causeOf(error) instanceof DevicePendingError))
      .map(([path]) => path)
      .sort();
    expect(allowed).toEqual(setupProcedures);
  });

  test("asks an unconfirmed sign-in to confirm its phone before anything outside setup", async () => {
    const errors = await callEach(
      { deviceId: null, unverifiedDeviceId: "unconfirmed-device", deviceActive: false },
      procedures.filter(
        (path) => !publicProcedures.includes(path) && !setupProcedures.includes(path),
      ),
    );
    for (const error of errors.values()) {
      expect(causeOf(error)).toBeInstanceOf(DeviceUnverifiedError);
    }
  });

  test("treats a sign-in with no phone as not set up", async () => {
    const errors = await callEach(
      { deviceId: null, unverifiedDeviceId: null, deviceActive: false },
      procedures.filter(
        (path) => !publicProcedures.includes(path) && !setupProcedures.includes(path),
      ),
    );
    for (const error of errors.values()) {
      expect(causeOf(error)).toBeInstanceOf(DevicePendingError);
    }
  });

  test("lets a set-up phone past the device check everywhere", async () => {
    const errors = await callEach(
      { deviceId: "active-device", unverifiedDeviceId: null, deviceActive: true },
      procedures.filter((path) => !publicProcedures.includes(path)),
    );
    for (const [path, error] of errors) {
      expect([path, causeOf(error) instanceof DevicePendingError]).toEqual([path, false]);
    }
  });
});
