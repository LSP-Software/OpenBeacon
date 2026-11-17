import { FIREBASE_ENV_NAMES } from "../plugins/withFirebasePush.js";

export const checkFirebaseValues = ({
  apk,
  env,
}: {
  apk: boolean;
  env: Record<string, string | undefined>;
}): { problem: null } | { problem: "fail" | "warn"; message: string } => {
  const missing = FIREBASE_ENV_NAMES.filter((name) => !env[name]?.trim());
  if (missing.length === 0) return { problem: null };
  const names = missing.join(", ");
  return apk
    ? {
        problem: "warn",
        message: `${names} not set in apps/mobile/.env, so this APK is built without push wake-ups.`,
      }
    : {
        problem: "fail",
        message: `${names} not set, so push wake-ups would be turned off. Set them in apps/mobile/.env. See docs/development/android-release-builds.md.`,
      };
};
