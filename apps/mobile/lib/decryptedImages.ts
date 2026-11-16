import { resolveEpochKey } from "./epochKeys.ts";
import { cachedImageUri, imageCacheGeneration, writeCachedImage } from "./imageCache.ts";
import { createImageDecryptor } from "./imageDecryptor.ts";
import { getOwnImageKey } from "./imageKeys.ts";

export const downloadEncryptedImage = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
  if (!response.ok) throw new Error(`Picture download failed with ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
};

export const { load: loadDecryptedImage } = createImageDecryptor({
  cachedUri: cachedImageUri,
  download: downloadEncryptedImage,
  generation: imageCacheGeneration,
  getOwnImageKey,
  now: Date.now,
  resolveEpochKey: (input) => resolveEpochKey(input),
  writeCached: writeCachedImage,
});
