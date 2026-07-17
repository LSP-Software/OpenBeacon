import type { GroupRole } from "@openbeacon/database";

export interface GroupListItem {
  id: string;
  name: string;
  image: string | null;
  members: {
    id: string;
    userId: string;
    name: string;
    image: string | null;
    role: GroupRole;
  }[];
}
