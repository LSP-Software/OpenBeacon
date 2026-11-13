import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import type { TRPCError } from "@trpc/server";
import {
  getLatestGroupTrackingPoints,
  pollGroupTrackingPoints,
  uploadGroupTrackingBatch,
} from "./groupTracking.ts";

import { sharingDeviceRow } from "./locationSharing.testUtil.ts";

const validNonce = Buffer.alloc(24, 1).toString("base64");

const createPoint = (
  overrides: Partial<{
    clientPointId: string;
    epochId: string;
    senderDeviceId: string;
  }> = {},
) => ({
  algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
  ciphertext: "ciphertext",
  clientPointId: overrides.clientPointId ?? "point-1",
  epochId: overrides.epochId ?? "epoch-1",
  kind: TRACKING_POINT_KIND,
  nonce: validNonce,
  senderDeviceId: overrides.senderDeviceId ?? "device-1",
});

describe("uploadGroupTrackingBatch", () => {
  let createMany: ReturnType<typeof mock>;
  let findManyPayloads: ReturnType<typeof mock>;
  let findManyEpochs: ReturnType<typeof mock>;
  let countEpochs: ReturnType<typeof mock>;
  let findManyDevices: ReturnType<typeof mock>;
  let updateManyDevices: ReturnType<typeof mock>;

  beforeEach(() => {
    createMany = mock(async () => ({ count: 1 }));
    findManyPayloads = mock(async () => []);
    findManyEpochs = mock(async () => [{ id: "epoch-1" }]);
    countEpochs = mock(async () => 1);
    findManyDevices = mock(async () => [{ id: "device-1", userId: "user-1" }]);
    updateManyDevices = mock(async () => ({ count: 1 }));
  });

  const createDb = () => ({
    $queryRaw: mock(async () => [sharingDeviceRow]),
    groupEncryptedPayload: {
      createMany,
      findMany: findManyPayloads,
    },
    groupEpoch: {
      count: countEpochs,
      findMany: findManyEpochs,
    },
    userDevice: {
      findMany: findManyDevices,
      updateMany: updateManyDevices,
    },
  });

  test("inserts points and derives senderUserId from the session user", async () => {
    const result = await uploadGroupTrackingBatch({
      consumeDailyBudget: async () => {},
      db: createDb(),
      groupId: "group-1",
      points: [createPoint()],
      userId: "user-1",
    });

    expect(result).toEqual({
      accepted: ["point-1"],
      discarded: [],
      duplicates: [],
      expired: [],
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: "ciphertext",
          clientPointId: "point-1",
          epochId: "epoch-1",
          groupId: "group-1",
          kind: TRACKING_POINT_KIND,
          nonce: validNonce,
          senderDeviceId: "device-1",
          senderUserId: "user-1",
        },
      ],
      skipDuplicates: true,
    });
    expect(updateManyDevices).toHaveBeenCalledWith({
      data: { lastLocationAt: expect.any(Date) },
      where: { id: { in: ["device-1"] }, userId: "user-1" },
    });
  });

  test("rejects an epoch from before the current membership", async () => {
    const memberSince = new Date("2026-10-29T12:00:00Z");
    findManyEpochs = mock(async () => []);

    await expect(
      uploadGroupTrackingBatch({
        consumeDailyBudget: async () => {},
        db: createDb(),
        groupId: "group-1",
        memberSince,
        points: [createPoint()],
        userId: "user-1",
      }),
    ).rejects.toThrow("Epoch does not belong to this group.");
    expect(findManyEpochs).toHaveBeenCalledWith({
      select: { id: true },
      where: { groupId: "group-1", id: { in: ["epoch-1"] }, createdAt: { gte: memberSince } },
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  test("returns duplicates without inserting existing clientPointIds", async () => {
    findManyPayloads = mock(async () => [{ clientPointId: "point-1" }]);

    const result = await uploadGroupTrackingBatch({
      consumeDailyBudget: async () => {},
      db: createDb(),
      groupId: "group-1",
      points: [createPoint()],
      userId: "user-1",
    });

    expect(result).toEqual({
      accepted: [],
      discarded: [],
      duplicates: ["point-1"],
      expired: [],
    });
    expect(createMany).not.toHaveBeenCalled();
    expect(updateManyDevices).not.toHaveBeenCalled();
  });

  test("partitions mixed accepted and duplicate clientPointIds in one batch", async () => {
    findManyPayloads = mock(async () => [{ clientPointId: "point-1" }]);

    const result = await uploadGroupTrackingBatch({
      consumeDailyBudget: async () => {},
      db: createDb(),
      groupId: "group-1",
      points: [
        createPoint({ clientPointId: "point-1" }),
        createPoint({ clientPointId: "point-2" }),
      ],
      userId: "user-1",
    });

    expect(result).toEqual({
      accepted: ["point-2"],
      discarded: [],
      duplicates: ["point-1"],
      expired: [],
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: "ciphertext",
          clientPointId: "point-2",
          epochId: "epoch-1",
          groupId: "group-1",
          kind: TRACKING_POINT_KIND,
          nonce: validNonce,
          senderDeviceId: "device-1",
          senderUserId: "user-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  test("rejects duplicate clientPointIds inside one batch", async () => {
    await expect(
      uploadGroupTrackingBatch({
        consumeDailyBudget: async () => {},
        db: createDb(),
        groupId: "group-1",
        points: [createPoint(), createPoint()],
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Duplicate clientPointId values in upload batch.",
    } satisfies Partial<TRPCError>);
  });

  test("rejects revoked or foreign devices", async () => {
    findManyDevices = mock(async () => []);

    await expect(
      uploadGroupTrackingBatch({
        consumeDailyBudget: async () => {},
        db: createDb(),
        groupId: "group-1",
        points: [createPoint()],
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "The active device is not registered.",
    } satisfies Partial<TRPCError>);
  });

  test("rejects epochs that do not belong to the group", async () => {
    findManyEpochs = mock(async () => []);

    await expect(
      uploadGroupTrackingBatch({
        consumeDailyBudget: async () => {},
        db: createDb(),
        groupId: "group-1",
        points: [createPoint()],
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Epoch does not belong to this group.",
    } satisfies Partial<TRPCError>);
    expect(countEpochs).toHaveBeenCalledWith({ where: { id: { in: ["epoch-1"] } } });
  });

  test("reports points for deleted epochs as expired and stores the rest", async () => {
    findManyEpochs = mock(async () => [{ id: "epoch-2" }]);
    countEpochs = mock(async () => 0);

    const result = await uploadGroupTrackingBatch({
      consumeDailyBudget: async () => {},
      db: createDb(),
      groupId: "group-1",
      points: [
        createPoint({ clientPointId: "old", epochId: "deleted-epoch" }),
        createPoint({ clientPointId: "new", epochId: "epoch-2" }),
      ],
      userId: "user-1",
    });

    expect(result).toEqual({ accepted: ["new"], discarded: [], duplicates: [], expired: ["old"] });
    expect(countEpochs).toHaveBeenCalledWith({ where: { id: { in: ["deleted-epoch"] } } });
    expect(createMany.mock.calls[0]?.[0]).toMatchObject({
      data: [{ clientPointId: "new", epochId: "epoch-2" }],
    });
  });

  test("stores nothing when every point's epoch was deleted", async () => {
    findManyEpochs = mock(async () => []);
    countEpochs = mock(async () => 0);

    const result = await uploadGroupTrackingBatch({
      consumeDailyBudget: async () => {},
      db: createDb(),
      groupId: "group-1",
      points: [createPoint()],
      userId: "user-1",
    });

    expect(result).toEqual({ accepted: [], discarded: [], duplicates: [], expired: ["point-1"] });
    expect(createMany).not.toHaveBeenCalled();
    expect(updateManyDevices).not.toHaveBeenCalled();
  });
});

describe("pollGroupTrackingPoints", () => {
  test("a full filtered page still signals a backlog and advances its scan cursor", async () => {
    const rows = ["first", "second"].map((id) => ({
      algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
      ciphertext: "ciphertext",
      clientPointId: id,
      createdAt: new Date("2026-07-13T18:00:00.000Z"),
      epochId: "epoch-1",
      id,
      kind: TRACKING_POINT_KIND,
      nonce: validNonce,
      senderDeviceId: "device-1",
      senderUserId: "user-1",
    }));
    const result = await pollGroupTrackingPoints({
      db: {
        $queryRaw: mock(async () => [{ ...sharingDeviceRow, sharingPaused: true }]),
        groupEncryptedPayload: {
          createMany: mock(async () => ({ count: 0 })),
          findMany: mock(async () => rows),
        },
        groupEpoch: { findMany: mock(async () => []), findUnique: mock(async () => null) },
        userDevice: {
          findMany: mock(async () => []),
          updateMany: mock(async () => ({ count: 0 })),
        },
      },
      groupId: "group-1",
      joinedEpochNumber: 1,
      limit: 2,
    });
    expect(result.points).toEqual([]);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toEqual({ id: "second", createdAt: rows[1]!.createdAt });
  });

  test("queries with exclusive cursor ordering", async () => {
    const createdAt = new Date("2026-07-13T18:00:00.000Z");
    const findMany = mock(async () => [
      {
        algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
        ciphertext: "ciphertext",
        clientPointId: "point-2",
        createdAt: new Date("2026-07-13T18:00:01.000Z"),
        epochId: "epoch-1",
        id: "id-2",
        kind: TRACKING_POINT_KIND,
        nonce: validNonce,
        senderDeviceId: "device-1",
        senderUserId: "user-1",
      },
    ]);
    const findUnique = mock(async () => ({ createdAt: new Date(0) }));

    const result = await pollGroupTrackingPoints({
      cursor: { createdAt, id: "id-1" },
      db: {
        $queryRaw: mock(async () => [sharingDeviceRow]),
        groupEncryptedPayload: {
          createMany: mock(async () => ({ count: 0 })),
          findMany,
        },
        groupEpoch: {
          findMany: mock(async () => []),
          findUnique,
        },
        userDevice: {
          findMany: mock(async () => []),
          updateMany: mock(async () => ({ count: 0 })),
        },
      },
      groupId: "group-1",
      joinedEpochNumber: 3,
      limit: 100,
    });

    expect(result.points).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        algorithm: true,
        ciphertext: true,
        clientPointId: true,
        createdAt: true,
        epochId: true,
        id: true,
        kind: true,
        nonce: true,
        senderDeviceId: true,
        senderUserId: true,
      },
      take: 100,
      where: {
        groupId: "group-1",
        epoch: { epochNumber: { gte: 3 } },
        createdAt: { gte: createdAt },
        OR: [
          { createdAt: { gt: createdAt } },
          {
            AND: [{ createdAt }, { id: { gt: "id-1" } }],
          },
        ],
      },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  test("a first poll starts at the reader's join epoch and skips earlier epochs", async () => {
    const joinedAt = new Date("2026-07-13T17:00:00.000Z");
    const findMany = mock(async () => []);
    const findUnique = mock(async () => ({ createdAt: joinedAt }));

    await pollGroupTrackingPoints({
      cursor: null,
      db: {
        $queryRaw: mock(async () => [sharingDeviceRow]),
        groupEncryptedPayload: {
          createMany: mock(async () => ({ count: 0 })),
          findMany,
        },
        groupEpoch: { findMany: mock(async () => []), findUnique },
        userDevice: {
          findMany: mock(async () => []),
          updateMany: mock(async () => ({ count: 0 })),
        },
      },
      groupId: "group-1",
      joinedEpochNumber: 4,
      limit: 100,
    });

    expect(findUnique).toHaveBeenCalledWith({
      select: { createdAt: true },
      where: { groupId_epochNumber: { epochNumber: 4, groupId: "group-1" } },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          groupId: "group-1",
          epoch: { epochNumber: { gte: 4 } },
          createdAt: { gte: joinedAt },
        },
      }),
    );
  });
});

describe("getLatestGroupTrackingPoints", () => {
  test("looks up the newest point of each member's devices instead of sorting the whole group", async () => {
    const queryRaw = mock(async (_query?: { strings: string[] }) => [
      {
        algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
        ciphertext: "ciphertext",
        clientPointId: "point-1",
        createdAt: new Date("2026-07-13T18:00:00.000Z"),
        epochId: "epoch-1",
        id: "id-1",
        kind: TRACKING_POINT_KIND,
        nonce: validNonce,
        senderDeviceId: "device-1",
        senderUserId: "user-1",
      },
    ]);

    const result = await getLatestGroupTrackingPoints({
      db: {
        $queryRaw: mock(async (query: { strings: string[] }) =>
          query.strings.join("").includes('JOIN "User" AS "account"')
            ? [sharingDeviceRow]
            : queryRaw(query),
        ),
        groupEncryptedPayload: {
          createMany: mock(async () => ({ count: 0 })),
          findMany: mock(async () => []),
        },
        groupEpoch: {
          findMany: mock(async () => []),
          findUnique: mock(async () => null),
        },
        userDevice: {
          findMany: mock(async () => []),
          updateMany: mock(async () => ({ count: 0 })),
        },
      },
      groupId: "group-1",
      joinedEpochNumber: 2,
    });

    expect(result.points).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalled();
    const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    const sqlText = sql.strings.join("?");
    expect(sqlText).not.toContain("DISTINCT ON");
    expect(sqlText).toContain('FROM "GroupMember" AS "member"');
    expect(sqlText).toContain("CROSS JOIN LATERAL");
    expect(sqlText).toContain('"device"."revokedAt" IS NULL');
    expect(sqlText).toContain('"point"."senderDeviceId" = "device"."id"');
    expect(sqlText).toContain('ORDER BY "point"."createdAt" DESC, "point"."id" DESC');
    expect(sqlText).toContain("LIMIT 1");
    const lateral = sqlText.slice(
      sqlText.indexOf("CROSS JOIN LATERAL"),
      sqlText.indexOf("LIMIT 1"),
    );
    expect(lateral).toContain('"epoch"."epochNumber" >= ?');
    expect(sql.values).toEqual([2, "group-1"]);
  });
});
