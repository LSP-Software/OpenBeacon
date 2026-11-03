import { describe, expect, mock, test } from "bun:test";

const values = new Map<string, string>();
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => values.get(key),
    set: (key: string, value: string) => values.set(key, value),
  },
}));
const { getTrackingUploadTime, recordTrackingUpload, subscribeToTrackingUploads } =
  await import("./trackingUploadTime.ts");

describe("tracking upload time", () => {
  test("persists the latest send per device and group and notifies on change", () => {
    values.clear();
    let notifications = 0;
    const unsubscribe = subscribeToTrackingUploads(() => {
      notifications += 1;
    });
    recordTrackingUpload("device-a", "group-a", "2026-07-19T12:00:00.000Z");
    recordTrackingUpload("device-a", "group-b", "2026-07-19T12:01:00.000Z");
    recordTrackingUpload("device-a", "group-b", "2026-07-19T11:59:00.000Z");
    expect(getTrackingUploadTime("device-a", ["group-a", "group-b"])).toBe(
      "2026-07-19T12:01:00.000Z",
    );
    expect(getTrackingUploadTime("device-a", ["group-a"])).toBe("2026-07-19T12:00:00.000Z");
    expect(getTrackingUploadTime("device-b", ["group-a", "group-b"])).toBeNull();
    expect(notifications).toBe(2);
    unsubscribe();
  });
});
