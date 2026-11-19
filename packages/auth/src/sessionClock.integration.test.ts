import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma, readDatabaseTime } from "@openbeacon/database";
import { createAuth } from "./createAuth.ts";

const email = `session-clock-${crypto.randomUUID()}@example.test`;
const password = "correct horse battery";
const auth = createAuth({
  emailCodes: null,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
});
const RealDate = Date;

const withApiClockOffset = async <T>(offsetMs: number, run: () => Promise<T>) => {
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args: unknown[]) =>
      args.length === 0
        ? new target(target.now() + offsetMs)
        : new (target as unknown as new (...values: unknown[]) => Date)(...args),
    get: (target, property) =>
      property === "now" ? () => target.now() + offsetMs : Reflect.get(target, property),
  });
  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "session times with PostgreSQL",
  () => {
    afterAll(async () => {
      globalThis.Date = RealDate;
      await prisma.user.deleteMany({ where: { email } });
      await prisma.$disconnect();
    });

    test("a notice raised just after signing in is not older than the session while the API clock is ahead", async () => {
      await auth.api.signUpEmail({ body: { email, password, name: "Clock User" } });
      const signedIn = await withApiClockOffset(10 * 60_000, () =>
        auth.api.signInEmail({ body: { email, password } }),
      );
      const session = await prisma.session.findUniqueOrThrow({
        where: { token: signedIn.token },
        select: { createdAt: true, userId: true },
      });
      const notice = await prisma.accountNotice.create({
        data: {
          userId: session.userId,
          type: "PASSWORD_CHANGED",
          createdAt: await readDatabaseTime(prisma),
        },
      });

      expect(notice.createdAt.getTime()).toBeGreaterThanOrEqual(session.createdAt.getTime());
    });
  },
);
