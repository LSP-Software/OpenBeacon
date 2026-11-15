import { useIsFocused } from "@react-navigation/native";
import { skipToken, useQuery } from "@tanstack/react-query";
import { authClient } from "../lib/auth-client.ts";
import { loadPersonalNicknames } from "../lib/personalNicknames.ts";
import { useCachedGroup } from "./useCachedGroup.ts";

export const useMemberNames = (groupId: string) => {
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const { group } = useCachedGroup(groupId);
  const nicknames = useQuery({
    queryKey: ["personalNicknames", groupId, userId],
    queryFn: userId ? () => loadPersonalNicknames(groupId, userId) : skipToken,
    subscribed: isFocused,
  });
  return (memberUserId: string) => {
    const member = group?.members.find((item) => item.userId === memberUserId);
    if (!member) return null;
    return nicknames.data?.[member.id]?.name ?? member.name;
  };
};
