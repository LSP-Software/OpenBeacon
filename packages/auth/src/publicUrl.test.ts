import { expect, test } from "bun:test";
import { getPublicUrl } from "./publicUrl.ts";

test.each([
  ["https://api.openbeacon.net", { baseUrl: "https://api.openbeacon.net", path: "" }],
  ["https://api.openbeacon.net/", { baseUrl: "https://api.openbeacon.net", path: "" }],
  [
    "https://example.com/openbeacon",
    { baseUrl: "https://example.com/openbeacon", path: "/openbeacon" },
  ],
  [
    "https://example.com/apps/openbeacon//",
    { baseUrl: "https://example.com/apps/openbeacon", path: "/apps/openbeacon" },
  ],
])("reads the public base and path from %p", (betterAuthUrl, expected) => {
  expect(getPublicUrl(betterAuthUrl)).toEqual(expected);
});
