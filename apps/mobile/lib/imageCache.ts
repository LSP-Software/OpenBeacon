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
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
};

export const clearImageCache = () => {
  generation += 1;
  const directory = new Directory(Paths.cache, "images");
  if (directory.exists) directory.delete();
};
