import { expect, spyOn, test } from "bun:test";
import { logRateLimit } from "./logRateLimit.ts";

test("bounds rate-limit warnings and reports suppressed requests", () => {
  const clock = spyOn(Date, "now").mockReturnValue(1_000);
  const warning = spyOn(console, "warn").mockImplementation(() => {});

  logRateLimit({ path: "auth", scope: "auth" });
  logRateLimit({ path: "group.list", scope: "userId" });
  logRateLimit({ path: "auth", scope: "auth" });
  expect(warning).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenLastCalledWith("[rate-limit] request limited", {
    path: "auth",
    scope: "auth",
    suppressed: 0,
  });

  clock.mockReturnValue(61_000);
  logRateLimit({ path: "group.list", scope: "ip" });
  expect(warning).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenLastCalledWith("[rate-limit] request limited", {
    path: "group.list",
    scope: "ip",
    suppressed: 2,
  });
  clock.mockRestore();
  warning.mockRestore();
});
