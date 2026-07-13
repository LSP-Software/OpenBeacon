import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import type { TRPCError } from "@trpc/server";
import {
  getLatestGroupTrackingPoints,
  pollGroupTrackingPoints,
  uploadGroupTrackingBatch,
} from "./groupTracking.ts";

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
  let findManyDevices: ReturnType<typeof mock>;

  beforeEach(() => {
    createMany = mock(async () => ({ count: 1 }));
    findManyPayloads = mock(async () => []);
    findManyEpochs = mock(async () => [{ id: "epoch-1" }]);
    findManyDevices = mock(async () => [{ id: "device-1", userId: "user-1" }]);
  });

  const createDb = () => ({
    $queryRaw: mock(async () => []),
    groupEncryptedPayload: {
      createMany,
      findMany: findManyPayloads,
    },
    groupEpoch: {
      findMany: findManyEpochs,
    },
    userDevice: {
      findMany: findManyDevices,
    },
  });

  test("inserts points and derives senderUserId from the session user", async () => {
    const result = await uploadGroupTrackingBatch({
      db: createDb(),
      groupId: "group-1",
      points: [createPoint()],
      userId: "user-1",
    });

    expect(result).toEqual({
      accepted: ["point-1"],
      duplicates: [],
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
  });

  test("returns duplicates without inserting existing clientPointIds", async () => {
    findManyPayloads = mock(async () => [{ clientPointId: "point-1" }]);

    const result = await uploadGroupTrackingBatch({
      db: createDb(),
      groupId: "group-1",
      points: [createPoint()],
      userId: "user-1",
    });

    expect(result).toEqual({
      accepted: [],
      duplicates: ["point-1"],
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  test("partitions mixed accepted and duplicate clientPointIds in one batch", async () => {
    findManyPayloads = mock(async () => [{ clientPointId: "point-1" }]);

    const result = await uploadGroupTrackingBatch({
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
      duplicates: ["point-1"],
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
        db: createDb(),
        groupId: "group-1",
        points: [createPoint()],
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Epoch does not belong to this group.",
    } satisfies Partial<TRPCError>);
  });
});

describe("pollGroupTrackingPoints", () => {
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

    const result = await pollGroupTrackingPoints({
      cursor: { createdAt, id: "id-1" },
      db: {
        $queryRaw: mock(async () => []),
        groupEncryptedPayload: {
          createMany: mock(async () => ({ count: 0 })),
          findMany,
        },
        groupEpoch: {
          findMany: mock(async () => []),
        },
        userDevice: {
          findMany: mock(async () => []),
        },
      },
      groupId: "group-1",
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
        OR: [
          { createdAt: { gt: createdAt } },
          {
            AND: [{ createdAt }, { id: { gt: "id-1" } }],
          },
        ],
      },
    });
  });
});

describe("getLatestGroupTrackingPoints", () => {
  test("uses DISTINCT ON senderUserId ordering", async () => {
    const queryRaw = mock(async () => [
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
        $queryRaw: queryRaw,
        groupEncryptedPayload: {
          createMany: mock(async () => ({ count: 0 })),
          findMany: mock(async () => []),
        },
        groupEpoch: {
          findMany: mock(async () => []),
        },
        userDevice: {
          findMany: mock(async () => []),
        },
      },
      groupId: "group-1",
    });

    expect(result.points).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalled();
    const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[] };
    const sqlText = sql.strings.join("?");
    expect(sqlText).toContain('DISTINCT ON ("senderUserId")');
    expect(sqlText).toContain('ORDER BY "senderUserId" ASC, "createdAt" DESC, "id" DESC');
  });
});
