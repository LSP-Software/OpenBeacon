import type * as AvatarPrimitive from "@rn-primitives/avatar";
import { useDecryptedImage } from "../../hooks/useDecryptedImage.ts";
import { AvatarImage } from "../ui/Avatar.tsx";

export const DecryptedAvatarImage = ({
  url,
  ...props
}: Omit<AvatarPrimitive.ImageProps, "source"> & { url: string | null | undefined }) => {
  const uri = useDecryptedImage(url);
  return uri ? <AvatarImage source={{ uri }} {...props} /> : null;
};
