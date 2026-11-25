import type { MirroredSpeedLimitPacks } from "@openbeacon/map-tiles";

export const SPEED_LIMIT_PACK_URL_EXPIRES_IN_SECONDS = 60 * 60;
const REFRESH_BEFORE_EXPIRY_MS = 30 * 60 * 1000;

export const createSpeedLimitPackUrls = ({
  now = Date.now,
  readManifest,
  sign,
}: {
  now?: () => number;
  readManifest: () => Promise<MirroredSpeedLimitPacks | null>;
  sign: (key: string) => Promise<string>;
}) => {
  let cached: {
    mirroredAt: string;
    refreshAt: number;
    value: Awaited<ReturnType<typeof signAll>>;
  } | null = null;

  const signAll = async (manifest: MirroredSpeedLimitPacks) => {
    const expiresAt = now() + SPEED_LIMIT_PACK_URL_EXPIRES_IN_SECONDS * 1000;
    const [boundariesUrl, regions] = await Promise.all([
      sign(manifest.boundaries.key),
      Promise.all(
        manifest.regions.map(async (region) => ({
          id: region.id,
          name: region.name,
          countryCode: region.countryCode,
          bounds: region.bounds,
          size: region.size,
          sha256: region.sha256,
          url: await sign(region.key),
        })),
      ),
    ]);

    return {
      build: manifest.build,
      publishedAt: manifest.publishedAt,
      license: manifest.license,
      licenseUrl: manifest.licenseUrl,
      attribution: manifest.attribution,
      expiresAt: new Date(expiresAt).toISOString(),
      boundaries: {
        url: boundariesUrl,
        size: manifest.boundaries.size,
        sha256: manifest.boundaries.sha256,
      },
      regions,
    };
  };

  return async () => {
    const manifest = await readManifest();

    if (!manifest) {
      return null;
    }

    if (cached && cached.mirroredAt === manifest.mirroredAt && now() < cached.refreshAt) {
      return cached.value;
    }

    const value = await signAll(manifest);
    cached = {
      mirroredAt: manifest.mirroredAt,
      refreshAt: Date.parse(value.expiresAt) - REFRESH_BEFORE_EXPIRY_MS,
      value,
    };
    return value;
  };
};
