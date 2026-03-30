import z from "zod";

export const requestImageUploadInputSchema = ({
  maxImageFileSize,
}: {
  maxImageFileSize: number;
}) => {
  return z.object({
    fileSize: z.number().int().nonnegative().max(maxImageFileSize).min(1),
    contentHash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  });
};
