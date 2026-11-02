import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const target = process.argv[2];
if (!target) throw new Error("Provide an APK or iOS .app path, or an Android device serial");

const temporary = mkdtempSync(join(tmpdir(), "openbeacon-map-assets-"));
try {
  let packaged = join(resolve(target), "map");
  if (!target.endsWith(".app")) {
    let apk = resolve(target);
    if (!target.endsWith(".apk")) {
      const pathResult = Bun.spawnSync([
        "adb",
        "-s",
        target,
        "shell",
        "pm",
        "path",
        "net.openbeacon.app",
      ]);
      if (pathResult.exitCode !== 0)
        throw new Error(`Cannot find installed app on ${target}: ${pathResult.stderr.toString()}`);
      const packagePath = pathResult.stdout
        .toString()
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("package:") && line.endsWith("/base.apk"));
      if (!packagePath) throw new Error(`Cannot find base APK on ${target}`);
      apk = join(temporary, "installed.apk");
      const pull = Bun.spawnSync([
        "adb",
        "-s",
        target,
        "pull",
        packagePath.slice("package:".length),
        apk,
      ]);
      if (pull.exitCode !== 0)
        throw new Error(`Cannot read installed APK: ${pull.stderr.toString()}`);
    }
    const extraction = Bun.spawnSync(["unzip", "-qq", apk, "assets/map-assets/*", "-d", temporary]);
    if (extraction.exitCode !== 0)
      throw new Error(`APK does not contain bundled map assets: ${extraction.stderr.toString()}`);
    packaged = join(temporary, "assets/map-assets");
  }
  const source = resolve(import.meta.dir, "../assets/map");
  const files = readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(source, join(entry.parentPath, entry.name)));
  for (const file of files) {
    const expected = createHash("sha256")
      .update(readFileSync(join(source, file)))
      .digest("hex");
    const actual = createHash("sha256")
      .update(readFileSync(join(packaged, file)))
      .digest("hex");
    if (actual !== expected) throw new Error(`Installed map asset differs from source: ${file}`);
  }
  console.log(`Verified ${files.length} map assets in ${target}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
