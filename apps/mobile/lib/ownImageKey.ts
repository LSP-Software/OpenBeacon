import { decodeBase64, encodeBase64, ImageKeyMaterial } from "@openbeacon/encryption";
import { z } from "zod";
import { deleteSecret, readSecret, secretOwner, writeSecret } from "./secretStorage.ts";

const getOwnImageKeyName = (userId: string) => `encryption.profileImage.${userId}`;

const storedOwnImageKeySchema = z.object({ fileName: z.string(), key: z.string() });

export const storeOwnImageKey = ({
  fileName,
  imageKey,
  userId,
}: {
  fileName: string;
  imageKey: ImageKeyMaterial;
  userId: string;
}) =>
  writeSecret(
    secretOwner(userId),
    getOwnImageKeyName(userId),
    JSON.stringify({ fileName, key: encodeBase64(imageKey.expose()) }),
  );

export const readOwnImageKey = async ({
  fileName,
  userId,
}: {
  fileName: string;
  userId: string;
}) => {
  const stored = await readSecret(getOwnImageKeyName(userId));
  if (!stored) return null;
  const parsed = storedOwnImageKeySchema.safeParse(parseJson(stored));
  if (!parsed.success || parsed.data.fileName !== fileName) return null;
  return new ImageKeyMaterial(decodeBase64(parsed.data.key));
};

export const deleteOwnImageKey = (userId: string) => deleteSecret(getOwnImageKeyName(userId));

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
