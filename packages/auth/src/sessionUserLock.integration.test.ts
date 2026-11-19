import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { createAuth } from "./createAuth.ts";

const email = `session-user-lock-${crypto.randomUUID()}@example.test`;
const password = "correct horse battery";
const auth = createAuth({
  emailCodes: null,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "session user lock with PostgreSQL",
  () => {
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email } });
      await prisma.$disconnect();
    });

    test("signing in doesn't wait for a transaction that is adding a row for the same account", async () => {
      await auth.api.signUpEmail({ body: { email, password, name: "Lock User" } });
      const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
      const outcome = await prisma.$transaction(
        async (tx) => {
          await tx.userDevice.create({
            data: {
              id: `${user.id}-device`,
              userId: user.id,
              publicKey: "public-key",
              publicKeyAlgorithm: "x25519",
              name: "Phone",
              icon: "phone",
            },
          });
          const signIn = auth.handler(
            new Request("http://localhost:3000/api/auth/sign-in/email", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, password }),
            }),
          );
          return Promise.race([
            signIn.then((response) => response.status),
            Bun.sleep(3_000).then(() => "waiting" as const),
          ]);
        },
        { timeout: 10_000 },
      );
      expect(outcome).toBe(200);
    }, 20_000);
  },
);
