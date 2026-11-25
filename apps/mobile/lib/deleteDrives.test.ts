import { describe, expect, test } from "bun:test";
import { deleteDrivesEverywhere } from "./deleteDrives.ts";

describe("deleteDrivesEverywhere", () => {
  test("deletes on the server in batches of 500 before forgetting each batch here", async () => {
    const calls: string[] = [];
    const driveIds = Array.from({ length: 1_001 }, (_, index) =>
      index.toString(16).padStart(32, "0"),
    );
    const deleted = await deleteDrivesEverywhere({
      driveIds,
      deleteOnServer: async (ids) => {
        calls.push(`server ${ids.length}`);
      },
      deleteHere: async (ids) => {
        calls.push(`here ${ids.length}`);
      },
    });
    expect(deleted).toBe(true);
    expect(calls).toEqual([
      "server 500",
      "here 500",
      "server 500",
      "here 500",
      "server 1",
      "here 1",
    ]);
  });

  test("keeps drives listed here when the server didn't delete them, so they can be deleted later", async () => {
    const forgotten: string[] = [];
    const deleted = await deleteDrivesEverywhere({
      driveIds: ["a".repeat(32)],
      deleteOnServer: async () => {
        throw new Error("offline");
      },
      deleteHere: async (ids) => {
        forgotten.push(...ids);
      },
    });
    expect(deleted).toBe(false);
    expect(forgotten).toEqual([]);
  });
});
