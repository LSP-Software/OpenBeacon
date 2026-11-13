import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

export const storedWebp = Uint8Array.from(
  atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="),
  (char) => char.charCodeAt(0),
);

export const storedWebpResponse = (command: unknown) => {
  if (command instanceof HeadObjectCommand)
    return { $metadata: {}, ContentLength: storedWebp.length, ContentType: "image/webp" };
  if (command instanceof GetObjectCommand)
    return {
      $metadata: {},
      Body: { transformToByteArray: async () => storedWebp.slice(0, 16) },
    };
  return { $metadata: {} };
};
