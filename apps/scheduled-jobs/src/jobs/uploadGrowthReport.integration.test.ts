import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { findTopUploadGrowth, runUploadGrowthReport } from "./uploadGrowthReport.ts";

const prefix = `upload-growth-${crypto.randomUUID()}`;
const heavyId = `${prefix}-heavy`;
const lightId = `${prefix}-light`;
const groupIds = [`${prefix}-group-1`, `${prefix}-group-2`];
const hour = 60 * 60_000;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("upload growth report", () => {
  beforeAll(async () => {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    const ago = (hours: number) => new Date(clock.now.getTime() - hours * hour);
    await prisma.user.createMany({
      data: [heavyId, lightId].map((id) => ({ id, name: id, email: `${id}@example.test` })),
    });
    await prisma.userDevice.createMany({
      data: [heavyId, lightId].map((userId) => ({
        id: `${userId}-device`,
        userId,
        icon: "phone" as const,
        name: "Phone",
        publicKey: "public-key",
        publicKeyAlgorithm: "X25519",
        activatedAt: clock.now,
      })),
    });
    for (const groupId of groupIds) {
      await prisma.group.create({
        data: {
          id: groupId,
          name: groupId,
          groupEpochs: {
            create: {
              id: `${groupId}-epoch`,
              epochNumber: 1,
              createdByDeviceId: `${heavyId}-device`,
              senderPublicKey: "public-key",
            },
          },
        },
      });
    }
    const points = (userId: string, groupId: string, count: number, hoursAgo: number) =>
      Array.from({ length: count }, (_, index) => ({
        groupId,
        epochId: `${groupId}-epoch`,
        senderDeviceId: `${userId}-device`,
        senderUserId: userId,
        kind: TRACKING_POINT_KIND,
        algorithm: "xchacha20poly1305",
        nonce: "nonce",
        ciphertext: "ciphertext",
        clientPointId: `${userId}-${hoursAgo}-${index}`,
        createdAt: ago(hoursAgo),
      }));
    await prisma.groupEncryptedPayload.createMany({
      data: [
        ...points(heavyId, groupIds[0]!, 20, 1),
        ...points(heavyId, groupIds[1]!, 10, 23),
        ...points(lightId, groupIds[0]!, 3, 2),
        ...points(lightId, groupIds[1]!, 40, 25),
      ],
    });
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.userDevice.deleteMany({ where: { userId: { in: [heavyId, lightId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [heavyId, lightId] } } });
  });

  test("ranks accounts by points stored in the last 24 hours and ignores older points", async () => {
    const accounts = (await findTopUploadGrowth({ limit: 1_000 })).filter(({ userId }) =>
      userId.startsWith(prefix),
    );

    expect(accounts).toEqual([
      { userId: heavyId, groups: 2, points: 30 },
      { userId: lightId, groups: 1, points: 3 },
    ]);
  });

  test("logs the report for the operator", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    await runUploadGrowthReport();

    expect(log).toHaveBeenCalledWith(
      "Accounts with the most location points stored in the last 24 hours",
      expect.any(Array),
    );
    log.mockRestore();
  });
});
