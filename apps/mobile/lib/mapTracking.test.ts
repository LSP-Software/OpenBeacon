import { describe, expect, test } from "bun:test";
import type { LiveMapEntry } from "./liveMapReducer.ts";
import { createMapTrackingSession } from "./mapTracking.ts";
import type { MapTrackingDeps, MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";

const point = ({
  createdAt,
  epochId = "epoch-1",
  id,
  senderUserId,
}: {
  createdAt: Date;
  epochId?: string;
  id: string;
  senderUserId: string;
}): MapTrackingEncryptedPoint => ({
  algorithm: "XChaCha20-Poly1305",
  ciphertext: `cipher-${id}`,
  clientPointId: `client-${id}`,
  createdAt,
  epochId,
  id,
  kind: "trackingPoint",
  nonce: `nonce-${id}`,
  senderDeviceId: `device-${senderUserId}`,
  senderUserId,
});

const liveEntry = ({
  sourceGroupId,
  timestamp,
  userId,
  serverCreatedAt,
  serverId,
}: {
  serverCreatedAt: Date;
  serverId: string;
  sourceGroupId: string;
  timestamp: string;
  userId: string;
}): LiveMapEntry => ({
  battery: { charging: false, level: 80 },
  latitude: 51.5,
  longitude: -0.12,
  serverCreatedAt,
  serverId,
  sourceGroupId,
  speed: null,
  timestamp,
  userId,
});

const createSession = (overrides: Partial<MapTrackingDeps> = {}) => {
  const getLatestCalls: string[] = [];
  const pollCalls: Array<{
    cursor: { createdAt: Date; id: string } | null;
    groupId: string;
    limit: number;
  }> = [];
  let now = 0;
  const scheduled: Array<{ cancel: () => void; delayMs: number; fn: () => void }> = [];

  const baseDecrypt: MapTrackingDeps["decryptPoint"] = async ({ groupId, point: row }) => ({
    status: "ok",
    entry: liveEntry({
      serverCreatedAt: row.createdAt,
      serverId: row.id,
      sourceGroupId: groupId,
      timestamp: row.createdAt.toISOString(),
      userId: row.senderUserId,
    }),
  });
  const baseGetLatest: MapTrackingDeps["getLatest"] = async () => ({ points: [] });
  const basePoll: MapTrackingDeps["poll"] = async () => ({ points: [] });

  const deps: MapTrackingDeps = {
    clearEpochKeys: overrides.clearEpochKeys ?? (() => {}),
    decryptPoint: overrides.decryptPoint ?? baseDecrypt,
    getLatest: async (groupId) => {
      getLatestCalls.push(groupId);
      return (overrides.getLatest ?? baseGetLatest)(groupId);
    },
    listGroups: overrides.listGroups ?? (async () => [{ id: "group-1" }]),
    now: () => now,
    poll: async (input) => {
      pollCalls.push(input);
      return (overrides.poll ?? basePoll)(input);
    },
    schedule:
      overrides.schedule ??
      ((fn, delayMs) => {
        let cancelled = false;
        const handle = {
          cancel: () => {
            cancelled = true;
          },
          delayMs,
          fn: () => {
            if (!cancelled) {
              fn();
            }
          },
        };
        scheduled.push(handle);
        return handle;
      }),
  };

  const session = createMapTrackingSession(deps);

  return {
    getLatestCalls,
    pollCalls,
    scheduled,
    session,
    setNow: (value: number) => {
      now = value;
    },
  };
};

describe("createMapTrackingSession", () => {
  test("cold tick loads getLatest and exposes decryptable live positions", async () => {
    const row = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-1",
      senderUserId: "user-1",
    });
    const { getLatestCalls, pollCalls, session } = createSession({
      getLatest: async (groupId) => {
        expect(groupId).toBe("group-1");
        return { points: [row] };
      },
    });

    session.setActive(true);
    await session.tick();

    expect(getLatestCalls).toEqual(["group-1"]);
    expect(pollCalls).toEqual([]);
    expect(session.getLivePositions()).toEqual([
      {
        battery: { charging: false, level: 80 },
        latitude: 51.5,
        longitude: -0.12,
        sourceGroupId: "group-1",
        speed: null,
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-1",
      },
    ]);
  });

  test("empty cold start stays cold and retries getLatest on the next tick", async () => {
    const { getLatestCalls, pollCalls, session } = createSession({
      getLatest: async () => ({ points: [] }),
    });

    session.setActive(true);
    await session.tick();
    await session.tick();

    expect(getLatestCalls).toEqual(["group-1", "group-1"]);
    expect(pollCalls).toEqual([]);
    expect(session.getLivePositions()).toEqual([]);
  });

  test("after cold start, live ticks poll from the max cursor", async () => {
    const coldRows = [
      point({
        createdAt: new Date("2026-07-17T12:00:00.000Z"),
        id: "point-1",
        senderUserId: "user-1",
      }),
      point({
        createdAt: new Date("2026-07-17T12:00:01.000Z"),
        id: "point-2",
        senderUserId: "user-2",
      }),
    ];
    const liveRow = point({
      createdAt: new Date("2026-07-17T12:00:02.000Z"),
      id: "point-3",
      senderUserId: "user-1",
    });
    let coldDone = false;
    const { pollCalls, session } = createSession({
      getLatest: async () => {
        coldDone = true;
        return { points: coldRows };
      },
      poll: async () => ({ points: coldDone ? [liveRow] : [] }),
    });

    session.setActive(true);
    await session.tick();
    await session.tick();

    expect(pollCalls).toEqual([
      {
        cursor: {
          createdAt: new Date("2026-07-17T12:00:01.000Z"),
          id: "point-2",
        },
        groupId: "group-1",
        limit: 100,
      },
    ]);
    expect(
      session.getLivePositions().find((position) => position.userId === "user-1")?.timestamp,
    ).toBe("2026-07-17T12:00:02.000Z");
  });

  test("live catch-up polls again immediately when a page is full", async () => {
    const coldRow = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-0",
      senderUserId: "user-1",
    });
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      point({
        createdAt: new Date(Date.UTC(2026, 6, 17, 12, 0, 1 + index)),
        id: `page-1-${index}`,
        senderUserId: "user-1",
      }),
    );
    const partialPage = [
      point({
        createdAt: new Date("2026-07-17T12:02:00.000Z"),
        id: "page-2-0",
        senderUserId: "user-1",
      }),
    ];
    let pollCount = 0;
    const { pollCalls, session } = createSession({
      getLatest: async () => ({ points: [coldRow] }),
      poll: async () => {
        pollCount += 1;
        return { points: pollCount === 1 ? fullPage : partialPage };
      },
    });

    session.setActive(true);
    await session.tick();
    await session.tick();

    expect(pollCalls).toHaveLength(2);
    const lastFullPagePoint = fullPage[99];
    if (!lastFullPagePoint) {
      throw new Error("expected full page");
    }
    expect(pollCalls[1]?.cursor).toEqual({
      createdAt: lastFullPagePoint.createdAt,
      id: "page-1-99",
    });
    expect(session.getLivePositions()[0]?.timestamp).toBe("2026-07-17T12:02:00.000Z");
  });

  test("undecryptable points skip marker updates but still advance the cursor", async () => {
    const coldRow = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-0",
      senderUserId: "user-1",
    });
    const undecryptable = point({
      createdAt: new Date("2026-07-17T12:00:01.000Z"),
      id: "point-1",
      senderUserId: "user-2",
    });
    const later = point({
      createdAt: new Date("2026-07-17T12:00:02.000Z"),
      id: "point-2",
      senderUserId: "user-3",
    });
    let pollCount = 0;
    const { pollCalls, session } = createSession({
      decryptPoint: async ({ groupId, point: row }) => {
        if (row.id === "point-1") {
          return { status: "undecryptable" };
        }
        return {
          status: "ok",
          entry: liveEntry({
            serverCreatedAt: row.createdAt,
            serverId: row.id,
            sourceGroupId: groupId,
            timestamp: row.createdAt.toISOString(),
            userId: row.senderUserId,
          }),
        };
      },
      getLatest: async () => ({ points: [coldRow] }),
      poll: async () => {
        pollCount += 1;
        return { points: pollCount === 1 ? [undecryptable] : [later] };
      },
    });

    session.setActive(true);
    await session.tick();
    await session.tick();
    await session.tick();

    expect(
      session
        .getLivePositions()
        .map(({ userId }) => userId)
        .sort(),
    ).toEqual(["user-1", "user-3"]);
    expect(pollCalls[1]?.cursor).toEqual({
      createdAt: new Date("2026-07-17T12:00:01.000Z"),
      id: "point-1",
    });
  });

  test("inactive sessions do not tick", async () => {
    const { getLatestCalls, session } = createSession({
      getLatest: async () => ({
        points: [
          point({
            createdAt: new Date("2026-07-17T12:00:00.000Z"),
            id: "point-1",
            senderUserId: "user-1",
          }),
        ],
      }),
    });

    await session.tick();
    expect(getLatestCalls).toEqual([]);

    session.setActive(true);
    await session.tick();
    session.setActive(false);
    getLatestCalls.length = 0;
    await session.tick();
    expect(getLatestCalls).toEqual([]);
  });

  test("network failures back off 5 → 10 → 20 → 40 → 60 and reset on success", async () => {
    let shouldFail = true;
    const { scheduled, session } = createSession({
      getLatest: async () => {
        if (shouldFail) {
          throw new Error("network");
        }
        return {
          points: [
            point({
              createdAt: new Date("2026-07-17T12:00:00.000Z"),
              id: "point-1",
              senderUserId: "user-1",
            }),
          ],
        };
      },
    });

    session.setActive(true);
    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(5_000);

    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(10_000);

    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(20_000);

    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(40_000);

    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(60_000);

    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(60_000);

    shouldFail = false;
    await session.tick();
    expect(scheduled.at(-1)?.delayMs).toBe(5_000);
  });

  test("every five minutes while live, getLatest reconcile runs alongside poll", async () => {
    const coldRow = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-0",
      senderUserId: "user-1",
    });
    const { getLatestCalls, pollCalls, session, setNow } = createSession({
      getLatest: async () => ({ points: [coldRow] }),
      poll: async () => ({ points: [] }),
    });

    session.setActive(true);
    await session.tick();
    expect(getLatestCalls).toEqual(["group-1"]);

    setNow(5 * 60_000 - 1);
    await session.tick();
    expect(getLatestCalls).toEqual(["group-1"]);
    expect(pollCalls).toHaveLength(1);

    setNow(5 * 60_000);
    await session.tick();
    expect(getLatestCalls).toEqual(["group-1", "group-1"]);
    expect(pollCalls).toHaveLength(2);
  });

  test("merges decryptable points across groups by senderUserId", async () => {
    const { session } = createSession({
      getLatest: async (groupId) => ({
        points: [
          point({
            createdAt: new Date(
              groupId === "group-1" ? "2026-07-17T12:00:00.000Z" : "2026-07-17T12:00:01.000Z",
            ),
            id: groupId,
            senderUserId: "user-1",
          }),
        ],
      }),
      listGroups: async () => [{ id: "group-1" }, { id: "group-2" }],
    });

    session.setActive(true);
    await session.tick();

    expect(session.getLivePositions()).toEqual([
      {
        battery: { charging: false, level: 80 },
        latitude: 51.5,
        longitude: -0.12,
        sourceGroupId: "group-2",
        speed: null,
        timestamp: "2026-07-17T12:00:01.000Z",
        userId: "user-1",
      },
    ]);
  });

  test("drops live positions whose source group is no longer in membership", async () => {
    let groups = [{ id: "group-1" }, { id: "group-2" }];
    const { session } = createSession({
      getLatest: async (groupId) => ({
        points: [
          point({
            createdAt: new Date("2026-07-17T12:00:00.000Z"),
            id: groupId,
            senderUserId: groupId === "group-1" ? "user-1" : "user-2",
          }),
        ],
      }),
      listGroups: async () => groups,
    });

    session.setActive(true);
    await session.tick();
    expect(
      session
        .getLivePositions()
        .map(({ userId }) => userId)
        .sort(),
    ).toEqual(["user-1", "user-2"]);

    groups = [{ id: "group-2" }];
    await session.tick();
    expect(session.getLivePositions()).toEqual([
      {
        battery: { charging: false, level: 80 },
        latitude: 51.5,
        longitude: -0.12,
        sourceGroupId: "group-2",
        speed: null,
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-2",
      },
    ]);
  });

  test("keeps a user's older position from a remaining group after the winning group leaves", async () => {
    let groups = [{ id: "group-1" }, { id: "group-2" }];
    const { session } = createSession({
      getLatest: async (groupId) => ({
        points: [
          point({
            createdAt: new Date(
              groupId === "group-1" ? "2026-07-17T12:00:00.000Z" : "2026-07-17T12:00:01.000Z",
            ),
            id: groupId,
            senderUserId: "user-1",
          }),
        ],
      }),
      listGroups: async () => groups,
      poll: async () => ({ points: [] }),
    });

    session.setActive(true);
    await session.tick();
    expect(session.getLivePositions()[0]?.sourceGroupId).toBe("group-2");

    groups = [{ id: "group-1" }];
    await session.tick();
    expect(session.getLivePositions()).toEqual([
      {
        battery: { charging: false, level: 80 },
        latitude: 51.5,
        longitude: -0.12,
        sourceGroupId: "group-1",
        speed: null,
        timestamp: "2026-07-17T12:00:00.000Z",
        userId: "user-1",
      },
    ]);
  });

  test("stops catch-up when a full page does not advance the cursor", async () => {
    const coldRow = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-0",
      senderUserId: "user-1",
    });
    const stuckPage = Array.from({ length: 100 }, (_, index) =>
      point({
        createdAt: new Date("2026-07-17T12:00:01.000Z"),
        id: `stuck-${index}`,
        senderUserId: "user-1",
      }),
    );
    let pollCount = 0;
    const { session } = createSession({
      getLatest: async () => ({ points: [coldRow] }),
      poll: async () => {
        pollCount += 1;
        return { points: stuckPage };
      },
    });

    session.setActive(true);
    await session.tick();
    await session.tick();
    expect(pollCount).toBe(2);

    await session.tick();
    expect(pollCount).toBe(3);
  });

  test("stops catch-up when the session becomes inactive", async () => {
    const coldRow = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-0",
      senderUserId: "user-1",
    });
    const firstPoll = {
      resolve: null as null | ((value: { points: MapTrackingEncryptedPoint[] }) => void),
    };
    let pollCount = 0;
    const { session } = createSession({
      getLatest: async () => ({ points: [coldRow] }),
      poll: async () => {
        pollCount += 1;
        if (pollCount === 1) {
          return await new Promise<{ points: MapTrackingEncryptedPoint[] }>((resolve) => {
            firstPoll.resolve = resolve;
          });
        }
        return {
          points: Array.from({ length: 100 }, (_, index) =>
            point({
              createdAt: new Date(Date.UTC(2026, 6, 17, 12, 1, index)),
              id: `page-2-${index}`,
              senderUserId: "user-1",
            }),
          ),
        };
      },
    });

    session.setActive(true);
    await session.tick();
    const liveTickPromise = session.tick();
    await Promise.resolve();
    session.setActive(false);
    firstPoll.resolve?.({
      points: Array.from({ length: 100 }, (_, index) =>
        point({
          createdAt: new Date(Date.UTC(2026, 6, 17, 12, 0, 1 + index)),
          id: `page-1-${index}`,
          senderUserId: "user-1",
        }),
      ),
    });
    await liveTickPromise;

    expect(pollCount).toBe(1);
  });

  test("clears epoch keys for removed groups and on destroy", async () => {
    const cleared: Array<string | undefined> = [];
    const coldRow = point({
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      id: "point-0",
      senderUserId: "user-1",
    });
    let groups = [{ id: "group-1" }, { id: "group-2" }];
    const { session } = createSession({
      clearEpochKeys: (groupId) => {
        cleared.push(groupId);
      },
      getLatest: async () => ({ points: [coldRow] }),
      listGroups: async () => groups,
    });

    session.setActive(true);
    await session.tick();

    groups = [{ id: "group-1" }];
    await session.tick();
    expect(cleared).toEqual(["group-2"]);

    session.destroy();
    expect(cleared).toEqual(["group-2", undefined]);
  });
});
