import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("instructions that name a setup option quote a title the setup screen shows", () => {
  const setupTitles = [...read("../app/setup/index.tsx").matchAll(/title: "([^"]+)"/g)].map(
    ([, title]) => title,
  );
  const quotedChoices = ["../app/account/add-device.tsx", "../lib/deviceLink.ts"].flatMap((path) =>
    [...read(path).matchAll(/choose “([^”]+)”/g)].map(([, choice]) => choice),
  );

  expect(quotedChoices.length).toBeGreaterThan(1);
  for (const choice of quotedChoices) expect(setupTitles).toContain(choice);
});

test("user-facing text uses curly apostrophes", () => {
  const files = [
    "../app/forgotPassword.tsx",
    "../app/index.tsx",
    "../app/serverUrl.tsx",
    "../app/signIn.tsx",
    "../app/signUp.tsx",
    "../app/account/contact-us.tsx",
    "../components/ApiCompatibilityGate.tsx",
    "../components/EmailCodeEntry.tsx",
    "../lib/deviceActivation.ts",
    "../lib/emailCodes.ts",
    "../lib/groupColorSync.ts",
    "../lib/groupLimitAlert.ts",
    "../lib/locationSharing.ts",
    "../lib/personalData.ts",
    "../lib/recovery.ts",
    "../lib/sessionLink.ts",
  ];
  const straight = files.flatMap((path) =>
    read(path)
      .split("\n")
      .filter((line) => !/^\s*(import|\/\/)/.test(line))
      .filter((line) => /[A-Za-z]'(t|s|re|ve|ll|d|m)\b/.test(line))
      .map((line) => `${path}: ${line.trim()}`),
  );

  expect(straight).toEqual([]);
});
