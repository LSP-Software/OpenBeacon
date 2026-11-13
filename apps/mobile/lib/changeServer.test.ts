import { beforeEach, expect, mock, test } from "bun:test";

const events: string[] = [];
let savedUrl = "https://old.example.com";

mock.module("./currentServer.ts", () => ({
  getServerUrl: () => savedUrl,
  setServerUrl: (url: string) => {
    events.push(`save:${url}`);
    savedUrl = url;
  },
}));
mock.module("./endSession.ts", () => ({
  endSession: async ({ reason }: { reason: string }) => {
    events.push(`endSession:${reason}`);
    return { signedOut: true };
  },
}));

const { changeServer } = await import("./changeServer.ts");

beforeEach(() => {
  events.length = 0;
  savedUrl = "https://old.example.com";
});

test("ends the session on the old server before saving the new one", async () => {
  await changeServer("https://new.example.com");
  expect(events).toEqual(["endSession:serverChanged", "save:https://new.example.com"]);
});

test("going back to the hosted server also ends the session first", async () => {
  await changeServer("");
  expect(events).toEqual(["endSession:serverChanged", "save:"]);
});

test("saving the same server again keeps the session", async () => {
  await changeServer("https://old.example.com");
  expect(events).toEqual(["save:https://old.example.com"]);
});
