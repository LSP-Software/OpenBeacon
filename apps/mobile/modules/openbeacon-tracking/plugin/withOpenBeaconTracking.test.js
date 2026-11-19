const { describe, expect, test } = require("bun:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "../../..");

const androidApplication = () => {
  const result = Bun.spawnSync(["bunx", "expo", "config", "--type", "introspect", "--json"], {
    cwd: appRoot,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
  });
  expect(result.exitCode).toBe(0);
  const config = JSON.parse(result.stdout.toString());
  return config._internal.modResults.android.manifest.manifest.application[0].$;
};

describe("withOpenBeaconTracking", () => {
  test("the app keeps every file out of cloud backup and device-to-device transfer", () => {
    const application = androidApplication();
    expect(application["android:allowBackup"]).toBe("false");
    expect(application["android:dataExtractionRules"]).toBe(
      "@xml/openbeacon_data_extraction_rules",
    );
    expect(application["android:fullBackupContent"]).toBeUndefined();

    const rules = readFileSync(
      path.resolve(__dirname, "../android/src/main/res/xml/openbeacon_data_extraction_rules.xml"),
      "utf8",
    );
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] ?? "";
      expect(body).not.toContain("<include");
      for (const domain of ["root", "device_root", "external"]) {
        expect(body).toContain(`<exclude domain="${domain}" path="." />`);
      }
    }
  }, 30_000);
});
