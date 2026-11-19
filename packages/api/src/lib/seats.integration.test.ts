import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { freeSeats, groupSeats, seatsUsed } from "./seats.ts";

const prefix = `seats-${crypto.randomUUID()}`;
const id = (name: string) => `${prefix}-${name}`;
const [owner, twoPhones, inBoth, pendingOnly, otherOwner, unused] = [
  "owner",
  "two-phones",
  "in-both",
  "pending-only",
  "other-owner",
  "unused",
].map(id) as [string, string, string, string, string, string];
const [family, friends, notOwned] = ["family", "friends", "not-owned"].map(id) as [
  string,
  string,
  string,
];

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("seats with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [owner, twoPhones, inBoth, pendingOnly, otherOwner, unused].map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
      })),
    });
    const device = (userId: string, name: string, state: "active" | "pending" | "revoked") => ({
      id: id(`${userId}-${name}`),
      userId,
      publicKey: "key",
      publicKeyAlgorithm: "x25519",
      name,
      icon: "phone" as const,
      activatedAt: state === "pending" ? null : new Date(),
      revokedAt: state === "revoked" ? new Date() : null,
    });
    await prisma.userDevice.createMany({
      data: [
        device(owner, "phone", "active"),
        device(owner, "tablet", "active"),
        device(twoPhones, "phone", "active"),
        device(twoPhones, "work phone", "active"),
        device(twoPhones, "old phone", "revoked"),
        device(inBoth, "phone", "active"),
        device(pendingOnly, "phone", "pending"),
        device(otherOwner, "phone", "active"),
      ],
    });
    await prisma.group.createMany({
      data: [
        { id: family, name: family, ownerId: owner },
        { id: friends, name: friends, ownerId: owner },
        { id: notOwned, name: notOwned, ownerId: otherOwner },
      ],
    });
    await prisma.groupMember.createMany({
      data: [
        { groupId: family, userId: owner, role: "ADMIN" as const },
        { groupId: family, userId: twoPhones, role: "ADMIN" as const },
        { groupId: family, userId: inBoth, role: "MEMBER" as const },
        { groupId: family, userId: pendingOnly, role: "MEMBER" as const },
        { groupId: friends, userId: owner, role: "ADMIN" as const },
        { groupId: friends, userId: inBoth, role: "MEMBER" as const },
        { groupId: notOwned, userId: otherOwner, role: "ADMIN" as const },
        { groupId: notOwned, userId: owner, role: "EDITOR" as const },
        { groupId: notOwned, userId: twoPhones, role: "MEMBER" as const },
      ].map((member) => ({ ...member, joinedEpochNumber: 1 })),
    });
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  test("a new account has 2 seats", async () => {
    expect(await freeSeats(prisma, unused)).toEqual({ seats: 2, used: 0, free: 2 });
  });

  test("an account using no seats has none used", async () => {
    expect(await seatsUsed(prisma, unused)).toBe(0);
    expect(await seatsUsed(prisma, pendingOnly)).toBe(0);
  });

  test("counts the owner's own devices, two phones as two seats, and a member in two owned groups twice", async () => {
    const familySeats = 2 + 2 + 1;
    const friendsSeats = 2 + 1;
    expect(await seatsUsed(prisma, owner)).toBe(familySeats + friendsSeats);
  });

  test("the owner of another group pays for the seats there, not its members or other Admins", async () => {
    expect(await seatsUsed(prisma, otherOwner)).toBe(1 + 2 + 2);
    expect(await seatsUsed(prisma, twoPhones)).toBe(0);
  });

  test("a group's seats are its members' active phones, and move to whoever owns it", async () => {
    expect(await groupSeats(prisma, family)).toBe(2 + 2 + 1);
    expect(await groupSeats(prisma, friends)).toBe(2 + 1);
    expect(await groupSeats(prisma, notOwned)).toBe(1 + 2 + 2);
    const ownerBefore = await seatsUsed(prisma, owner);
    await prisma.group.update({ where: { id: notOwned }, data: { ownerId: owner } });
    try {
      expect(await groupSeats(prisma, notOwned)).toBe(1 + 2 + 2);
      expect(await seatsUsed(prisma, owner)).toBe(ownerBefore + 1 + 2 + 2);
      expect(await seatsUsed(prisma, otherOwner)).toBe(0);
    } finally {
      await prisma.group.update({ where: { id: notOwned }, data: { ownerId: otherOwner } });
    }
  });

  test("a pending device takes a seat once it activates, and a removed one gives it back", async () => {
    const before = await seatsUsed(prisma, owner);
    await prisma.userDevice.update({
      where: { id: id(`${pendingOnly}-phone`) },
      data: { activatedAt: new Date() },
    });
    expect(await seatsUsed(prisma, owner)).toBe(before + 1);
    await prisma.userDevice.update({
      where: { id: id(`${twoPhones}-work phone`) },
      data: { revokedAt: new Date() },
    });
    expect(await seatsUsed(prisma, owner)).toBe(before);
  });
});
