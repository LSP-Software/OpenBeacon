import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

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

const sourceFiles = (directory: string): string[] =>
  readdirSync(new URL(directory, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const appSource = ["../app", "../components", "../lib", "../hooks", "../providers"]
  .flatMap(sourceFiles)
  .map((path) => ({ path, text: read(path) }));

test("text that names this device uses the phone or tablet noun", () => {
  const fixedNouns = appSource.flatMap(({ path, text }) =>
    text
      .split("\n")
      .filter((line) => !/^\s*(import|\/\/)/.test(line))
      .filter((line) => /\b(this|your) (phone|device)\b/i.test(line))
      .map((line) => `${path}: ${line.trim()}`),
  );

  expect(fixedNouns).toEqual([]);
});

test("alert titles for failures start with Couldn’t", () => {
  const titles = appSource.flatMap(({ path, text }) =>
    [...text.matchAll(/(?:Alert\.alert\(\s*|failureTitle:\s*)(["`])([^"`]*)\1/g)].map(
      ([, , title]) => `${path}: ${title}`,
    ),
  );
  const failures = titles.filter((title) =>
    /: (Unable to|Something went wrong)|failed$/i.test(title),
  );

  expect(titles.filter((title) => title.includes(": Couldn’t ")).length).toBeGreaterThan(30);
  expect(failures).toEqual([]);
});

test("an edit whose new value shows on screen confirms without an alert", () => {
  const inlineEditors = [
    "../app/(tabs)/account/overview.tsx",
    "../app/account/devices.tsx",
    "../components/groups/MembersTab.tsx",
    "../components/groups/SettingsTab.tsx",
    "../components/map/GroupMapColorPicker.tsx",
  ];
  const successAlerts = inlineEditors.flatMap((path) =>
    [...read(path).matchAll(/Alert\.alert\(\s*"([^"]*)"/g)]
      .map(([, title]) => title ?? "")
      .filter((title) => /(updated|saved|changed|renamed)$/i.test(title))
      .map((title) => `${path}: ${title}`),
  );

  expect(successAlerts).toEqual([]);
});

test("Account menu labels match the titles of the screens they open", () => {
  const menuItems = [
    ...read("../app/(tabs)/account/overview.tsx").matchAll(
      /label: "([^"]+)",\s*icon: \w+,\s*href: "\/account\/([a-z-]+)"/g,
    ),
  ];

  expect(menuItems.length).toBeGreaterThan(10);
  for (const [, label, screen] of menuItems) {
    const title = read(`../app/account/${screen}.tsx`).match(/<ScreenHeader title="([^"]+)"/)?.[1];
    expect(`${screen}: ${title}`).toBe(`${screen}: ${label}`);
  }
});

test("the button that opens Sign out other sessions is named like the screen", () => {
  const title = read("../app/account/sign-out-others.tsx").match(
    /<ScreenHeader title="([^"]+)"/,
  )?.[1];

  expect(title).toBeDefined();
  expect(read("../app/account/password.tsx")).toContain(`<Text>${title}</Text>`);
});

test("Android notification text that names this device says tablet on a tablet", () => {
  const strings = (path: string) =>
    new Map(
      [...read(path).matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)].map(
        ([, name, text]) => [name ?? "", text ?? ""] as const,
      ),
    );
  const res = "../modules/openbeacon-tracking/android/src/main/res";
  const phone = [...strings(`${res}/values/strings.xml`)].filter(([, text]) =>
    /\bthis phone\b/i.test(text),
  );

  expect(phone.length).toBeGreaterThan(0);
  expect([...strings(`${res}/values-sw600dp/strings.xml`)]).toEqual(
    phone.map(([name, text]) => [name, text.replace(/\b(this|This) phone\b/g, "$1 tablet")]),
  );
});
