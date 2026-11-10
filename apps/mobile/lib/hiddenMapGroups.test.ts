import { beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

const importModule = async () =>
  import(`./hiddenMapGroups.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./hiddenMapGroups.ts")
  >;

describe("hiddenMapGroups", () => {
  beforeEach(() => {
    storageValues.clear();
  });

  test("keeps each account's hidden groups separate", async () => {
    const { getHiddenMapGroupIds, setMapGroupHidden } = await importModule();

    setMapGroupHidden({ groupId: "club", hidden: true, userId: "alice" });

    expect(getHiddenMapGroupIds("alice")).toEqual(["club"]);
    expect(getHiddenMapGroupIds("bob")).toEqual([]);
  });

  test("hides each group once and shows it again", async () => {
    const { getHiddenMapGroupIds, setMapGroupHidden } = await importModule();

    setMapGroupHidden({ groupId: "club", hidden: true, userId: "alice" });
    setMapGroupHidden({ groupId: "club", hidden: true, userId: "alice" });
    setMapGroupHidden({ groupId: "work", hidden: true, userId: "alice" });
    setMapGroupHidden({ groupId: "club", hidden: false, userId: "alice" });

    expect(getHiddenMapGroupIds("alice")).toEqual(["work"]);
  });

  test("forgets a hidden group so rejoining it later shows it again", async () => {
    const { forgetHiddenMapGroup, getHiddenMapGroupIds, setMapGroupHidden } = await importModule();

    setMapGroupHidden({ groupId: "club", hidden: true, userId: "alice" });
    setMapGroupHidden({ groupId: "work", hidden: true, userId: "alice" });
    setMapGroupHidden({ groupId: "club", hidden: true, userId: "bob" });
    forgetHiddenMapGroup({ groupId: "club", userId: "alice" });

    expect(getHiddenMapGroupIds("alice")).toEqual(["work"]);
    expect(getHiddenMapGroupIds("bob")).toEqual(["club"]);
  });

  test("treats unreadable stored values as nothing hidden", async () => {
    const { getHiddenMapGroupIds } = await importModule();

    storageValues.set("map.hiddenGroups.alice", "not json");
    expect(getHiddenMapGroupIds("alice")).toEqual([]);

    storageValues.set("map.hiddenGroups.alice", JSON.stringify({ club: true }));
    expect(getHiddenMapGroupIds("alice")).toEqual([]);

    storageValues.set("map.hiddenGroups.alice", JSON.stringify(["club", 4]));
    expect(getHiddenMapGroupIds("alice")).toEqual(["club"]);
  });

  test("notifies subscribers when a group is hidden or shown", async () => {
    const { getHiddenMapGroupsRevision, setMapGroupHidden, subscribeToHiddenMapGroups } =
      await importModule();
    const listener = mock(() => {});
    const unsubscribe = subscribeToHiddenMapGroups(listener);

    setMapGroupHidden({ groupId: "club", hidden: true, userId: "alice" });
    unsubscribe();
    setMapGroupHidden({ groupId: "club", hidden: false, userId: "alice" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getHiddenMapGroupsRevision()).toBe(2);
  });
});
