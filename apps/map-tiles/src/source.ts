import { z } from "zod";
import { isSupportedSchemaVersion } from "./pmtiles.ts";

const buildsSchema = z.array(
  z.object({
    key: z.string().regex(/^\d{8}\.pmtiles$/),
    size: z.number().int().positive(),
    version: z.string().min(1),
  }),
);

export type ProtomapsBuild = z.infer<typeof buildsSchema>[number];

export const listProtomapsBuilds = async () => {
  const response = await fetch("https://build-metadata.protomaps.dev/builds.json", {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Could not list Protomaps builds: HTTP ${response.status}`);
  }

  return buildsSchema.parse(await response.json());
};

export const pickProtomapsBuild = ({
  builds,
  date,
}: {
  builds: ProtomapsBuild[];
  date: string | undefined;
}) => {
  if (date) {
    const build = builds.find((candidate) => candidate.key === `${date}.pmtiles`);

    if (!build) {
      throw new Error(`Protomaps no longer lists a build for ${date}`);
    }
    if (!isSupportedSchemaVersion(build.version)) {
      throw new Error(`The ${date} build uses unsupported basemap schema ${build.version}`);
    }

    return build;
  }

  const latest = builds
    .filter((build) => isSupportedSchemaVersion(build.version))
    .sort((a, b) => b.key.localeCompare(a.key))[0];

  if (!latest) {
    throw new Error("Protomaps lists no build with a supported basemap schema");
  }

  return latest;
};

export const getBuildDate = (build: ProtomapsBuild) => build.key.replace(".pmtiles", "");

export const getProtomapsBuildUrl = (build: ProtomapsBuild) =>
  `https://build.protomaps.com/${build.key}`;

export const headSource = async (url: string) => {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  const size = Number(response.headers.get("content-length"));
  const etag = response.headers.get("etag");

  if (!response.ok || !Number.isSafeInteger(size) || size <= 0 || !etag) {
    throw new Error(`Could not read the size and ETag of ${url}: HTTP ${response.status}`);
  }

  return { etag, size };
};

export const fetchSourceRange = async ({
  etag,
  length,
  signal,
  start,
  url,
}: {
  etag: string;
  length: number;
  signal?: AbortSignal;
  start: number;
  url: string;
}) => {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${start + length - 1}`, "If-Match": etag },
    signal: signal ?? AbortSignal.timeout(60_000),
  });

  if (response.status !== 206) {
    throw new Error(`Range request to ${url} failed: HTTP ${response.status}`);
  }

  return response;
};
