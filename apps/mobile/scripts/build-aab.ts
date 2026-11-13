import { parseProjectEnv } from "@expo/env";
import { tryCatch } from "@openbeacon/shared";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

const projectRoot = resolve(import.meta.dir, "..");
const allowDirty = process.argv.includes("--allow-dirty");

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

const runVisible = (command: string[], cwd: string) => {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) fail(`${command.join(" ")} failed.`);
};

const sha1Of = (keytoolOutput: string) => keytoolOutput.match(/SHA1:\s*([0-9A-F:]+)/)?.[1];

const status = run(["git", "status", "--porcelain"], projectRoot);
if (!status.ok) fail(`Could not read git status:\n${status.output}`);
if (status.output.trim() && !allowDirty) {
  fail(
    `There are uncommitted changes, which would end up in the release:\n${status.output}\nCommit or stash them, or pass --allow-dirty for a build you won't upload.`,
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

console.log(`Building Open Beacon ${version} (${versionCode})`);
console.log(`Signing with ${keyAlias}, SHA1 ${keySha1}`);
if (allowDirty) console.log("Including uncommitted changes");

runVisible(["bun", "run", "prisma", "generate"], resolve(projectRoot, "../../packages/database"));
runVisible(["bunx", "expo", "prebuild", "-p", "android", "--clean"], projectRoot);
runVisible(["./gradlew", "bundleRelease"], join(projectRoot, "android"));

const outputPath = join(projectRoot, `openbeacon-${version}-${versionCode}.aab`);
copyFileSync(
  join(projectRoot, "android/app/build/outputs/bundle/release/app-release.aab"),
  outputPath,
);

const bundleCertificate = run(["keytool", "-printcert", "-jarfile", outputPath], projectRoot);
const bundleSha1 = sha1Of(bundleCertificate.output);
if (bundleSha1 !== keySha1) {
  fail(`${outputPath} is signed with ${bundleSha1 ?? "no key"}, not the upload key ${keySha1}.`);
}

console.log(`\nBuilt ${outputPath}`);
console.log(`Signed with SHA1 ${bundleSha1}. Check it matches the upload key in Play Console.`);
