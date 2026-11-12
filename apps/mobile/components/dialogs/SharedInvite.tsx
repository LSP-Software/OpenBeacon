import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { focusManager, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Share, View } from "react-native";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { trpc } from "../../lib/api.ts";
import { BrandedQrCode } from "../BrandedQrCode.tsx";
import { Button } from "../ui/Button.tsx";
import { Text } from "../ui/Text.tsx";

export const SharedInvite = ({
  groupId,
  open,
  setOpen,
  value,
}: {
  groupId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  value: string;
}) => {
  const invite = useMutation(trpc.groupInvites.createShared.mutationOptions());
  const [expired, setExpired] = useState(false);
  const inviteId = invite.data?.id;
  const expiresInMs = invite.data?.expiresInMs;
  const reset = invite.reset;
  const { group } = useCachedGroup(groupId);
  const memberIdsKey = group?.members.map((member) => member.id).join(",");
  const statuses = useQuery({
    ...trpc.groupInvites.sharedStatuses.queryOptions({
      groupId,
      inviteIds: inviteId ? [inviteId] : [],
    }),
    enabled: false,
  });
  const refetchStatuses = statuses.refetch;
  const lastSeenMembers = useRef<{ inviteId: string; memberIdsKey: string | undefined } | null>(
    null,
  );
  useEffect(() => {
    if (!open || !inviteId) return;
    const previous = lastSeenMembers.current;
    lastSeenMembers.current = { inviteId, memberIdsKey };
    if (previous?.inviteId !== inviteId || previous.memberIdsKey === undefined) return;
    if (previous.memberIdsKey !== memberIdsKey) void refetchStatuses();
  }, [inviteId, memberIdsKey, open, refetchStatuses]);
  useEffect(() => {
    if (!open || !inviteId) return;
    return focusManager.subscribe((focused) => {
      if (focused) void refetchStatuses();
    });
  }, [inviteId, open, refetchStatuses]);
  const currentStatus = statuses.data?.find((item) => item.id === inviteId)?.status;
  const used = currentStatus === "used";
  useEffect(() => {
    if (inviteId === undefined || expiresInMs === undefined) return;
    setExpired(false);
    const timeout = setTimeout(() => setExpired(true), expiresInMs);
    return () => clearTimeout(timeout);
  }, [inviteId, expiresInMs]);
  useEffect(() => {
    if (!open || !used) return;
    reset();
    setOpen(false);
  }, [open, reset, setOpen, used]);
  const create = async () => {
    const result = await tryCatch(invite.mutateAsync({ groupId }));
    if (result.error) {
      Alert.alert("Unable to create invitation");
      return;
    }
  };
  if (value === "email") return null;
  const isExpired = expired || currentStatus === "expired";
  return (
    <View className="items-center gap-4">
      {invite.data && !isExpired ? (
        <>
          <Text>Valid for five minutes and one use.</Text>
          {value === "qr" ? (
            <BrandedQrCode
              accessibilityLabel="Invitation code. Scan it to join the group."
              size={200}
              value={invite.data.code}
            />
          ) : (
            <>
              <Text selectable>{invite.data.code}</Text>
              <Button
                onPress={async () => {
                  const result = await tryCatch(
                    Share.share({
                      message: `Join my Open Beacon group: openbeacon://join?code=${invite.data.code}`,
                    }),
                  );
                  if (result.error) Alert.alert("Unable to share invitation");
                }}
              >
                <Text>Share link</Text>
              </Button>
            </>
          )}
        </>
      ) : isExpired ? (
        <Text>This invitation has expired.</Text>
      ) : null}
      <Button onPress={create} loading={invite.isPending}>
        <Text>{invite.data ? "Create another invite" : "Create invite"}</Text>
      </Button>
    </View>
  );
};
