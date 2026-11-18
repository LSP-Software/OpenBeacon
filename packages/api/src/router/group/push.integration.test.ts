import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createFcmClient, type FcmSendResult } from "@openbeacon/auth/fcm.ts";
import { createPushSender } from "@openbeacon/auth/push.ts";
import { createSecurityAlerts } from "@openbeacon/auth/securityAlerts.ts";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { type AccountNoticeType, type GroupEventType, prisma } from "@openbeacon/database";
import { readAccountNotices, readGroupNotices } from "../../lib/accountNotices.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { encodeAlertsCursor, readPlaceAlerts } from "../../lib/placeTransitions.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountNoticesRouter } from "../accountNoticesRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const router = createTRPCRouter({
  accountNotices: accountNoticesRouter,
  groupTracking: groupTrackingRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `push-${crypto.randomUUID()}`;
const minute = 60_000;
const hour = 60 * minute;
const ago = (ms: number) => new Date(Date.now() - ms);
const longAgo = ago(30 * 24 * hour);
let fixtureCount = 0;
const createdUsers: string[] = [];
const createdGroups: string[] = [];

const timers: { ms: number; run: () => void }[] = [];
const tasks: Promise<unknown>[] = [];
const sent: string[] = [];
const replies = new Map<string, (FcmSendResult | (() => Promise<FcmSendResult>))[]>();
const fakeFcm = {
  send: async (token: string): Promise<FcmSendResult> => {
    sent.push(token);
    const reply = replies.get(token)?.shift();
    if (!reply) return { outcome: "sent" };
    return typeof reply === "function" ? reply() : reply;
  },
};
const testPush = (
  fcm: Parameters<typeof createPushSender>[0]["fcm"] = fakeFcm,
  now = () => Date.now(),
) =>
  createPushSender({
    db: prisma,
    fcm,
    setTimer: (run, ms) => timers.push({ ms, run }),
    runInBackground: (task) => tasks.push(task),
    now,
  });
const push = testPush();

const settle = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
};
const runTimers = async (ms: number) => {
  const due = timers.filter((timer) => timer.ms === ms);
  timers.splice(0, timers.length, ...timers.filter((timer) => timer.ms !== ms));
  for (const timer of due) timer.run();
  await settle();
};
const deliver = async () => {
  await settle();
  expect(timers.map(({ ms }) => ms)).toEqual(timers.map(() => 16_000));
  await runTimers(16_000);
  await runTimers(1_000);
};

const setup = async () => {
  fixtureCount += 1;
  const id = (name: string) => `${prefix}-${fixtureCount}-${name}`;
  const [alice, bob, carol, dave] = ["alice", "bob", "carol", "dave"].map(id) as [
    string,
    string,
    string,
    string,
  ];
  const groupId = id("family");
  const homeId = id("home");
  createdUsers.push(alice, bob, carol, dave);
  createdGroups.push(groupId);
  await prisma.user.createMany({
    data: [alice, bob, carol, dave].map((userId) => ({
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
    })),
  });
  const devices = {
    [`${alice}-phone`]: { userId: alice, state: "active" },
    [`${alice}-tablet`]: { userId: alice, state: "active" },
    [`${bob}-phone`]: { userId: bob, state: "active" },
    [`${bob}-tablet`]: { userId: bob, state: "active" },
    [`${bob}-new`]: { userId: bob, state: "pending" },
    [`${carol}-phone`]: { userId: carol, state: "active" },
    [`${dave}-phone`]: { userId: dave, state: "active" },
    [`${dave}-old`]: { userId: dave, state: "revoked" },
  } as const;
  await prisma.userDevice.createMany({
    data: Object.entries(devices).map(([deviceId, { userId, state }]) => ({
      id: deviceId,
      userId,
      name: deviceId,
      activatedAt: state === "pending" ? null : new Date(),
      revokedAt: state === "revoked" ? new Date() : null,
      icon: "phone" as const,
      publicKey: "public-key",
      publicKeyAlgorithm: "X25519",
    })),
  });
  await prisma.pushToken.createMany({
    data: Object.keys(devices).map((deviceId) => ({ deviceId, token: `${deviceId}-token` })),
  });
  await prisma.session.createMany({
    data: Object.entries(devices).map(([deviceId, { userId }]) => ({
      id: `${deviceId}-session`,
      token: `${deviceId}-session-token`,
      userId,
      deviceId,
      expiresAt: new Date(Date.now() + 24 * hour),
    })),
  });
  await prisma.group.create({
    data: {
      id: groupId,
      name: "Family",
      ownerId: alice,
      groupMembers: {
        create: [
          { userId: alice, role: "ADMIN", joinedEpochNumber: 1, createdAt: longAgo },
          { userId: bob, role: "MEMBER", joinedEpochNumber: 1, createdAt: longAgo },
          { userId: carol, role: "MEMBER", joinedEpochNumber: 1, createdAt: ago(hour) },
          { userId: dave, role: "MEMBER", joinedEpochNumber: 1, createdAt: longAgo },
        ],
      },
      groupEpochs: {
        create: [{ id: `${groupId}-epoch`, epochNumber: 1, senderPublicKey: "public-key" }],
      },
    },
  });
  await prisma.place.create({
    data: {
      id: homeId,
      groupId,
      name: "Home",
      emoji: "🏠",
      epochId: `${groupId}-epoch`,
      senderDeviceId: `${alice}-phone`,
      algorithm: "XChaCha20-Poly1305",
      nonce: "nonce",
      ciphertext: "ciphertext",
      createdByUserId: alice,
    },
  });
  const activeDevices = Object.entries(devices).flatMap(([deviceId, { userId, state }]) =>
    state === "active" ? [{ deviceId, userId }] : [],
  );
  const woken = () => [...new Set(sent.map((token) => token.slice(0, -"-token".length)))].sort();
  const before = encodeAlertsCursor({ createdAt: ago(10 * minute), id: "" });

  const arrive = async (
    userId: string,
    { occurredAt = ago(20_000), deviceId = `${userId}-phone` } = {},
  ) => {
    const clientId = crypto.randomUUID();
    const transition = await prisma.placeTransition.create({
      data: {
        placeId: homeId,
        groupId,
        deviceId,
        userId,
        direction: "ARRIVE",
        occurredAt,
        clientId,
        createdAt: ago(20_000),
      },
    });
    return { id: transition.id, deviceId, clientId };
  };
  const event = async (
    type: GroupEventType,
    data: { actorUserId?: string; subjectUserId?: string } = {},
  ) =>
    (
      await prisma.groupEvent.create({
        data: { groupId, type, createdAt: ago(20_000), ...data },
      })
    ).id;
  const notice = async (userId: string, type: AccountNoticeType, excludeDeviceId?: string) =>
    (
      await prisma.accountNotice.create({
        data: { userId, type, excludeDeviceId: excludeDeviceId ?? null, createdAt: ago(20_000) },
      })
    ).id;

  const readersFor = async (item: { kind: "place" | "event" | "notice"; id: string }) => {
    const readers: string[] = [];
    for (const { deviceId, userId } of activeDevices) {
      const ids =
        item.kind === "place"
          ? (await readPlaceAlerts({ cursor: before, db: prisma, userId })).alerts.map(
              ({ id }) => id,
            )
          : item.kind === "event"
            ? (await readGroupNotices({ cursor: before, db: prisma, userId })).notices.map(
                ({ id }) => id,
              )
            : (
                await readAccountNotices({
                  cursor: before,
                  db: prisma,
                  deviceId,
                  sessionCreatedAt: longAgo,
                  userId,
                })
              ).notices.map(({ id }) => id);
      if (ids.includes(item.id)) readers.push(deviceId);
    }
    return readers.sort();
  };

  const wakesForArrival = async (transition: Awaited<ReturnType<typeof arrive>>) => {
    push.placeTransitions({ deviceId: transition.deviceId, clientIds: [transition.clientId] });
    await deliver();
    expect(woken()).toEqual(await readersFor({ kind: "place", id: transition.id }));
    return woken();
  };
  const wakesForEvent = async (eventId: string) => {
    push.groupEvents([eventId]);
    await deliver();
    expect(woken()).toEqual(await readersFor({ kind: "event", id: eventId }));
    return woken();
  };
  const wakesForNotice = async (noticeId: string) => {
    push.accountNotice(noticeId);
    await deliver();
    return woken();
  };
  const setting = (
    userId: string,
    type: Parameters<typeof prisma.notificationSetting.create>[0]["data"]["type"],
    phone: boolean,
  ) => prisma.notificationSetting.create({ data: { userId, type, email: true, phone } });
  const caller = (deviceId: string, userId: string, pushSender = push) =>
    router.createCaller(
      withDeviceActive({
        cache,
        db: prisma,
        clientIp: "127.0.0.1",
        deviceId,
        unverifiedDeviceId: null,
        push: pushSender,
        session: {
          user: { id: userId },
          session: { id: `${deviceId}-session`, createdAt: longAgo },
        },
      }) as Parameters<typeof router.createCaller>[0],
    );

  return {
    alice,
    bob,
    carol,
    dave,
    groupId,
    homeId,
    woken,
    arrive,
    event,
    notice,
    readersFor,
    wakesForArrival,
    wakesForEvent,
    wakesForNotice,
    setting,
    caller,
  };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("push wake-ups", () => {
  beforeEach(() => {
    timers.length = 0;
    tasks.length = 0;
    sent.length = 0;
    replies.clear();
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { in: createdGroups } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });

  describe("recipients match the readers", () => {
    test("an arrival wakes other members' active devices, never the mover's", async () => {
      const f = await setup();
      expect(await f.wakesForArrival(await f.arrive(f.bob))).toEqual(
        [`${f.alice}-phone`, `${f.alice}-tablet`, `${f.carol}-phone`, `${f.dave}-phone`].sort(),
      );
    });

    test("mutes for the person or the whole place skip the muter", async () => {
      const f = await setup();
      await prisma.placeAlertMute.createMany({
        data: [
          { placeId: f.homeId, groupId: f.groupId, muterUserId: f.alice, mutedUserId: f.bob },
          { placeId: f.homeId, groupId: f.groupId, muterUserId: f.carol, mutedUserId: null },
          { placeId: f.homeId, groupId: f.groupId, muterUserId: f.dave, mutedUserId: f.carol },
        ],
      });
      expect(await f.wakesForArrival(await f.arrive(f.bob))).toEqual([`${f.dave}-phone`]);
    });

    test("place alerts switched off, and arrivals from before someone joined, wake nobody there", async () => {
      const f = await setup();
      await f.setting(f.alice, "PLACE_ALERTS", false);
      expect(await f.wakesForArrival(await f.arrive(f.bob, { occurredAt: ago(2 * hour) }))).toEqual(
        [`${f.dave}-phone`],
      );
    });

    test("an arrival older than a day wakes nobody", async () => {
      const f = await setup();
      expect(
        await f.wakesForArrival(await f.arrive(f.bob, { occurredAt: ago(25 * hour) })),
      ).toEqual([]);
    });

    test("a join wakes members from before it, but not the person who joined", async () => {
      const f = await setup();
      expect(
        await f.wakesForEvent(await f.event("MEMBER_JOINED", { subjectUserId: f.carol })),
      ).toEqual(
        [
          `${f.alice}-phone`,
          `${f.alice}-tablet`,
          `${f.bob}-phone`,
          `${f.bob}-tablet`,
          `${f.dave}-phone`,
        ].sort(),
      );
    });

    test("a join by an account that has since been deleted still reaches the other members", async () => {
      const f = await setup();
      const erin = `${f.alice}-erin`;
      createdUsers.push(erin);
      await prisma.user.create({ data: { id: erin, name: erin, email: `${erin}@example.test` } });
      const eventId = await f.event("MEMBER_JOINED", { subjectUserId: erin });
      await prisma.user.delete({ where: { id: erin } });
      expect(await f.wakesForEvent(eventId)).toEqual(
        [
          `${f.alice}-phone`,
          `${f.alice}-tablet`,
          `${f.bob}-phone`,
          `${f.bob}-tablet`,
          `${f.carol}-phone`,
          `${f.dave}-phone`,
        ].sort(),
      );
    });

    test("a removal skips the person who did it and anyone who turned it off", async () => {
      const f = await setup();
      await f.setting(f.dave, "MEMBER_LEFT", false);
      expect(
        await f.wakesForEvent(
          await f.event("MEMBER_REMOVED", { actorUserId: f.alice, subjectUserId: f.carol }),
        ),
      ).toEqual([`${f.bob}-phone`, `${f.bob}-tablet`, `${f.carol}-phone`].sort());
    });

    test("role changes are off unless someone turned them on", async () => {
      const f = await setup();
      await f.setting(f.bob, "ROLE_CHANGED", true);
      await f.setting(f.alice, "ROLE_CHANGED", true);
      expect(
        await f.wakesForEvent(
          await f.event("ROLE_CHANGED", { actorUserId: f.alice, subjectUserId: f.bob }),
        ),
      ).toEqual([`${f.bob}-phone`, `${f.bob}-tablet`].sort());
    });

    test("events with no phone notice wake nobody", async () => {
      const f = await setup();
      expect(
        await f.wakesForEvent(await f.event("GROUP_RENAMED", { actorUserId: f.alice })),
      ).toEqual([]);
    });

    test("an account notice wakes the account's other devices only", async () => {
      const f = await setup();
      const noticeId = await f.notice(f.alice, "RECOVERY_PHRASE_CHANGED", `${f.alice}-phone`);
      expect(await f.wakesForNotice(noticeId)).toEqual([`${f.alice}-tablet`]);
      expect(await f.readersFor({ kind: "notice", id: noticeId })).toEqual([`${f.alice}-tablet`]);
    });

    test("a new sign-in wakes the account's active devices but not the new, pending one", async () => {
      const f = await setup();
      const noticeId = await f.notice(f.bob, "NEW_SIGN_IN", `${f.bob}-new`);
      expect(await f.wakesForNotice(noticeId)).toEqual([`${f.bob}-phone`, `${f.bob}-tablet`]);
      expect(await f.readersFor({ kind: "notice", id: noticeId })).toEqual([
        `${f.bob}-phone`,
        `${f.bob}-tablet`,
      ]);
    });

    test("a device with no live session isn't woken", async () => {
      const f = await setup();
      await prisma.session.delete({ where: { id: `${f.alice}-tablet-session` } });
      await prisma.session.update({
        where: { id: `${f.bob}-tablet-session` },
        data: { expiresAt: ago(minute) },
      });
      expect(await f.wakesForNotice(await f.notice(f.alice, "DEVICE_REMOVED"))).toEqual([
        `${f.alice}-phone`,
      ]);
      sent.length = 0;
      expect(await f.wakesForNotice(await f.notice(f.bob, "NEW_SIGN_IN"))).toEqual([
        `${f.bob}-phone`,
      ]);
    });

    test("a device signed out after it was picked isn't woken", async () => {
      const f = await setup();
      push.accountNotice(await f.notice(f.alice, "DEVICE_REMOVED", `${f.alice}-phone`));
      await settle();
      await runTimers(16_000);
      await prisma.session.delete({ where: { id: `${f.alice}-tablet-session` } });
      await runTimers(1_000);
      expect(f.woken()).toEqual([]);
    });

    test("a written notice wakes and reaches the other devices even if its Phone switch is now off", async () => {
      const f = await setup();
      await f.setting(f.alice, "PASSWORD_CHANGED", false);
      const noticeId = await f.notice(f.alice, "PASSWORD_CHANGED", `${f.alice}-phone`);
      expect(await f.wakesForNotice(noticeId)).toEqual([`${f.alice}-tablet`]);
      expect(await f.readersFor({ kind: "notice", id: noticeId })).toEqual([`${f.alice}-tablet`]);
    });

    test("an alerts-turned-off notice wakes the account's other devices", async () => {
      const f = await setup();
      for (const type of ["NEW_SIGN_IN", "PASSWORD_CHANGED", "DEVICE_REMOVED"] as const) {
        await f.setting(f.alice, type, false);
      }
      const noticeId = await f.notice(f.alice, "ALERTS_TURNED_OFF", `${f.alice}-phone`);
      expect(await f.wakesForNotice(noticeId)).toEqual([`${f.alice}-tablet`]);
      expect(await f.readersFor({ kind: "notice", id: noticeId })).toEqual([`${f.alice}-tablet`]);
    });

    test("notices that sign the other devices out aren't pushed", async () => {
      const f = await setup();
      for (const type of [
        "OTHER_SESSIONS_SIGNED_OUT",
        "PASSWORD_RESET",
        "DELETION_SCHEDULED",
      ] as const) {
        expect(await f.wakesForNotice(await f.notice(f.alice, type, `${f.alice}-phone`))).toEqual(
          [],
        );
      }
    });
  });

  describe("sending", () => {
    test("waits 16 s after the trigger, then batches for a second so each device is woken once", async () => {
      const f = await setup();
      const first = await f.notice(f.alice, "RECOVERY_PHRASE_CHANGED");
      const second = await f.notice(f.alice, "DEVICE_REMOVED", `${f.alice}-phone`);
      push.accountNotice(first);
      push.accountNotice(second);
      expect(timers.map(({ ms }) => ms)).toEqual([16_000, 16_000]);
      expect(sent).toEqual([]);
      await runTimers(16_000);
      expect(timers.map(({ ms }) => ms)).toEqual([1_000]);
      expect(sent).toEqual([]);
      await runTimers(1_000);
      expect(sent.sort()).toEqual([`${f.alice}-phone-token`, `${f.alice}-tablet-token`]);
    });

    test("a device is woken at most once a minute, with one follow-up wake when the minute is up", async () => {
      const f = await setup();
      let clock = 1_000_000;
      const throttled = testPush(fakeFcm, () => clock);
      const pick = async () => {
        throttled.accountNotice(
          await f.notice(f.alice, "RECOVERY_PHRASE_CHANGED", `${f.alice}-phone`),
        );
        await settle();
        await runTimers(16_000);
        await runTimers(1_000);
      };
      const tablet = `${f.alice}-tablet-token`;

      await pick();
      expect(sent).toEqual([tablet]);
      clock += 20_000;
      await pick();
      clock += 5_000;
      await pick();
      expect(sent).toEqual([tablet]);
      expect(timers.map(({ ms }) => ms)).toEqual([40_000]);

      clock += 35_000;
      await runTimers(40_000);
      await runTimers(1_000);
      expect(sent).toEqual([tablet, tablet]);
      expect(timers).toEqual([]);

      clock += 60_000;
      await pick();
      expect(sent).toEqual([tablet, tablet, tablet]);
      expect(timers).toEqual([]);
    });

    test("a device only goes into the minute's limit when it is woken", async () => {
      const f = await setup();
      let clock = 1_000_000;
      const throttled = testPush(fakeFcm, () => clock);
      const pick = async (noticeId: string) => {
        throttled.accountNotice(noticeId);
        await settle();
        await runTimers(16_000);
        await runTimers(1_000);
      };

      await pick(await f.notice(f.alice, "RECOVERY_PHRASE_CHANGED", `${f.alice}-phone`));
      clock += 1_000;
      await pick(await f.notice(f.alice, "RECOVERY_PHRASE_CHANGED", `${f.alice}-tablet`));
      expect(sent).toEqual([`${f.alice}-tablet-token`, `${f.alice}-phone-token`]);
      expect(timers).toEqual([]);
    });

    test("a security alert's notice is pushed 16 s after it is written", async () => {
      const f = await setup();
      const alertTasks: Promise<unknown>[] = [];
      const alerts = createSecurityAlerts({
        db: prisma,
        sendSecurityAlertEmail: null,
        runInBackground: (task) => alertTasks.push(task),
        push,
      });
      alerts.send(f.alice, { type: "recovery-phrase-changed" }, `${f.alice}-phone`);
      expect(timers).toEqual([]);
      await Promise.all(alertTasks);
      expect(timers.map(({ ms }) => ms)).toEqual([16_000]);
      await deliver();
      expect(f.woken()).toEqual([`${f.alice}-tablet`]);
    });

    test("an uploaded arrival is pushed after the upload commits", async () => {
      const f = await setup();
      await f.caller(`${f.bob}-phone`, f.bob).groupTracking.uploadBatch({
        groupId: f.groupId,
        points: [],
        placeTransitions: [
          {
            clientId: crypto.randomUUID(),
            placeId: f.homeId,
            direction: "ARRIVE",
            occurredAt: new Date(),
            senderDeviceId: `${f.bob}-phone`,
          },
        ],
      });
      expect(timers.map(({ ms }) => ms)).toEqual([16_000]);
      await deliver();
      expect(f.woken()).toEqual(
        [`${f.alice}-phone`, `${f.alice}-tablet`, `${f.carol}-phone`, `${f.dave}-phone`].sort(),
      );
    });

    test("UNREGISTERED deletes the token, unless the phone already sent a new one", async () => {
      const f = await setup();
      replies.set(`${f.alice}-tablet-token`, [{ outcome: "unregistered" }]);
      replies.set(`${f.bob}-phone-token`, [
        async () => {
          await prisma.pushToken.update({
            where: { deviceId: `${f.bob}-phone` },
            data: { token: `${f.bob}-phone-fresh` },
          });
          return { outcome: "unregistered" };
        },
      ]);
      await f.wakesForEvent(await f.event("MEMBER_JOINED", { subjectUserId: f.carol }));
      const tokens = await prisma.pushToken.findMany({
        where: { deviceId: { in: [`${f.alice}-tablet`, `${f.alice}-phone`, `${f.bob}-phone`] } },
        select: { deviceId: true, token: true },
        orderBy: { deviceId: "asc" },
      });
      expect(tokens).toEqual([
        { deviceId: `${f.alice}-phone`, token: `${f.alice}-phone-token` },
        { deviceId: `${f.bob}-phone`, token: `${f.bob}-phone-fresh` },
      ]);
    });

    test("retries once after the delay FCM asks for, then gives up", async () => {
      const f = await setup();
      const errors = spyOn(console, "error").mockImplementation(() => {});
      replies.set(`${f.alice}-tablet-token`, [{ outcome: "retry", afterMs: 7_000 }]);
      replies.set(`${f.carol}-phone-token`, [
        { outcome: "retry", afterMs: 5_000 },
        { outcome: "retry", afterMs: 5_000 },
      ]);
      replies.set(`${f.dave}-phone-token`, [{ outcome: "failed", status: 403 }]);
      await f.wakesForEvent(await f.event("MEMBER_JOINED", { subjectUserId: f.bob }));
      expect(timers.map(({ ms }) => ms).sort()).toEqual([5_000, 7_000]);
      await runTimers(7_000);
      await runTimers(5_000);
      expect(timers).toEqual([]);
      const count = (token: string) => sent.filter((sentToken) => sentToken === token).length;
      expect(count(`${f.alice}-tablet-token`)).toBe(2);
      expect(count(`${f.carol}-phone-token`)).toBe(2);
      expect(count(`${f.dave}-phone-token`)).toBe(1);
      expect(errors.mock.calls.map(([message]) => String(message).replace(/^\S+ /, ""))).toEqual([
        "[push] FCM refused a wake (403)",
        "[push] FCM was unavailable twice, so a wake was dropped",
      ]);
      expect(await prisma.pushToken.count({ where: { deviceId: `${f.dave}-phone` } })).toBe(1);
      errors.mockRestore();
    });

    test("every message to the FCM endpoint is a content-free wake-up", async () => {
      const f = await setup();
      const key = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );
      const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", key.privateKey)).toString(
        "base64",
      );
      const bodies: unknown[] = [];
      const endpointPush = testPush(
        createFcmClient({
          projectId: "openbeacon-test",
          clientEmail: "push@example.test",
          privateKey: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
          fetch: async (url, init) => {
            if (url.startsWith("https://oauth2.googleapis.com/")) {
              return Response.json({ access_token: "access", expires_in: 3600 });
            }
            bodies.push(JSON.parse(String(init.body)));
            return Response.json({ name: "projects/openbeacon-test/messages/1" });
          },
        }),
      );
      endpointPush.groupEvents([await f.event("MEMBER_JOINED", { subjectUserId: f.carol })]);
      await deliver();
      expect(bodies).toHaveLength(5);
      expect(bodies).toContainEqual({
        message: {
          token: `${f.bob}-tablet-token`,
          data: { t: "sync" },
          android: { priority: "high", collapse_key: "sync", ttl: "300s" },
        },
      });
      for (const body of bodies) {
        expect(body).toStrictEqual({
          message: {
            token: expect.stringMatching(/-token$/),
            data: { t: "sync" },
            android: { priority: "high", collapse_key: "sync", ttl: "300s" },
          },
        });
      }
    });
  });

  describe("account sync", () => {
    test("stores, replaces, moves and clears the device's token, and says push is available", async () => {
      const f = await setup();
      const phone = `${f.alice}-phone`;
      const sync = (deviceId: string, pushToken: string | null) =>
        f.caller(deviceId, f.alice).accountNotices.sync({ cursor: null, pushToken });
      const tokenOf = async (deviceId: string) =>
        (await prisma.pushToken.findUnique({ where: { deviceId } }))?.token ?? null;

      expect((await sync(phone, "first")).pushAvailable).toBe(true);
      expect(await tokenOf(phone)).toBe("first");
      await sync(phone, "second");
      expect(await tokenOf(phone)).toBe("second");
      await sync(`${f.alice}-tablet`, "second");
      expect(await tokenOf(`${f.alice}-tablet`)).toBe("second");
      expect(await tokenOf(phone)).toBeNull();
      await sync(`${f.alice}-tablet`, null);
      expect(await tokenOf(`${f.alice}-tablet`)).toBeNull();
    });

    test("a sync without the field leaves the token alone", async () => {
      const f = await setup();
      const response = await f
        .caller(`${f.alice}-phone`, f.alice)
        .accountNotices.sync({ cursor: null });
      expect(response.pushAvailable).toBe(true);
      expect(
        await prisma.pushToken.findUnique({ where: { deviceId: `${f.alice}-phone` } }),
      ).toMatchObject({ token: `${f.alice}-phone-token` });
    });

    test("uploads no longer touch the token or say whether push is available", async () => {
      const f = await setup();
      const response = await f.caller(`${f.alice}-phone`, f.alice).groupTracking.uploadBatch({
        groupId: f.groupId,
        points: [],
        noticesCursor: null,
        ...{ pushToken: null },
      });
      expect(response).not.toHaveProperty("pushAvailable");
      expect(
        await prisma.pushToken.findUnique({ where: { deviceId: `${f.alice}-phone` } }),
      ).toMatchObject({ token: `${f.alice}-phone-token` });
    });

    test("with no FCM settings push is off: nothing is stored, scheduled or sent", async () => {
      const f = await setup();
      const off = testPush(null);
      const caller = f.caller(`${f.alice}-phone`, f.alice, off);
      const response = await caller.accountNotices.sync({ cursor: null, pushToken: "new-token" });
      expect(off.enabled).toBe(false);
      expect(response.pushAvailable).toBe(false);
      expect(
        await prisma.pushToken.findUnique({ where: { deviceId: `${f.alice}-phone` } }),
      ).toMatchObject({ token: `${f.alice}-phone-token` });
      await caller.accountNotices.sync({ cursor: null, pushToken: null });
      expect(
        await prisma.pushToken.findUnique({ where: { deviceId: `${f.alice}-phone` } }),
      ).toBeNull();

      off.groupEvents([await f.event("MEMBER_JOINED", { subjectUserId: f.carol })]);
      off.accountNotice(await f.notice(f.alice, "RECOVERY_PHRASE_CHANGED"));
      expect(timers).toEqual([]);
      expect(sent).toEqual([]);
    });
  });
});
