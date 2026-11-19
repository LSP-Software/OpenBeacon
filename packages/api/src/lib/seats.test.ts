import { expect, test } from "bun:test";
import { noFreeSeatsToInviteMessage, seatsEnforced } from "./seats.ts";

test("only hosted servers enforce seats", () => {
  expect(seatsEnforced({ selfHosted: true })).toBe(false);
  expect(seatsEnforced({ selfHosted: false })).toBe(true);
});

test("only the owner hears their counts when there's no room to invite", () => {
  const owner = { userId: "owner", name: "Sam" };
  const message = (seats: number, used: number, userId = "owner") =>
    noFreeSeatsToInviteMessage({ owner, seats, used, userId });
  expect(message(2, 2, "admin")).toBe(
    "Sam owns this group and has no room for more people. Ask Sam to add room or to remove someone.",
  );
  expect(message(0, 0)).toBe("You have no room for people. Add room to invite people.");
  expect(message(1, 1)).toBe(
    "You have room for 1 person and that's you. Add room to invite people.",
  );
  expect(message(2, 2)).toBe(
    "You have room for 2 people and they're all in your groups. Add room or remove someone to invite more people.",
  );
  expect(message(2, 3)).toBe(
    "You have room for 2 people but 3 are in your groups. Add room or remove someone to invite more people.",
  );
});
