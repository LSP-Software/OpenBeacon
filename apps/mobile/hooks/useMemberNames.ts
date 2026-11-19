import { useIsFocused } from "@react-navigation/native";
import { skipToken, useQuery } from "@tanstack/react-query";
import { authClient } from "../lib/auth-client.ts";
import { loadPersonalNicknames } from "../lib/personalNicknames.ts";
import { useCachedGroup } from "./useCachedGroup.ts";

export const useMemberNameList = (groupId: string) => {
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
    if (!member) return [];
    const nickname = nicknames.data?.[member.id]?.name;
    return nickname ? [nickname, member.name] : [member.name];
  };
};

export const useMemberNames = (groupId: string) => {
  const names = useMemberNameList(groupId);
  return (memberUserId: string) => names(memberUserId)[0] ?? null;
};
