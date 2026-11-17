import { HeadObjectCommand } from "@aws-sdk/client-s3";

export const storedEncryptedImageResponse = (command: unknown) => {
  if (command instanceof HeadObjectCommand)
    return { $metadata: {}, ContentLength: 1024, ContentType: "application/octet-stream" };
  return { $metadata: {} };
};
