import { imageFileNameSchema } from "@openbeacon/schemas";
import { Directory, File, Paths } from "expo-file-system";
let generation = 0;

export const imageFileNameFromUrl = (url: string | null | undefined) => {
  const parsed = imageFileNameSchema.safeParse(url?.split("/").pop());
  return parsed.success ? parsed.data : null;
};

export const imageCacheFile = (fileName: string) =>
  new File(Paths.cache, "images", imageFileNameSchema.parse(fileName));

export const imageCacheGeneration = () => generation;

export const cachedImageUri = (fileName: string) => {
  const file = imageCacheFile(fileName);
  return file.exists ? file.uri : null;
};

export const readCachedImage = async (fileName: string) => {
  const file = imageCacheFile(fileName);
  return file.exists ? file.bytes() : null;
};

export const writeCachedImage = ({
  bytes,
  fileName,
  forGeneration = generation,
}: {
  bytes: Uint8Array;
  fileName: string;
  forGeneration?: number;
}) => {
  if (forGeneration !== generation) return null;
  new Directory(Paths.cache, "images").create({ idempotent: true, intermediates: true });
  const file = imageCacheFile(fileName);
  const partial = new File(Paths.cache, "images", `${fileName}.part`);
  try {
    partial.create({ overwrite: true });
    partial.write(bytes);
    if (file.exists) file.delete();
    partial.move(file);
  } catch (error) {
    if (partial.exists) partial.delete();
    throw error;
  }
  return file.uri;
};

export const clearImageCache = () => {
  generation += 1;
  const ownerFile = new File(Paths.cache, "images", "owner");
  if (ownerFile.exists) ownerFile.delete();
  const directory = new Directory(Paths.cache, "images");
  if (directory.exists) directory.delete();
};

export const claimImageCache = (owner: string | null) => {
  const ownerFile = new File(Paths.cache, "images", "owner");
  if (owner && ownerFile.exists && ownerFile.textSync() === owner) return;
  clearImageCache();
  if (!owner) return;
  new Directory(Paths.cache, "images").create({ idempotent: true, intermediates: true });
  ownerFile.create({ overwrite: true });
  ownerFile.write(owner);
};
