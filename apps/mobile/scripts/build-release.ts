import { parseProjectEnv } from "@expo/env";
import { tryCatch } from "@openbeacon/shared";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { FIREBASE_ENV_NAMES } from "../plugins/withFirebasePush.js";
import { checkFirebaseValues } from "./firebaseBuildCheck.ts";
import { checkServerGoogleClientId } from "./googleClientIdBuildCheck.ts";

const projectRoot = resolve(import.meta.dir, "..");
const allowDirty = process.argv.includes("--allow-dirty");
const apk = process.argv.includes("--apk");
const skipServerCheck = process.argv.includes("--skip-server-check");
const serverUrl =
  process.argv.find((arg) => arg.startsWith("--server="))?.slice("--server=".length) ??
  "https://api.openbeacon.net";

const fail: (message: string) => never = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

const run = (command: string[], cwd: string, env: Record<string, string | undefined> = {}) => {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

const runVisible = (
  command: string[],
  cwd: string,
  env: Record<string, string | undefined> = {},
) => {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) fail(`${command.join(" ")} failed.`);
};

const sha1Of = (keytoolOutput: string) => keytoolOutput.match(/SHA1:\s*([0-9A-F:]+)/)?.[1];
const normaliseSha1 = (sha1: string) => sha1.replaceAll(":", "").toLowerCase();

const status = run(["git", "status", "--porcelain"], projectRoot);
if (!status.ok) fail(`Could not read git status:\n${status.output}`);
if (status.output.trim() && !allowDirty) {
  fail(
    `There are uncommitted changes, which would end up in the release:\n${status.output}\nCommit or stash them, or pass --allow-dirty for a test build.`,
  );
}

const { env } = parseProjectEnv(projectRoot, {
  mode: "production",
  silent: true,
});
const googleWebClientId =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? env["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"];
if (!googleWebClientId) {
  fail(
    "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set, so Google sign-in would be turned off. Set it in apps/mobile/.env.",
  );
}

if (skipServerCheck) {
  console.warn("\nNot checking EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID against the server.\n");
} else {
  const google = await checkServerGoogleClientId({ serverUrl, webClientId: googleWebClientId });
  if (google.problem === "fail") fail(google.message);
  if (google.problem === "warn") console.warn(`\n${google.message}\n`);
}

const firebaseEnv = Object.fromEntries(
  FIREBASE_ENV_NAMES.map((name) => [name, process.env[name] ?? env[name]]),
);
const firebase = checkFirebaseValues({ apk, env: firebaseEnv });
if (firebase.problem === "fail") fail(firebase.message);
if (firebase.problem === "warn") console.warn(`\n${firebase.message}\n`);

const credentialsPath = resolve(
  projectRoot,
  process.env["ORG_GRADLE_PROJECT_openbeaconCredentials"] ?? "credentials.json",
);
if (!existsSync(credentialsPath)) {
  fail(`${credentialsPath} does not exist. See docs/development/android-release-builds.md.`);
}
const credentialsJson = await tryCatch(Bun.file(credentialsPath).json());
if (credentialsJson.error) fail(`${credentialsPath} is not valid JSON.`);
const credentials = z
  .object({
    keystorePath: z.string().refine(isAbsolute, "must be an absolute path"),
    keystorePassword: z.string().min(1, "is empty"),
    keyAlias: z.string().min(1, "is empty"),
    keyPassword: z.string().min(1, "is empty"),
  })
  .safeParse(credentialsJson.data);
if (!credentials.success) {
  fail(
    `${credentialsPath} is incomplete:\n${credentials.error.issues.map((issue) => `  ${issue.path.join(".")} ${issue.message}`).join("\n")}`,
  );
}
const { keystorePath, keystorePassword, keyAlias, keyPassword } = credentials.data;
if (!existsSync(keystorePath)) fail(`The keystore ${keystorePath} does not exist.`);

const passwords = {
  OPENBEACON_STORE_PASSWORD: keystorePassword,
  OPENBEACON_KEY_PASSWORD: keyPassword,
};
const keystore = [
  "-keystore",
  keystorePath,
  "-alias",
  keyAlias,
  "-storepass:env",
  "OPENBEACON_STORE_PASSWORD",
];
const keyListing = run(["keytool", "-list", "-v", ...keystore], projectRoot, passwords);
if (!keyListing.ok) fail(`Could not open the keystore:\n${keyListing.output}`);
const keyUnlock = run(
  ["keytool", "-certreq", ...keystore, "-keypass:env", "OPENBEACON_KEY_PASSWORD"],
  projectRoot,
  passwords,
);
if (!keyUnlock.ok) fail(`Could not unlock the key with keyPassword:\n${keyUnlock.output}`);
if (keyUnlock.output.includes("not supported for PKCS12")) {
  fail("PKCS12 keystores have one password, so keyPassword must match keystorePassword.");
}
const keySha1 = sha1Of(keyListing.output);
if (!keySha1) fail("Could not read the upload key's SHA1.");

const findApksigner = () => {
  const androidSdk = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"];
  if (!androidSdk) {
    return fail(
      "Could not find apksigner because ANDROID_HOME is not set. Set it to your Android SDK.",
    );
  }
  const buildToolsPath = join(androidSdk, "build-tools");
  const buildToolsVersion = existsSync(buildToolsPath)
    ? readdirSync(buildToolsPath)
        .filter((folder) => existsSync(join(buildToolsPath, folder, "apksigner")))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .at(-1)
    : undefined;
  if (!buildToolsVersion) {
    return fail(
      `Could not find apksigner in ${buildToolsPath}. Install the Android SDK build tools or set ANDROID_HOME.`,
    );
  }
  return join(buildToolsPath, buildToolsVersion, "apksigner");
};
const apksigner = apk ? findApksigner() : undefined;

const appJson = z
  .object({
    expo: z.object({
      version: z.string(),
      android: z.object({ versionCode: z.number().int() }),
    }),
  })
  .parse(JSON.parse(readFileSync(join(projectRoot, "app.json"), "utf8")));
const { version } = appJson.expo;
const { versionCode } = appJson.expo.android;

console.log(`Building OpenBeacon ${version} (${versionCode}) as ${apk ? "an APK" : "a bundle"}`);
console.log(`Signing with ${keyAlias}, SHA1 ${keySha1}`);
if (allowDirty) console.log("Including uncommitted changes");

runVisible(["bun", "run", "prisma", "generate"], resolve(projectRoot, "../../packages/database"));
runVisible(["bunx", "expo", "prebuild", "-p", "android", "--clean"], projectRoot, {
  ...firebaseEnv,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: googleWebClientId,
  NODE_ENV: "production",
});
runVisible(["./gradlew", apk ? "assembleRelease" : "bundleRelease"], join(projectRoot, "android"), {
  ORG_GRADLE_PROJECT_openbeaconCredentials: credentialsPath,
});

const outputPath = join(projectRoot, `openbeacon-${version}-${versionCode}.${apk ? "apk" : "aab"}`);
copyFileSync(
  join(
    projectRoot,
    apk
      ? "android/app/build/outputs/apk/release/app-release.apk"
      : "android/app/build/outputs/bundle/release/app-release.aab",
  ),
  outputPath,
);

const signature = apksigner
  ? run([apksigner, "verify", "--print-certs", outputPath], projectRoot)
  : run(["keytool", "-printcert", "-jarfile", outputPath], projectRoot);
if (!signature.ok) fail(`Could not verify the signature of ${outputPath}:\n${signature.output}`);
const signedSha1 = apksigner
  ? signature.output.match(/SHA-1 digest:\s*([0-9a-f]+)/)?.[1]
  : sha1Of(signature.output);
if (!signedSha1) fail(`Could not read the SHA1 ${outputPath} is signed with:\n${signature.output}`);
if (normaliseSha1(signedSha1) !== normaliseSha1(keySha1)) {
  fail(`${outputPath} is signed with ${signedSha1}, not the upload key ${keySha1}.`);
}

console.log(`\nBuilt ${outputPath}`);
console.log(
  apk
    ? `Signed with SHA1 ${keySha1}. Install it with adb install -r ${outputPath}`
    : `Signed with SHA1 ${keySha1}. Check it matches the upload key in Play Console.`,
);
