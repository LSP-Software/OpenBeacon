import { describe, expect, test } from "bun:test";
import { viewerName } from "./viewerNames.ts";

const groups = [
  { id: "family", members: [{ id: "family-alex", userId: "alex" }] },
  { id: "work", members: [{ id: "work-alex", userId: "alex" }] },
];

const name = (
  groupIds: string[],
  nicknames: Record<string, Record<string, { name: string | null }> | undefined>,
) => viewerName({ accountName: "Alex Smith", groupIds, groups, nicknames, userId: "alex" });

describe("viewerName", () => {
  test("uses the nickname from the preferred group", () => {
    expect(
      name(["work", "family"], {
        family: { "family-alex": { name: "Dad" } },
        work: { "work-alex": { name: "Boss" } },
      }),
    ).toEqual({ name: "Boss", accountName: "Alex Smith" });
  });

  test("falls back to another shared group, skipping groups you are no longer in", () => {
    expect(
      name(["former", "work", "family"], {
        work: { "work-alex": { name: null } },
        family: { "family-alex": { name: "Dad" } },
      }),
    ).toEqual({ name: "Dad", accountName: "Alex Smith" });
  });

  test("uses the account name when there is no nickname or it failed to load", () => {
    expect(name(["family", "work"], { family: undefined })).toEqual({
      name: "Alex Smith",
      accountName: null,
    });
  });

  test("does not repeat the account name when the nickname matches it", () => {
    expect(name(["family"], { family: { "family-alex": { name: "Alex Smith" } } })).toEqual({
      name: "Alex Smith",
      accountName: null,
    });
  });
});
