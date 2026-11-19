import { expect, test } from "bun:test";
import { createBackgroundWork } from "./backgroundWork.ts";

test("finishing runs waiting timers now and waits for the work they start", async () => {
  const work = createBackgroundWork();
  const done: string[] = [];
  work.run(Bun.sleep(20).then(() => done.push("email")));
  work.setTimer(() => {
    work.run(Bun.sleep(10).then(() => done.push("wake")));
  }, 16_000);

  expect(await work.finish(1_000)).toEqual({ unfinished: 0 });
  expect(done.sort()).toEqual(["email", "wake"]);
});

test("finishing gives up at the deadline and reports what is left", async () => {
  const work = createBackgroundWork();
  work.run(new Promise(() => {}));
  const started = performance.now();
  expect(await work.finish(50)).toEqual({ unfinished: 1 });
  expect(performance.now() - started).toBeLessThan(500);
});

test("a timer that keeps scheduling itself can't hold up finishing", async () => {
  const work = createBackgroundWork({ maxRounds: 3 });
  let fired = 0;
  const reschedule = () => {
    fired += 1;
    work.setTimer(reschedule, 60_000);
  };
  work.setTimer(reschedule, 60_000);
  expect(await work.finish(1_000)).toEqual({ unfinished: 1 });
  expect(fired).toBe(3);
});

test("a failed task is tracked without an unhandled rejection", async () => {
  const work = createBackgroundWork();
  work.run(Promise.reject(new Error("send failed")));
  expect(await work.finish(100)).toEqual({ unfinished: 0 });
});
