import { afterEach, expect, spyOn, test } from "bun:test";
import { checkOptionalServices } from "./checkOptionalServices.ts";

const logs = {
  log: spyOn(console, "log").mockImplementation(() => {}),
  warn: spyOn(console, "warn").mockImplementation(() => {}),
  error: spyOn(console, "error").mockImplementation(() => {}),
};
afterEach(() => {
  for (const spy of Object.values(logs)) spy.mockClear();
});

const unreachableCode = "SERVICE_DOWN";
const isUnreachable = (error: Error) => "code" in error && error.code === unreachableCode;

test("startup goes on when a service can't be reached or doesn't answer in time", async () => {
  await checkOptionalServices(
    {
      Email: {
        check: async () => {
          throw Object.assign(new Error("down"), { code: unreachableCode });
        },
        isUnreachable,
      },
      "Push (FCM)": { check: () => new Promise(() => {}), isUnreachable },
      Other: { check: async () => {}, isUnreachable },
    },
    50,
  );
  expect(logs.warn.mock.calls).toEqual([
    [
      "  Email: unreachable (SERVICE_DOWN), starting anyway; it is tried again each time it is needed",
    ],
    [
      "  Push (FCM): unreachable (SERVICE_CHECK_TIMED_OUT), starting anyway; it is tried again each time it is needed",
    ],
  ]);
  expect(logs.log.mock.calls).toEqual([["  Other: valid"]]);
});

test("startup still fails when a service rejects its configuration", async () => {
  await expect(
    checkOptionalServices({
      Email: {
        check: async () => {
          throw Object.assign(new Error("bad key"), { code: "EAUTH" });
        },
        isUnreachable,
      },
    }),
  ).rejects.toThrow("Service configuration validation failed");
  expect(logs.error.mock.calls).toEqual([["  Email: failed (EAUTH)"]]);
});
