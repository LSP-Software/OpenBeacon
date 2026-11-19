import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { createDeviceKeyPair } from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { appRouter } from "../../root.ts";

const cache = createIntegrationTestCache(() => Date.now());
const prefix = `adv-il-${crypto.randomUUID()}`;
const owner = `${prefix}-owner`;
const member = `${prefix}-member`;
const victim = `${prefix}-victim`;
const invitee = `${prefix}-invitee`;
const outsider = `${prefix}-outsider`;
const users = [owner, member, victim, invitee, outsider];
const groupId = `${prefix}-group`;
const placeId = `${prefix}-place`;
const victimDeviceCreatedAt = new Date("2026-03-04T05:06:07.000Z");
const secrets = {
  email: `${victim}@example.test`,
  pushToken: `${prefix}-victim-push-token`,
  sessionToken: `${prefix}-victim-session-token`,
  ipAddress: "203.0.113.77",
  userAgent: "VictimAgent/9.9",
  model: "Victim Pixel 9 Pro",
};
const forbiddenKeys = [
  "email",
  "token",
  "pushToken",
  "ipAddress",
  "userAgent",
  "model",
  "lastSeenAt",
  "lastLocationAt",
  "sessionId",
];

const deviceOf = (userId: string) => `${userId}-device`;
const sessionOf = (userId: string) => `${userId}-session`;

const caller = (userId: string) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: deviceOf(userId),
      unverifiedDeviceId: null,
      session: {
        user: { id: userId },
        session: { id: sessionOf(userId), createdAt: new Date(), userId },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const keysIn = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysIn)
    : value !== null && typeof value === "object" && !(value instanceof Date)
      ? Object.entries(value).flatMap(([key, child]) => [key, ...keysIn(child)])
      : [];

const expectNoSecrets = (label: string, response: unknown) => {
  const text = JSON.stringify(response);
  for (const secret of Object.values(secrets)) {
    expect({ label, leaked: text.includes(secret) ? secret : null }).toEqual({
      label,
      leaked: null,
    });
  }
  expect({ label, keys: keysIn(response).filter((key) => forbiddenKeys.includes(key)) }).toEqual({
    label,
    keys: [],
  });
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial: information leakage in responses",
  () => {
    let sharedCode = "";
    let emailInviteId = "";

    beforeAll(async () => {
      for (const userId of users) {
        const key = createDeviceKeyPair();
        await prisma.user.create({
          data: { id: userId, name: `Name ${userId}`, email: `${userId}@example.test` },
        });
        await prisma.userDevice.create({
          data: {
            id: deviceOf(userId),
            userId,
            publicKey: key.publicKey,
            publicKeyAlgorithm: key.algorithm,
            name: `Phone of ${userId}`,
            icon: "phone",
            platform: "android",
            model: userId === victim ? secrets.model : "Generic Phone",
            activatedAt: new Date(),
            ...(userId === victim ? { createdAt: victimDeviceCreatedAt } : {}),
          },
        });
        await prisma.session.create({
          data: {
            id: sessionOf(userId),
            token: userId === victim ? secrets.sessionToken : `${userId}-token`,
            userId,
            deviceId: deviceOf(userId),
            expiresAt: new Date(Date.now() + 600_000),
            ...(userId === victim
              ? { ipAddress: secrets.ipAddress, userAgent: secrets.userAgent }
              : {}),
          },
        });
      }
      await prisma.pushToken.create({
        data: { deviceId: deviceOf(victim), token: secrets.pushToken },
      });
      await prisma.group.create({ data: { id: groupId, name: "Family" } });
      for (const [userId, role] of [
        [owner, "OWNER"],
        [member, "MEMBER"],
        [victim, "MEMBER"],
      ] as const) {
        await prisma.groupMember.create({
          data: { userId, groupId, role, joinedEpochNumber: 1 },
        });
        await prisma.groupEvent.create({
          data: { groupId, type: "MEMBER_JOINED", subjectUserId: userId, role },
        });
      }
      await prisma.place.create({
        data: {
          id: placeId,
          groupId,
          name: "Home",
          emoji: "🏠",
          epochId: `${prefix}-epoch`,
          senderDeviceId: deviceOf(owner),
          algorithm: "test",
          nonce: "test",
          ciphertext: "test",
          createdByUserId: owner,
        },
      });
      await prisma.placeTransition.create({
        data: {
          placeId,
          groupId,
          deviceId: deviceOf(victim),
          userId: victim,
          direction: "ARRIVE",
          occurredAt: new Date(),
          clientId: `${prefix}-transition`,
        },
      });
      const invite = await prisma.groupMemberInvite.create({
        data: { inviterId: owner, recipientId: invitee, groupId, role: "MEMBER" },
      });
      emailInviteId = invite.id;
      sharedCode = (await caller(owner).groupInvites.createShared({ groupId })).code;
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("another member's email, push token, session, IP, user agent, phone model and last-seen times reach no member, invitee or code holder", async () => {
      const asMember = caller(member);
      const responses: Array<[string, unknown]> = [
        ["groupMembership.list", await asMember.groupMembership.list()],
        ["groupMembership.get", await asMember.groupMembership.get({ groupId })],
        ["groupMembership.members", await asMember.groupMembership.members({ groupId })],
        [
          "groupMembership.listMemberDevices",
          await asMember.groupMembership.listMemberDevices({ groupId }),
        ],
        ["groupMembership.nicknames", await asMember.groupMembership.nicknames({ groupId })],
        ["groupHistory.list", await asMember.groupHistory.list({ groupId })],
        ["groupHistory.latest", await asMember.groupHistory.latest()],
        ["placeTransitions.recent", await asMember.placeTransitions.recent({ groupId })],
        ["placeSharing.get", await asMember.placeSharing.get({ groupId })],
        ["account.viewers", await asMember.account.viewers()],
        [
          "groupEpoch.listRecipientPublicKeys",
          await asMember.groupEpoch.listRecipientPublicKeys({ groupId }),
        ],
        ["groupInvites.list", await caller(invitee).groupInvites.list()],
        [
          "groupInvites.preview",
          await caller(invitee).groupInvites.preview({ inviteId: emailInviteId }),
        ],
        [
          "groupInvites.sharedPreview",
          await caller(outsider).groupInvites.sharedPreview({ code: sharedCode }),
        ],
        [
          "groupInvites.sharedAcceptanceContext",
          await caller(outsider).groupInvites.sharedAcceptanceContext({ code: sharedCode }),
        ],
      ];
      for (const [label, response] of responses) expectNoSecrets(label, response);
    });

    test("an invite preview shows the group name, member count and inviter only, never the other members", async () => {
      const shared = await caller(outsider).groupInvites.sharedPreview({ code: sharedCode });
      const email = await caller(invitee).groupInvites.preview({ inviteId: emailInviteId });
      for (const preview of [shared, email]) {
        expect(preview).toEqual({
          group: { id: groupId, name: "Family", image: null, memberCount: 3 },
          inviter: { name: `Name ${owner}`, image: null },
          alreadyMember: false,
          joinBlockedBy: null,
        });
      }
    });

    test.skip("ADV-IL-2 (open bug): someone holding a shared invite code, before joining, learns when each member's phones were registered — the acceptance context should give non-members no device creation times", async () => {
      const context = await caller(outsider).groupInvites.sharedAcceptanceContext({
        code: sharedCode,
      });
      const othersCreatedAt = context.recipients
        .filter((recipient) => recipient.userId !== outsider)
        .map((recipient) => ("createdAt" in recipient ? recipient.createdAt : undefined));

      expect(othersCreatedAt.every((createdAt) => createdAt === undefined)).toBe(true);
    });

    test("probe ADV-IL-2: the acceptance context gives a code holder every member's account ID, phone count and phone registration time before they join", async () => {
      const context = await caller(outsider).groupInvites.sharedAcceptanceContext({
        code: sharedCode,
      });
      const victimDevice = context.recipients.find((recipient) => recipient.userId === victim);

      expect(new Set(context.recipients.map((recipient) => recipient.userId))).toEqual(
        new Set([owner, member, victim, outsider]),
      );
      expect(victimDevice?.createdAt).toEqual(victimDeviceCreatedAt);
      expect(await prisma.groupMember.count({ where: { groupId, userId: outsider } })).toBe(0);
    });

    test("probe ADV-IL-3: members' device list gives each device's platform, which the privacy draft doesn't list", async () => {
      const devices = await caller(member).groupMembership.listMemberDevices({ groupId });
      expect(Object.keys(devices[0] ?? {}).sort()).toEqual([
        "deviceId",
        "icon",
        "name",
        "platform",
        "userId",
      ]);
    });
  },
);
