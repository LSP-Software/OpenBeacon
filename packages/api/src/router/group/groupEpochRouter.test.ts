import { describe, expect, test } from "bun:test";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";

describe("groupEpochRouter", () => {
  test("getWrappedKey returns epochId in the wrapped key shape", async () => {
    const wrappedKeyCreatedAt = new Date("2026-03-26T12:00:00.000Z");
    const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
    const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;

    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "test-secret-000000000000000000000000";

    try {
      const [{ createTRPCRouter }, { groupEpochRouter }] = await Promise.all([
        import("../../trpc.ts"),
        import(`./groupEpochRouter.ts?test=${Math.random().toString(36).slice(2)}`),
      ]);
      const router = createTRPCRouter({
        groupEpoch: groupEpochRouter,
      });
      const caller = router.createCaller({
        db: {
          groupMember: {
            findFirst: async () => ({
              id: "group-member-1",
            }),
          },
          groupEpochRecipientKey: {
            findFirst: async () => ({
              algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
              createdAt: wrappedKeyCreatedAt,
              ephemeralPublicKey: "ephemeral-public-key",
              groupEpochId: "epoch-1",
              nonce: "nonce-1",
              recipientDeviceId: "device-1",
              wrappedKey: "wrapped-key-1",
            }),
          },
        },
        session: {
          user: {
            id: "user-1",
          },
        },
      } as never);

      const result = await caller.groupEpoch.getWrappedKey({
        deviceId: "device-1",
        epochId: "epoch-1",
        groupId: "group-1",
      });

      expect(result).toEqual({
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: wrappedKeyCreatedAt,
        ephemeralPublicKey: "ephemeral-public-key",
        epochId: "epoch-1",
        nonce: "nonce-1",
        recipientDeviceId: "device-1",
        wrappedKey: "wrapped-key-1",
      });
    } finally {
      if (originalBetterAuthUrl === undefined) {
        delete process.env.BETTER_AUTH_URL;
      } else {
        process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
      }

      if (originalBetterAuthSecret === undefined) {
        delete process.env.BETTER_AUTH_SECRET;
      } else {
        process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
      }
    }
  });
});
