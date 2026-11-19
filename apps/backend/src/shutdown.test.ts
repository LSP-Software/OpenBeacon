import { expect, test } from "bun:test";
import { createBackgroundWork } from "@openbeacon/auth/backgroundWork.ts";
import { shutDownGracefully } from "./shutdown.ts";

test("shutting down lets a request in progress finish, refuses new ones and sends queued work", async () => {
  const backgroundWork = createBackgroundWork();
  const sent: string[] = [];
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async () => {
      markStarted();
      backgroundWork.setTimer(() => {
        backgroundWork.run(Bun.sleep(20).then(() => sent.push("wake")));
      }, 16_000);
      backgroundWork.run(Bun.sleep(20).then(() => sent.push("code email")));
      await Bun.sleep(300);
      return new Response("uploaded");
    },
  });
  const url = `http://127.0.0.1:${server.port}/`;
  const inFlight = fetch(url).then(async (response) => ({
    status: response.status,
    body: await response.text(),
  }));
  await started;

  const stopping = shutDownGracefully({ server, backgroundWork, deadlineMs: 5_000 });
  const late = await fetch(url).then(
    () => "answered",
    () => "refused",
  );

  expect(await inFlight).toEqual({ status: 200, body: "uploaded" });
  expect(late).toBe("refused");
  expect(await stopping).toEqual({ requestsFinished: true, unfinishedBackgroundWork: 0 });
  expect(sent.sort()).toEqual(["code email", "wake"]);
});
