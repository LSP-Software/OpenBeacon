import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the Android manifest removes storage and media permissions that libraries declare", () => {
  const result = Bun.spawnSync(["bunx", "expo", "config", "--type", "introspect", "--json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
  });
  expect(result.exitCode).toBe(0);
  const config: {
    _internal: {
      modResults: {
        android: {
          manifest: {
            manifest: {
              "uses-permission": { $: { "android:name": string; "tools:node"?: string } }[];
            };
          };
        };
      };
    };
  } = JSON.parse(result.stdout.toString());
  const permissions = config._internal.modResults.android.manifest.manifest["uses-permission"];
  const removed = permissions
    .filter(({ $ }) => $["tools:node"] === "remove")
    .map(({ $ }) => $["android:name"]);
  const requested = permissions
    .filter(({ $ }) => $["tools:node"] !== "remove")
    .map(({ $ }) => $["android:name"]);

  for (const permission of [
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  ]) {
    expect(removed).toContain(permission);
    expect(requested).not.toContain(permission);
  }
}, 30_000);
