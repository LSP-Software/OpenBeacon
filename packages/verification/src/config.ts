import { homedir } from "node:os";
import { join } from "node:path";

const envString = (key: string): string | undefined => {
  const value = process.env[key];
  return value !== undefined && value.length > 0 ? value : undefined;
};

const envNumber = (key: string, fallback: number): number => {
  const value = envString(key);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export type VerificationConfig = {
  androidHome: string;
  adbPath: string;
  emulatorPath: string;
  avdName: string;
  packageName: string;
  appScheme: string;
  metroHost: string;
  metroPort: number;
  backendPort: number;
  account: { email: string; password: string; name: string };
  location: { latitude: number; longitude: number };
  repoRoot: string;
  artifactsRoot: string;
  maestroBin: string;
  androidCliBin: string;
};

export const resolveConfig = (repoRoot: string): VerificationConfig => {
  const androidHome =
    envString("ANDROID_HOME") ??
    envString("ANDROID_SDK_ROOT") ??
    join(homedir(), "Library/Android/sdk");
  const metroHost = envString("OPENBEACON_VERIFY_METRO_HOST") ?? "10.0.2.2";
  const metroPort = envNumber("OPENBEACON_VERIFY_METRO_PORT", 8081);
  const appScheme = envString("OPENBEACON_VERIFY_APP_SCHEME") ?? "openbeacon";

  return {
    androidHome,
    adbPath: join(androidHome, "platform-tools/adb"),
    emulatorPath: join(androidHome, "emulator/emulator"),
    avdName: envString("OPENBEACON_VERIFY_AVD") ?? "Pixel_10_Pro_XL",
    packageName: envString("OPENBEACON_VERIFY_PACKAGE") ?? "net.openbeacon.app",
    appScheme,
    metroHost,
    metroPort,
    backendPort: envNumber("OPENBEACON_VERIFY_API_PORT", 3000),
    account: {
      email: envString("OPENBEACON_VERIFY_EMAIL") ?? "ope98-verify@example.test",
      password: envString("OPENBEACON_VERIFY_PASSWORD") ?? "ope98-verify-pass",
      name: envString("OPENBEACON_VERIFY_NAME") ?? "OPE98 Verify",
    },
    location: {
      latitude: envNumber("OPENBEACON_VERIFY_LAT", 51.5072),
      longitude: envNumber("OPENBEACON_VERIFY_LON", -0.1276),
    },
    repoRoot,
    artifactsRoot:
      envString("OPENBEACON_VERIFY_ARTIFACTS") ?? join(repoRoot, ".verification-artifacts"),
    maestroBin:
      envString("OPENBEACON_VERIFY_MAESTRO_BIN") ?? join(homedir(), ".maestro/bin/maestro"),
    androidCliBin:
      envString("OPENBEACON_VERIFY_ANDROID_CLI_BIN") ?? join(homedir(), ".local/bin/android"),
  };
};
