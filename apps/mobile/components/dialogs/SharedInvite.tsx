import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { focusManager, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Platform, Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  LinkIcon,
  PlusIcon,
  QrCodeIcon,
  Share2Icon,
  UsersIcon,
} from "lucide-react-native";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { trpc } from "../../lib/api.ts";
import { getBaseUrl, isHostedServer } from "../../lib/currentServer.ts";
import { inviteLink } from "../../lib/inviteLink.ts";
import { BrandedQrCode } from "../BrandedQrCode.tsx";
import { JoinCodeGrid } from "../JoinCodeGrid.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
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
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [timing, setTiming] = useState<{ inviteId: string; deadline: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  const inviteId = invite.data?.id;
  const expiresInMs = invite.data?.expiresInMs;
  const reset = invite.reset;
  useEffect(() => {
    if (value) reset();
  }, [value, reset]);
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
      if (!focused) return;
      setNow(Date.now());
      void refetchStatuses();
    });
  }, [inviteId, open, refetchStatuses]);
  const currentStatus = statuses.data?.find((item) => item.id === inviteId)?.status;
  const used = currentStatus === "used";
  useEffect(() => {
    if (inviteId === undefined || expiresInMs === undefined) return;
    setTiming({ inviteId, deadline: Date.now() + expiresInMs });
    setNow(Date.now());
    const timeout = setTimeout(() => setNow(Date.now()), expiresInMs);
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      clearTimeout(timeout);
      clearInterval(tick);
    };
  }, [inviteId, expiresInMs]);
  useEffect(() => {
    if (!open || !used) return;
    reset();
    setOpen(false);
  }, [open, reset, setOpen, used]);
  const create = async () => {
    const result = await tryCatch(
      invite.mutateAsync({ groupId, kind: value === "link" ? "link" : "qr" }),
    );
    if (result.error) {
      Alert.alert("Couldn’t create invitation");
      return;
    }
  };
  if (value === "email") return null;
  const deadline = timing && timing.inviteId === inviteId ? timing.deadline : null;
  const isExpired = currentStatus === "expired" || (deadline !== null && now >= deadline);
  const copied = inviteId !== undefined && copiedInviteId === inviteId;
  const qr = value === "qr";
  if (!invite.data || isExpired) {
    return (
      <View className="gap-4">
        <View className="items-center gap-2 px-1 pt-2">
          <View className="mb-1 size-14 items-center justify-center rounded-full bg-primary-soft">
            <Icon as={qr ? QrCodeIcon : LinkIcon} className="text-primary-text size-6" />
          </View>
          <Text accessibilityRole="header" className="text-center text-lg font-semibold">
            {isExpired
              ? "This invite has expired"
              : qr
                ? "Invite with a QR code"
                : "Invite with a link or code"}
          </Text>
          <Text className="text-center text-sm text-secondary">
            {`Each invite lets one person join ${group?.name ?? "this group"}. It lasts ${qr ? 5 : 30} minutes, and they confirm on their own phone before joining.`}
          </Text>
        </View>
        <Button onPress={create} loading={invite.isPending}>
          <Icon as={PlusIcon} className="text-white" />
          <Text>Create invite</Text>
        </Button>
      </View>
    );
  }
  const code = invite.data.code;
  const minutesLeft = Math.max(
    1,
    Math.ceil((deadline === null ? invite.data.expiresInMs : deadline - now) / 60_000),
  );
  return (
    <View className="gap-4">
      {qr ? (
        <View className="items-center">
          <BrandedQrCode
            accessibilityLabel="Invitation code. Scan it to join the group."
            size={200}
            value={inviteLink({ code, server: getBaseUrl() })}
          />
        </View>
      ) : (
        <View className="gap-3 rounded-3xl bg-card p-4">
          <View className="flex-row items-center justify-between">
            <Text variant="label">Join code</Text>
            <Button
              variant="ghost"
              size="sm"
              className="-my-2 -mr-3"
              hitSlop={8}
              accessibilityLabel={copied ? "Code copied" : "Copy code"}
              onPress={async () => {
                const result = await tryCatch(Clipboard.setStringAsync(code));
                if (result.error) {
                  Alert.alert("Couldn’t copy code");
                  return;
                }
                setCopiedInviteId(invite.data.id);
              }}
            >
              <Icon as={copied ? CheckIcon : CopyIcon} className="text-primary-text size-4" />
              <Text>{copied ? "Copied" : "Copy"}</Text>
            </Button>
          </View>
          <JoinCodeGrid code={code} />
        </View>
      )}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <View className="flex-row items-center gap-1.5">
          <Icon as={ClockIcon} className="text-secondary size-4" />
          <Text className="text-sm text-secondary">{`Expires in ${minutesLeft} min`}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Icon as={UsersIcon} className="text-secondary size-4" />
          <Text className="text-sm text-secondary">One person</Text>
        </View>
      </View>
      {qr ? null : (
        <Button
          onPress={async () => {
            if (Platform.OS === "ios") setOpen(false);
            const server = getBaseUrl();
            const result = await tryCatch(
              Share.share({
                message: `Join my OpenBeacon group${isHostedServer(server) ? "" : ` on ${new URL(server).host}`}. Install OpenBeacon, then open this link: ${inviteLink({ code, server })}`,
              }),
            );
            if (result.error) Alert.alert("Couldn’t share invitation");
          }}
        >
          <Icon as={Share2Icon} className="text-white" />
          <Text>Share link</Text>
        </Button>
      )}
      <Button variant="ghost" size="sm" onPress={create} loading={invite.isPending}>
        <Text>Create another invite</Text>
      </Button>
    </View>
  );
};
