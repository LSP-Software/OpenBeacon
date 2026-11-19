import { expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

mock.module("@react-navigation/native", () => ({
  validatePathConfig: () => {},
}));
mock.module("../lib/pendingJoinCode.ts", () => ({
  saveJoinLinkForAfterSetup: () => false,
}));

const { getRoutes } = await import("expo-router/build/getRoutesCore.js");
const { getReactNavigationConfig } = await import("expo-router/build/getReactNavigationConfig.js");
const { getStateFromPath } = await import("expo-router/build/fork/getStateFromPath.js");
const { redirectSystemPath } = await import("../app/+native-intent.tsx");

const appDirectory = path.join(import.meta.dir, "../app");
const routeFiles = readdirSync(appDirectory, {
  recursive: true,
  encoding: "utf8",
})
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => `./${file}`);

const appConfig: {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
} = JSON.parse(readFileSync(path.join(import.meta.dir, "../app.json"), "utf8"));
const routerOptions =
  appConfig.expo.plugins
    .filter((plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin))
    .find(([name]) => name === "expo-router")?.[1] ?? {};

const context = Object.assign(() => ({ default: () => null }), {
  keys: () => routeFiles,
  resolve: (id: string) => id,
  id: "app",
});

const routes = getRoutes(context, {
  ...routerOptions,
  getSystemRoute: ({ route, type }) => ({
    type,
    loadRoute: () => ({ default: () => null }),
    route,
    contextKey: `expo-router/build/views/${route}.js`,
    generated: true,
    internal: true,
    dynamic: route === "+not-found" ? [{ name: "+not-found", deep: true, notFound: true }] : null,
    children: [],
  }),
  ignoreEntryPoints: true,
  platform: "android",
});
const config = getReactNavigationConfig(routes, true);

const screenFor = (target: string) => {
  let current: { routes?: { name: string; state?: unknown }[] } | undefined = getStateFromPath(
    target,
    { screens: config.screens },
  );
  const names: string[] = [];
  while (current?.routes) {
    const route = current.routes[current.routes.length - 1];
    if (!route) break;
    names.push(route.name);
    current = route.state as typeof current;
  }
  return names.join(" > ");
};

const sourceFiles = ["app", "components", "lib", "hooks", "providers"].flatMap((directory) =>
  readdirSync(path.join(import.meta.dir, "..", directory), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => path.join(import.meta.dir, "..", directory, file)),
);

test("every internal link the app builds opens a real screen", () => {
  const targets = new Set(
    sourceFiles.flatMap((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(
          /(?:href=|href:|pathname:|router\.(?:push|replace|navigate)\(|Redirect href=)\s*\{?\s*"(\/[^"]*)"/g,
        ),
      ].map((match) => match[1] ?? ""),
    ),
  );
  expect(targets.size).toBeGreaterThan(20);
  const missing = [...targets].filter((target) => screenFor(target).endsWith("+not-found"));
  expect(missing).toEqual([]);
});

test("unknown links land on the app's own not-found route", () => {
  expect(routeFiles).toContain("./+not-found.tsx");
  expect(screenFor("/no-such-screen")).toBe("+not-found");
});

test("the developer sitemap is not reachable", () => {
  expect(screenFor("/_sitemap")).toBe("+not-found");
});

test("group tab components are not screens of their own", () => {
  for (const tab of ["MembersTab", "PlacesTab", "HistoryTab", "SettingsTab"]) {
    expect(screenFor(`/groups/abc/${tab}`)).toBe("+not-found");
  }
});

test("the Google deletion callback never reaches the router", async () => {
  const link = "openbeacon://google-deletion?state=s&code=c";
  expect(await redirectSystemPath({ path: link, initial: false })).toBeNull();
  expect(await redirectSystemPath({ path: link, initial: true })).toBe("/");
});
