import { describe, expect, test } from "bun:test";
import { resolveSelfDeviceLocationFallback } from "./resolveSelfDeviceLocationFallback.ts";

describe("resolveSelfDeviceLocationFallback", () => {
  test("returns null when the user has no group memberships", () => {
    expect(
      resolveSelfDeviceLocationFallback({
        getGroupColor: () => "#111111",
        groups: [
          {
            id: "family",
            name: "Family",
            members: [{ image: null, name: "Bob", userId: "bob" }],
          },
        ],
        selfUserId: "alice",
      }),
    ).toBeNull();
  });

  test("uses the first membership for ring color and lists other shared groups", () => {
    expect(
      resolveSelfDeviceLocationFallback({
        getGroupColor: (groupId) => (groupId === "family" ? "#2A9D8F" : "#E85D4C"),
        groups: [
          {
            id: "cousins",
            name: "Cousins",
            members: [
              { image: null, name: "Alice", userId: "alice" },
              { image: null, name: "Bob", userId: "bob" },
            ],
          },
          {
            id: "family",
            name: "Family",
            members: [
              { image: "https://example.com/a.png", name: "Alice Smith", userId: "alice" },
              { image: null, name: "Carol", userId: "carol" },
            ],
          },
          {
            id: "neighbors",
            name: "Neighbors",
            members: [{ image: null, name: "Dan", userId: "dan" }],
          },
        ],
        selfUserId: "alice",
      }),
    ).toEqual({
      image: null,
      name: "Alice",
      otherSharedGroupNames: ["Family"],
      ringColor: "#E85D4C",
      sourceGroupId: "cousins",
    });
  });
});
