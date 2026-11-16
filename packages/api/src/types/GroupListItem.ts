import type { GroupRole } from "@openbeacon/database";

export type StoredImageKey = {
  algorithm: string;
  ciphertext: string;
  epochId: string;
  nonce: string;
  senderDeviceId: string;
};

export interface GroupListItem {
  id: string;
  name: string;
  image: string | null;
  imageKey: StoredImageKey | null;
  members: {
    id: string;
    userId: string;
    name: string;
    image: string | null;
    imageKey: StoredImageKey | null;
    role: GroupRole;
  }[];
}
