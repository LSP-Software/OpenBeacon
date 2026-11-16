import { imageFileNameSchema } from "@openbeacon/schemas";
import { Directory, File, Paths } from "expo-file-system";

export const imageFileNameFromUrl = (url: string | null | undefined) => {
  const parsed = imageFileNameSchema.safeParse(url?.split("/").pop());
  return parsed.success ? parsed.data : null;
};

export const imageCacheFile = (fileName: string) =>
  new File(Paths.cache, "images", imageFileNameSchema.parse(fileName));

export const writeCachedImage = ({ bytes, fileName }: { bytes: Uint8Array; fileName: string }) => {
  new Directory(Paths.cache, "images").create({ idempotent: true, intermediates: true });
  const file = imageCacheFile(fileName);
  file.create({ overwrite: true });
  file.write(bytes);
};
