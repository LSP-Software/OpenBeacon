import type { GroupRole } from "@openbeacon/database";
import type { EncryptedImageKey } from "@openbeacon/encryption";

export type StoredImageKey = Omit<EncryptedImageKey, "algorithm"> & { algorithm: string };

export interface GroupListItem {
  id: string;
  name: string;
  image: string | null;
  imageKey: StoredImageKey | null;
  latestEpochId: string | null;
  members: {
    id: string;
    userId: string;
    name: string;
    image: string | null;
    imageKey: StoredImageKey | null;
    role: GroupRole;
  }[];
}
