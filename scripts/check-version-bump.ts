const appConfigPath = "apps/mobile/app.json";
const serverVersionPath = "apps/backend/src/version.ts";
const apiCompatibilityPath = "packages/shared/src/apiCompatibilityLevel.ts";

const clientPaths = [
  "apps/mobile/",
  "packages/encryption/",
  "packages/schemas/",
  "packages/shared/",
];
const serverPaths = ["apps/backend/", "apps/scheduled-jobs/", "apps/map-tiles/", "packages/"];
const serverFiles = ["Dockerfile", "bunfig.toml"];
const sharedFiles = ["bun.lock", "packages/database/prisma/schema.prisma"];
const migrationsPath = "packages/database/prisma/migrations/";

const isServerFile = (file: string) =>
  serverFiles.includes(file) ||
  file === ".dockerignore" ||
  file.endsWith("/.dockerignore") ||
  (serverPaths.some((path) => file.startsWith(path)) && !file.startsWith("packages/tsconfig/"));

type ApiCompatibilityLevels = { level: number; minClient: number; minServer: number };

type Versions = {
  client: { version: string; buildNumber: number; versionCode: number };
  server: string;
  oldestSupportedApp?: string;
  apiCompatibility: ApiCompatibilityLevels | null;
  rootPackage?: string;
};

const isShippedFile = (file: string) =>
  !/\.test\.tsx?$/.test(file) &&
  !file.endsWith(".md") &&
  !file.includes("/src/test/") &&
  !file.startsWith("apps/mobile/test/") &&
  !file.includes("/src/androidTest/");

const parseSemver = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`"${version}" is not a major.minor.patch version`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isSemverGreater = (next: string, previous: string) => {
  const a = parseSemver(next);
  const b = parseSemver(previous);
  const index = a.findIndex((part, i) => part !== b[i]);
  return index !== -1 && (a[index] ?? 0) > (b[index] ?? 0);
};

const isMinorBumpOrMore = (next: string, previous: string) => {
  const [nextMajor = 0, nextMinor = 0] = parseSemver(next);
  const [previousMajor = 0, previousMinor = 0] = parseSemver(previous);
  return nextMajor > previousMajor || (nextMajor === previousMajor && nextMinor > previousMinor);
};

export const parseApiCompatibilityLevels = (source: string): ApiCompatibilityLevels => {
  const read = (name: string) => {
    const value = new RegExp(`export const ${name} = (\\d+);`).exec(source)?.[1];
    if (value === undefined) {
      throw new Error(`${apiCompatibilityPath} must export ${name} as a whole number`);
    }
    return Number(value);
  };
  return {
    level: read("apiCompatibilityLevel"),
    minClient: read("minClientApiCompatibilityLevel"),
    minServer: read("minServerApiCompatibilityLevel"),
  };
};

const findApiCompatibilityProblems = ({ base, head }: { base: Versions; head: Versions }) => {
  const levels = head.apiCompatibility;
  if (!levels) return [];
  const problems: string[] = [];
  if (levels.minClient > levels.level) {
    problems.push(
      `minClientApiCompatibilityLevel (${levels.minClient}) can't be above apiCompatibilityLevel (${levels.level}).`,
    );
  }
  if (levels.minServer > levels.level) {
    problems.push(
      `minServerApiCompatibilityLevel (${levels.minServer}) can't be above apiCompatibilityLevel (${levels.level}).`,
    );
  }
  const previous = base.apiCompatibility;
  if (!previous) return problems;
  const names = {
    level: "apiCompatibilityLevel",
    minClient: "minClientApiCompatibilityLevel",
    minServer: "minServerApiCompatibilityLevel",
  } as const;
  for (const key of ["level", "minClient", "minServer"] as const) {
    if (levels[key] < previous[key]) {
      problems.push(`${names[key]} can't go down (was ${previous[key]}, now ${levels[key]}).`);
    }
  }
  if (levels.level > previous.level + 1) {
    problems.push(
      `apiCompatibilityLevel can only go up by 1 per change (was ${previous.level}, now ${levels.level}).`,
    );
  }
  const changed = (["level", "minClient", "minServer"] as const).some(
    (key) => levels[key] !== previous[key],
  );
  if (changed && !isMinorBumpOrMore(head.client.version, base.client.version)) {
    problems.push(
      `API compatibility levels changed: raise expo.version in ${appConfigPath} by at least a minor version above ${base.client.version}.`,
    );
  }
  if (changed && !isMinorBumpOrMore(head.server, base.server)) {
    problems.push(
      `API compatibility levels changed: raise serverVersion in ${serverVersionPath} by at least a minor version above ${base.server}.`,
    );
  }
  return problems;
};

const findOldestSupportedAppProblems = ({ base, head }: { base: Versions; head: Versions }) => {
  const oldest = head.oldestSupportedApp;
  if (!oldest) return [];
  const problems: string[] = [];
  const previous = base.oldestSupportedApp;
  if (isSemverGreater(oldest, head.client.version)) {
    problems.push(
      `oldestSupportedAppVersion (${oldest}) in ${serverVersionPath} can't be above expo.version (${head.client.version}): set it to ${head.client.version} or lower.`,
    );
  }
  if (previous && isSemverGreater(previous, oldest)) {
    problems.push(
      `oldestSupportedAppVersion in ${serverVersionPath} can't go down (was ${previous}, now ${oldest}): set it back to ${previous} or later.`,
    );
  }
  const levels = head.apiCompatibility;
  const previousLevels = base.apiCompatibility;
  if (!levels || !previousLevels) return problems;
  if (levels.minClient > previousLevels.level) {
    if (oldest !== head.client.version) {
      problems.push(
        `minClientApiCompatibilityLevel rose to the new level ${levels.minClient}: set oldestSupportedAppVersion in ${serverVersionPath} to ${head.client.version}.`,
      );
    }
  } else if (levels.minClient > previousLevels.minClient) {
    if (previous && !isSemverGreater(oldest, previous)) {
      problems.push(
        `minClientApiCompatibilityLevel rose to ${levels.minClient}: set oldestSupportedAppVersion in ${serverVersionPath} above ${previous}, to the first app version on level ${levels.minClient}.`,
      );
    }
  } else if (
    levels.minClient === previousLevels.minClient &&
    previous &&
    isSemverGreater(oldest, previous)
  ) {
    problems.push(
      `minClientApiCompatibilityLevel didn't change: set oldestSupportedAppVersion in ${serverVersionPath} back to ${previous}.`,
    );
  }
  return problems;
};

export const parseClientVersion = (appJson: string): Versions["client"] => {
  const config: {
    expo?: {
      version?: unknown;
      ios?: { buildNumber?: unknown };
      android?: { versionCode?: unknown };
    };
  } = JSON.parse(appJson);
  const version = config.expo?.version;
  const buildNumber = Number(config.expo?.ios?.buildNumber);
  const versionCode = config.expo?.android?.versionCode;
  if (
    typeof version !== "string" ||
    !Number.isInteger(buildNumber) ||
    typeof versionCode !== "number"
  ) {
    throw new Error(
      `${appConfigPath} must set expo.version, expo.ios.buildNumber and expo.android.versionCode`,
    );
  }
  parseSemver(version);
  return { version, buildNumber, versionCode };
};

export const parseServerVersion = (source: string) => {
  const version = /export const serverVersion = "([^"]+)";/.exec(source)?.[1];
  if (!version) {
    throw new Error(`${serverVersionPath} must export serverVersion`);
  }
  parseSemver(version);
  return version;
};

export const parseOldestSupportedAppVersion = (
  source: string,
  { required }: { required: boolean },
) => {
  const version = /export const oldestSupportedAppVersion = "([^"]+)";/.exec(source)?.[1];
  if (!version) {
    if (required) {
      throw new Error(
        `${serverVersionPath} must export oldestSupportedAppVersion as a major.minor.patch version`,
      );
    }
    return undefined;
  }
  parseSemver(version);
  return version;
};

export const parseRootPackage = (source: string) =>
  JSON.stringify({ ...JSON.parse(source), scripts: undefined });

export const findMissingVersionBumps = ({
  changedFiles,
  base,
  head,
}: {
  changedFiles: string[];
  base: Versions;
  head: Versions;
}) => {
  const rootPackageChanged =
    base.rootPackage === undefined || base.rootPackage !== head.rootPackage;
  const shipped = changedFiles
    .filter(isShippedFile)
    .filter((file) => file !== "package.json" || rootPackageChanged);
  const isSharedFile = (file: string) => sharedFiles.includes(file) || file === "package.json";
  const problems: string[] = [];

  if (
    shipped.some((file) => isSharedFile(file) || clientPaths.some((path) => file.startsWith(path)))
  ) {
    if (!isSemverGreater(head.client.version, base.client.version)) {
      problems.push(
        `Client code changed: raise expo.version in ${appConfigPath} above ${base.client.version}.`,
      );
    }
    if (head.client.buildNumber <= base.client.buildNumber) {
      problems.push(
        `Client code changed: raise expo.ios.buildNumber in ${appConfigPath} above ${base.client.buildNumber}.`,
      );
    }
    if (head.client.versionCode <= base.client.versionCode) {
      problems.push(
        `Client code changed: raise expo.android.versionCode in ${appConfigPath} above ${base.client.versionCode}.`,
      );
    }
  }

  if (
    shipped.some((file) => file.startsWith(migrationsPath)) &&
    !isMinorBumpOrMore(head.server, base.server)
  ) {
    problems.push(
      `Database migration changed: raise serverVersion in ${serverVersionPath} by at least a minor version above ${base.server}.`,
    );
  } else if (
    shipped.some((file) => isSharedFile(file) || isServerFile(file)) &&
    !isSemverGreater(head.server, base.server)
  ) {
    problems.push(
      `Server code changed: raise serverVersion in ${serverVersionPath} above ${base.server}.`,
    );
  }

  return [
    ...problems,
    ...findApiCompatibilityProblems({ base, head }),
    ...findOldestSupportedAppProblems({ base, head }),
  ];
};

if (import.meta.main) {
  const baseRef = process.argv[2] ?? "origin/main";
  const mergeBase = (await Bun.$`git merge-base ${baseRef} HEAD`.text()).trim();
  const changedFiles = (await Bun.$`git diff --name-only ${mergeBase} HEAD`.text())
    .split("\n")
    .filter(Boolean);
  const readVersions = async (ref: string): Promise<Versions> => {
    const serverSource = await Bun.$`git show ${ref}:${serverVersionPath}`.text();
    const oldestSupportedApp = parseOldestSupportedAppVersion(serverSource, {
      required: ref === "HEAD",
    });
    return {
      client: parseClientVersion(await Bun.$`git show ${ref}:${appConfigPath}`.text()),
      server: parseServerVersion(serverSource),
      ...(oldestSupportedApp ? { oldestSupportedApp } : {}),
      apiCompatibility: await (async () => {
        const source = await Bun.$`git show ${ref}:${apiCompatibilityPath}`.quiet().nothrow();
        return source.exitCode === 0 ? parseApiCompatibilityLevels(source.text()) : null;
      })(),
      rootPackage: parseRootPackage(await Bun.$`git show ${ref}:package.json`.text()),
    };
  };

  const problems = findMissingVersionBumps({
    changedFiles,
    base: await readVersions(mergeBase),
    head: await readVersions("HEAD"),
  });

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("Version numbers are up to date.");
}
