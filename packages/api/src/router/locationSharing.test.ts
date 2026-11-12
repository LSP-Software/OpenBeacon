import { expect, mock, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountRouter } from "./accountRouter.ts";

test("a delayed sharing change cannot mutate the newly signed-in account", async () => {
  const transaction = mock(async () => {
    throw new Error("The database must not be reached.");
  });
  const router = createTRPCRouter({ account: accountRouter });
  const caller = router.createCaller({
    cache: createIntegrationTestCache(() => 0),
    db: { $transaction: transaction },
    clientIp: "127.0.0.1",
    deviceId: "new-account-phone",
    deviceActive: true,
    session: { user: { id: "new-account" }, session: { id: "new-session" } },
  } as Parameters<typeof router.createCaller>[0]);
  await expect(
    caller.account.setLocationSharing({
      scope: "account",
      expectedUserId: "previous-account",
      paused: true,
      durationMinutes: null,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller.account.setLocationSharing({
      scope: "device",
      expectedUserId: "previous-account",
      deviceId: "previous-phone",
      paused: false,
      durationMinutes: null,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(transaction).not.toHaveBeenCalled();
});

test("an authenticated request whose linked session ended cannot resume sharing", async () => {
  const findSession = mock(async () => null);
  const update = mock(async () => ({}));
  const tx = {
    $queryRaw: mock(async () => []),
    session: { findFirst: findSession },
    user: { update },
  };
  const router = createTRPCRouter({ account: accountRouter });
  const caller = router.createCaller({
    cache: createIntegrationTestCache(() => 0),
    db: { $transaction: async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx) },
    clientIp: "127.0.0.1",
    deviceId: "removed-phone",
    deviceActive: true,
    session: { user: { id: "alex" }, session: { id: "ended-session" } },
  } as Parameters<typeof router.createCaller>[0]);
  await expect(
    caller.account.setLocationSharing({
      scope: "account",
      expectedUserId: "alex",
      paused: false,
      durationMinutes: null,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(findSession).toHaveBeenCalledWith({
    where: {
      id: "ended-session",
      userId: "alex",
      deviceId: "removed-phone",
      expiresAt: { gt: expect.any(Date) },
      device: { is: { userId: "alex", revokedAt: null, activatedAt: { not: null } } },
    },
    select: { id: true },
  });
  expect(update).not.toHaveBeenCalled();
});
