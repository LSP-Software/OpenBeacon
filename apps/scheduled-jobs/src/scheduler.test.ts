import { describe, expect, it, spyOn } from "bun:test";
import { startScheduler } from "./scheduler.ts";

describe("scheduled jobs", () => {
  it("rejects duplicate names and invalid delays", () => {
    const job = { name: "test", delay: 1, run: async () => {} };
    expect(() => startScheduler([job, job])).toThrow();
    expect(() => startScheduler([{ ...job, delay: 0 }])).toThrow();
  });

  it("does not overlap runs and waits for a running job on shutdown", async () => {
    let finish: (() => void) | undefined;
    let calls = 0;
    const stop = startScheduler([
      {
        name: "test",
        delay: 1,
        run: () => {
          calls++;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      },
    ]);
    await Bun.sleep(10);
    expect(calls).toBe(1);
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(1);
    expect(stopped).toBe(false);
    finish?.();
    await stopping;
    await Bun.sleep(5);
    expect(calls).toBe(1);
  });

  it("continues after a failed run and logs only the job name and error code", async () => {
    let calls = 0;
    const error = spyOn(console, "error").mockImplementation(() => {});
    const stop = startScheduler([
      {
        name: "test",
        delay: 1,
        run: async () => {
          calls++;
          if (calls === 1) throw Object.assign(new Error("secret user-1"), { code: "P2002" });
          if (calls === 2) throw Object.assign(new Error("secret user-2"), { name: "NoSuchKey" });
          if (calls === 3) throw new Error("secret user-3");
        },
      },
    ]);
    await Bun.sleep(20);
    await stop();
    expect(calls).toBeGreaterThan(3);
    expect(error.mock.calls).toEqual([
      ["Scheduled job test failed (P2002)"],
      ["Scheduled job test failed (NoSuchKey)"],
      ["Scheduled job test failed"],
    ]);
    error.mockRestore();
  });
});
