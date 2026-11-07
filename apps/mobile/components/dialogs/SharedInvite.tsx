import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { trpc } from "../../lib/api.ts";
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
  const queryClient = useQueryClient();
  const invite = useMutation(trpc.groupInvites.createShared.mutationOptions());
  const [expired, setExpired] = useState(false);
  const inviteId = invite.data?.id;
  const expiresInMs = invite.data?.expiresInMs;
  const reset = invite.reset;
  const statuses = useQuery({
    ...trpc.groupInvites.sharedStatuses.queryOptions({
      groupId,
      inviteIds: inviteId ? [inviteId] : [],
    }),
    enabled: open && !!inviteId,
    refetchInterval: 3_000,
  });
  const currentStatus = statuses.data?.find((item) => item.id === inviteId)?.status;
  const used = currentStatus === "used";
  useEffect(() => {
    if (expiresInMs === undefined) return;
    setExpired(false);
    const timeout = setTimeout(() => setExpired(true), expiresInMs);
    return () => clearTimeout(timeout);
  }, [inviteId, expiresInMs]);
  useEffect(() => {
    if (!open || !used) return;
    reset();
    setOpen(false);
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.groupMembership.members.queryKey({ groupId }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.get.queryKey({ groupId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
    ]);
  }, [groupId, open, queryClient, reset, setOpen, used]);
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
            <QRCode value={invite.data.code} size={200} />
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
