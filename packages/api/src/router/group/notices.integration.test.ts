import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSecurityAlerts } from "@openbeacon/auth/securityAlerts.ts";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { type GroupEventType, prisma } from "@openbeacon/database";
import type { SecurityAlert } from "@openbeacon/email";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { encodeAlertsCursor } from "../../lib/placeTransitions.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountNoticesRouter } from "../accountNoticesRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const router = createTRPCRouter({
  accountNotices: accountNoticesRouter,
  groupTracking: groupTrackingRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `notices-${crypto.randomUUID()}`;
const minute = 60_000;
const hour = 60 * minute;
let fixtureCount = 0;
const createdUsers: string[] = [];
const createdGroups: string[] = [];

const tasks: Promise<unknown>[] = [];
const emails: { userId: string; alert: SecurityAlert }[] = [];
const createAlerts = (withEmail: boolean) =>
  createSecurityAlerts({
    db: prisma,
    sendSecurityAlertEmail: withEmail
      ? async ({ userId, alert }) => {
          emails.push({ userId, alert });
        }
      : null,
    runInBackground: (task) => tasks.push(task),
  });
const settleAlerts = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
};

const ago = (ms: number) => new Date(Date.now() - ms);
const longAgo = ago(30 * 24 * hour);

const setup = async () => {
  fixtureCount += 1;
  const id = (name: string) => `${prefix}-${fixtureCount}-${name}`;
  const alice = id("alice");
  const bob = id("bob");
  const carol = id("carol");
  const groupId = id("family");
  const otherGroupId = id("other");
  const users = [alice, bob, carol];
  createdUsers.push(...users);
  createdGroups.push(groupId, otherGroupId);
  await prisma.user.createMany({
    data: users.map((userId) => ({ id: userId, name: userId, email: `${userId}@example.test` })),
  });
  await prisma.userDevice.createMany({
    data: [`${alice}-phone`, `${alice}-tablet`, `${bob}-phone`, `${carol}-phone`].map(
      (deviceId) => ({
        id: deviceId,
        userId: deviceId.slice(0, deviceId.lastIndexOf("-")),
        name: deviceId,
        activatedAt: new Date(),
        icon: "phone" as const,
        publicKey: "public-key",
        publicKeyAlgorithm: "X25519",
      }),
    ),
  });
  await prisma.group.create({
    data: {
      id: groupId,
      name: "Family",
      ownerId: alice,
      groupMembers: {
        create: [
          { userId: alice, role: "ADMIN", joinedEpochNumber: 1, createdAt: ago(2 * hour) },
          { userId: bob, role: "MEMBER", joinedEpochNumber: 1, createdAt: longAgo },
        ],
      },
    },
  });
  await prisma.group.create({
    data: {
      id: otherGroupId,
      name: "Other",
      ownerId: carol,
      groupMembers: {
        create: [{ userId: carol, role: "ADMIN", joinedEpochNumber: 1, createdAt: longAgo }],
      },
    },
  });
  const caller = (deviceId: string, sessionCreatedAt = longAgo) =>
    router.createCaller(
      withDeviceActive({
        cache,
        db: prisma,
        clientIp: "127.0.0.1",
        deviceId,
        unverifiedDeviceId: null,
        session: {
          user: { id: deviceId.slice(0, deviceId.lastIndexOf("-")) },
          session: { id: `${deviceId}-session`, createdAt: sessionCreatedAt },
        },
      }) as Parameters<typeof router.createCaller>[0],
    );
  const poll = async (deviceId: string, noticesCursor: string | null) => {
    const response = await caller(deviceId).groupTracking.uploadBatch({
      groupId,
      points: [],
      noticesCursor,
    });
    if (!response.notices) throw new Error("No notices in the response.");
    return response.notices;
  };
  const sync = (deviceId: string, cursor: string | null, sessionCreatedAt = longAgo) =>
    caller(deviceId, sessionCreatedAt).accountNotices.sync({ cursor });
  const event = (
    name: string,
    type: GroupEventType,
    data: { createdAt: Date; actorUserId?: string; subjectUserId?: string; group?: string },
  ) =>
    prisma.groupEvent.create({
      data: {
        id: id(name),
        groupId: data.group ?? groupId,
        type,
        createdAt: data.createdAt,
        actorUserId: data.actorUserId ?? null,
        subjectUserId: data.subjectUserId ?? null,
      },
    });
  return { id, alice, bob, carol, groupId, otherGroupId, caller, poll, sync, event };
};

const since = (ms: number) => encodeAlertsCursor({ createdAt: ago(ms), id: "" });
const names = (notices: { notices: { id: string }[] }, fixture: { id: (name: string) => string }) =>
  notices.notices.map(({ id }) => id.slice(fixture.id("").length));

const backdateNotices = (userId: string, by: number) =>
  prisma.accountNotice.updateMany({ where: { userId }, data: { createdAt: ago(by) } });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("phone notices", () => {
  beforeEach(() => {
    emails.length = 0;
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { in: createdGroups } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });

  test("a first call returns nothing but a cursor just before the settle window", async () => {
    const fixture = await setup();
    await fixture.event("joined", "MEMBER_JOINED", {
      createdAt: ago(minute),
      subjectUserId: fixture.bob,
    });
    createAlerts(false).send(fixture.alice, { type: "password-changed" });
    await settleAlerts();
    await backdateNotices(fixture.alice, minute);
    for (const first of [
      await fixture.poll(`${fixture.alice}-phone`, null),
      await fixture.sync(`${fixture.alice}-phone`, null),
    ]) {
      expect(first.notices).toEqual([]);
      const cursorAt = Date.parse(first.cursor.slice(0, first.cursor.indexOf("|")));
      expect(Date.now() - cursorAt).toBeGreaterThanOrEqual(14_000);
      expect(Date.now() - cursorAt).toBeLessThan(20_000);
    }
  });

  test("a security notice is written without email and reaches every device but the one that made the change", async () => {
    const fixture = await setup();
    createAlerts(false).send(
      fixture.alice,
      { type: "new-sign-in", device: { model: "Pixel 8", platform: "android" } },
      `${fixture.alice}-tablet`,
    );
    await settleAlerts();
    await backdateNotices(fixture.alice, minute);

    expect((await fixture.sync(`${fixture.alice}-tablet`, since(hour))).notices).toEqual([]);
    const phone = await fixture.sync(`${fixture.alice}-phone`, since(hour));
    expect(phone.notices).toEqual([
      expect.objectContaining({
        kind: "account",
        type: "NEW_SIGN_IN",
        device: { name: null, model: "Pixel 8", platform: "android" },
        deletionDate: null,
        turnedOff: [],
      }),
    ]);
    expect((await fixture.sync(`${fixture.bob}-phone`, since(hour))).notices).toEqual([]);
  });

  test("account notices come only through the account sync and group notices only through the upload", async () => {
    const fixture = await setup();
    createAlerts(false).send(fixture.alice, { type: "password-changed" });
    await settleAlerts();
    await backdateNotices(fixture.alice, minute);
    await fixture.event("joined", "MEMBER_JOINED", {
      createdAt: ago(minute),
      subjectUserId: fixture.carol,
    });

    expect(
      (await fixture.poll(`${fixture.alice}-phone`, since(hour))).notices.map(({ kind }) => kind),
    ).toEqual(["group"]);
    expect(
      (await fixture.sync(`${fixture.alice}-phone`, since(hour))).notices.map(({ type }) => type),
    ).toEqual(["PASSWORD_CHANGED"]);
  });

  test("the account sync works for a phone in no group", async () => {
    const fixture = await setup();
    await prisma.groupMember.deleteMany({ where: { userId: fixture.alice } });
    createAlerts(false).send(fixture.alice, { type: "recovery-phrase-changed" });
    await settleAlerts();
    await backdateNotices(fixture.alice, minute);

    const response = await fixture.sync(`${fixture.alice}-phone`, since(hour));
    expect(response.notices.map(({ type }) => type)).toEqual(["RECOVERY_PHRASE_CHANGED"]);
    expect(response.pushAvailable).toBe(false);
  });

  test("a phone only gets account notices from after its session started", async () => {
    const fixture = await setup();
    await prisma.accountNotice.createMany({
      data: [
        {
          id: fixture.id("before"),
          userId: fixture.alice,
          type: "NEW_SIGN_IN",
          createdAt: ago(20 * minute),
        },
        {
          id: fixture.id("after"),
          userId: fixture.alice,
          type: "DEVICE_REMOVED",
          createdAt: ago(5 * minute),
        },
      ],
    });

    expect(
      names(await fixture.sync(`${fixture.alice}-phone`, since(hour), ago(10 * minute)), fixture),
    ).toEqual(["after"]);
    expect(names(await fixture.sync(`${fixture.alice}-tablet`, since(hour)), fixture)).toEqual([
      "before",
      "after",
    ]);
  });

  test("a security notice is timed by the database clock, not the server's", async () => {
    const fixture = await setup();
    const databaseNow = ago(5 * minute);
    createSecurityAlerts({
      db: {
        user: prisma.user,
        accountNotice: prisma.accountNotice,
        $queryRaw: (async () => [{ now: databaseNow }]) as unknown as typeof prisma.$queryRaw,
      },
      sendSecurityAlertEmail: null,
      runInBackground: (task) => tasks.push(task),
    }).send(fixture.alice, { type: "password-changed" });
    await settleAlerts();
    expect(
      await prisma.accountNotice.findMany({
        where: { userId: fixture.alice },
        select: { createdAt: true },
      }),
    ).toEqual([{ createdAt: databaseNow }]);
  });

  test("every security alert with a phone notice writes it with its details", async () => {
    const fixture = await setup();
    const alerts = createAlerts(true);
    const device = { name: "Old tablet", model: "Tab S9", platform: "android" as const };
    const deletionDate = new Date("2026-11-24T12:00:00.000Z");
    for (const alert of [
      { type: "password-changed" },
      { type: "password-reset" },
      { type: "recovery-phrase-changed" },
      { type: "recovery-phrase-reset" },
      { type: "other-sessions-signed-out", device },
      { type: "device-removed", device },
      { type: "deletion-scheduled", deletionDate },
      { type: "account-deleted" },
      {
        type: "alerts-turned-off",
        alerts: [
          { type: "NEW_SIGN_IN", channel: "email" },
          { type: "NEW_SIGN_IN", channel: "phone" },
          { type: "DEVICE_REMOVED", channel: "phone" },
        ],
      },
    ] satisfies SecurityAlert[]) {
      alerts.send(fixture.alice, alert);
      await settleAlerts();
    }
    const notices = await prisma.accountNotice.findMany({
      where: { userId: fixture.alice },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(
      notices.map(({ type, deviceName, deletionDate, turnedOffEmail, turnedOffPhone }) => ({
        type,
        deviceName,
        deletionDate,
        turnedOffEmail,
        turnedOffPhone,
      })),
    ).toEqual([
      ...(
        [
          "PASSWORD_CHANGED",
          "PASSWORD_RESET",
          "RECOVERY_PHRASE_CHANGED",
          "RECOVERY_PHRASE_RESET",
        ] as const
      ).map((type) => ({
        type,
        deviceName: null,
        deletionDate: null,
        turnedOffEmail: [],
        turnedOffPhone: [],
      })),
      {
        type: "OTHER_SESSIONS_SIGNED_OUT",
        deviceName: "Old tablet",
        deletionDate: null,
        turnedOffEmail: [],
        turnedOffPhone: [],
      },
      {
        type: "DEVICE_REMOVED",
        deviceName: "Old tablet",
        deletionDate: null,
        turnedOffEmail: [],
        turnedOffPhone: [],
      },
      {
        type: "DELETION_SCHEDULED",
        deviceName: null,
        deletionDate,
        turnedOffEmail: [],
        turnedOffPhone: [],
      },
      {
        type: "ALERTS_TURNED_OFF",
        deviceName: null,
        deletionDate: null,
        turnedOffEmail: ["NEW_SIGN_IN"],
        turnedOffPhone: ["NEW_SIGN_IN", "DEVICE_REMOVED"],
      },
    ]);
    expect(emails).toHaveLength(9);

    await backdateNotices(fixture.alice, minute);
    const turnedOff = (await fixture.sync(`${fixture.alice}-phone`, since(hour))).notices.at(-1);
    expect(turnedOff).toMatchObject({
      type: "ALERTS_TURNED_OFF",
      device: null,
      turnedOff: [
        { type: "NEW_SIGN_IN", channel: "phone" },
        { type: "DEVICE_REMOVED", channel: "phone" },
        { type: "NEW_SIGN_IN", channel: "email" },
      ],
    });
  });

  test("the phone switch decides the notice and the email switch decides the email", async () => {
    const fixture = await setup();
    await prisma.notificationSetting.createMany({
      data: [
        { userId: fixture.alice, type: "DEVICE_REMOVED", email: true, phone: false },
        { userId: fixture.alice, type: "PASSWORD_CHANGED", email: false, phone: true },
      ],
    });
    const alerts = createAlerts(true);
    alerts.send(fixture.alice, {
      type: "device-removed",
      device: { name: "Tablet", model: null, platform: null },
    });
    alerts.send(fixture.alice, { type: "password-changed" });
    await settleAlerts();

    expect(
      (await prisma.accountNotice.findMany({ where: { userId: fixture.alice } })).map(
        ({ type }) => type,
      ),
    ).toEqual(["PASSWORD_CHANGED"]);
    expect(emails.map(({ alert }) => alert.type)).toEqual(["device-removed"]);
  });

  test("the alerts-turned-off notice is written even with every phone switch off", async () => {
    const fixture = await setup();
    await prisma.notificationSetting.createMany({
      data: (
        [
          "NEW_SIGN_IN",
          "PASSWORD_CHANGED",
          "RECOVERY_PHRASE_CHANGED",
          "OTHER_SESSIONS_SIGNED_OUT",
          "DEVICE_REMOVED",
          "DELETION_SCHEDULED",
        ] as const
      ).map((type) => ({ userId: fixture.alice, type, email: false, phone: false })),
    });
    createAlerts(false).send(fixture.alice, {
      type: "alerts-turned-off",
      alerts: [{ type: "NEW_SIGN_IN", channel: "phone" }],
    });
    await settleAlerts();
    await backdateNotices(fixture.alice, minute);

    expect(
      (await fixture.sync(`${fixture.alice}-phone`, since(hour))).notices.map(({ type }) => type),
    ).toEqual(["ALERTS_TURNED_OFF"]);
  });

  test("switching a type off after the notice was written stops a group notice but not an account notice", async () => {
    const fixture = await setup();
    createAlerts(false).send(fixture.alice, { type: "recovery-phrase-reset" });
    await settleAlerts();
    await backdateNotices(fixture.alice, minute);
    await fixture.event("joined", "MEMBER_JOINED", {
      createdAt: ago(minute),
      subjectUserId: fixture.bob,
    });
    await prisma.notificationSetting.createMany({
      data: [
        { userId: fixture.alice, type: "RECOVERY_PHRASE_CHANGED", email: true, phone: false },
        { userId: fixture.alice, type: "MEMBER_JOINED", email: false, phone: false },
      ],
    });

    const response = await fixture.poll(`${fixture.alice}-phone`, since(hour));
    expect(response.notices).toEqual([]);
    const cursorAt = Date.parse(response.cursor.slice(0, response.cursor.indexOf("|")));
    expect(cursorAt).toBeGreaterThan(Date.now() - 20_000);
    expect(
      (await fixture.sync(`${fixture.alice}-phone`, since(hour))).notices.map(({ type }) => type),
    ).toEqual(["RECOVERY_PHRASE_RESET"]);
  });

  test("group notices come from the caller's groups after they joined, never their own actions, and follow the switches", async () => {
    const fixture = await setup();
    const { alice, bob, carol, event, otherGroupId, poll } = fixture;
    await event("before-join", "MEMBER_JOINED", { createdAt: ago(3 * hour), subjectUserId: bob });
    await event("own-join", "MEMBER_JOINED", { createdAt: ago(2 * hour), subjectUserId: alice });
    await event("joined", "MEMBER_JOINED", { createdAt: ago(50 * minute), subjectUserId: carol });
    await event("left", "MEMBER_LEFT", { createdAt: ago(45 * minute), subjectUserId: carol });
    await event("removed", "MEMBER_REMOVED", {
      createdAt: ago(40 * minute),
      actorUserId: bob,
      subjectUserId: carol,
    });
    await event("removed-by-me", "MEMBER_REMOVED", {
      createdAt: ago(35 * minute),
      actorUserId: alice,
      subjectUserId: bob,
    });
    await event("deleted", "ACCOUNT_DELETED", { createdAt: ago(30 * minute) });
    await event("made-me-admin", "ROLE_CHANGED", {
      createdAt: ago(25 * minute),
      actorUserId: bob,
      subjectUserId: alice,
    });
    await event("renamed", "GROUP_RENAMED", { createdAt: ago(20 * minute), actorUserId: bob });
    await event("place", "PLACE_ADDED", { createdAt: ago(20 * minute), actorUserId: bob });
    await event("other-group", "MEMBER_JOINED", {
      createdAt: ago(15 * minute),
      subjectUserId: bob,
      group: otherGroupId,
    });

    expect(names(await poll(`${alice}-phone`, since(4 * hour)), fixture)).toEqual([
      "joined",
      "left",
      "removed",
      "deleted",
    ]);

    await prisma.notificationSetting.createMany({
      data: [
        { userId: alice, type: "ROLE_CHANGED", email: false, phone: true },
        { userId: alice, type: "MEMBER_LEFT", email: false, phone: false },
      ],
    });
    const switched = await poll(`${alice}-phone`, since(4 * hour));
    expect(names(switched, fixture)).toEqual(["joined", "made-me-admin"]);
    expect(switched.notices[1]).toMatchObject({
      kind: "group",
      groupId: fixture.groupId,
      type: "ROLE_CHANGED",
      actor: { userId: bob, name: bob },
      subject: { userId: alice, name: alice },
    });
  });

  test("notices older than 24 hours are never returned", async () => {
    const fixture = await setup();
    await prisma.groupMember.updateMany({
      where: { userId: fixture.alice },
      data: { createdAt: longAgo },
    });
    await fixture.event("old", "MEMBER_JOINED", {
      createdAt: ago(25 * hour),
      subjectUserId: fixture.carol,
    });
    await fixture.event("recent", "MEMBER_JOINED", {
      createdAt: ago(23 * hour),
      subjectUserId: fixture.carol,
    });
    expect(
      names(await fixture.poll(`${fixture.alice}-phone`, since(3 * 24 * hour)), fixture),
    ).toEqual(["recent"]);
  });

  test("a notice inside the settle window waits for the next call instead of being skipped", async () => {
    const fixture = await setup();
    await fixture.event("settling", "MEMBER_JOINED", {
      createdAt: ago(13_000),
      subjectUserId: fixture.carol,
    });
    const first = await fixture.poll(`${fixture.alice}-phone`, since(hour));
    expect(first.notices).toEqual([]);
    await Bun.sleep(2_500);
    const second = await fixture.poll(`${fixture.alice}-phone`, first.cursor);
    expect(names(second, fixture)).toEqual(["settling"]);
    expect((await fixture.poll(`${fixture.alice}-phone`, second.cursor)).notices).toEqual([]);
  });

  test("pages of 50 of each kind have no repeats and no gaps", async () => {
    const fixture = await setup();
    const sameTime = ago(30 * minute);
    await prisma.accountNotice.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        id: fixture.id(`account-${String(index).padStart(2, "0")}`),
        userId: fixture.alice,
        type: "NEW_SIGN_IN" as const,
        createdAt: index < 20 ? sameTime : ago(40 * minute - index * 1_000),
      })),
    });
    await prisma.groupEvent.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        id: fixture.id(`group-${String(index).padStart(2, "0")}`),
        groupId: fixture.groupId,
        type: "MEMBER_JOINED" as const,
        subjectUserId: fixture.carol,
        createdAt: index < 20 ? sameTime : ago(40 * minute - index * 1_000 - 500),
      })),
    });
    for (const read of [
      (cursor: string) => fixture.poll(`${fixture.alice}-phone`, cursor),
      (cursor: string) => fixture.sync(`${fixture.alice}-phone`, cursor),
    ]) {
      const seen: string[] = [];
      const pageSizes: number[] = [];
      let cursor = since(hour);
      for (let page = 0; page < 5; page++) {
        const response = await read(cursor);
        pageSizes.push(response.notices.length);
        seen.push(...names(response, fixture));
        const times = response.notices.map(({ at }) => at.getTime());
        expect(times).toEqual([...times].sort((a, b) => a - b));
        cursor = response.cursor;
        if (response.notices.length < 50) break;
      }
      expect(pageSizes).toEqual([50, 10]);
      expect(new Set(seen).size).toBe(60);
    }
  });
});
