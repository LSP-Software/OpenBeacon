import { useQuery } from "@tanstack/react-query";
import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  ChevronRightIcon,
  MapPinIcon,
  PlusCircleIcon,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { InviteMemberToGroupDialog } from "../../../../components/dialogs/InviteMemberToGroupDialog";
import { LoadingIndicator } from "../../../../components/LoadingIndicator";
import { Avatar, AvatarFallback, AvatarImage } from "../../../../components/ui/Avatar";
import { Button } from "../../../../components/ui/Button";
import { Icon } from "../../../../components/ui/Icon";
import { Text } from "../../../../components/ui/Text";
import { type RouterOutputs, trpc } from "../../../../lib/api";
import { timeSince } from "../../../../lib/timeSince";

interface MembersTabProps {
  groupId: string;
}

export default function MembersTab({ groupId }: MembersTabProps) {
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const { data: members, isFetching: isFetchingMembers } = useQuery(
    trpc.groups.members.queryOptions({ groupId }),
  );

  if (isFetchingMembers) {
    return <LoadingIndicator />;
  }

  return (
    <View className="gap-4">
      <InviteMemberToGroupDialog
        open={addMemberDialogOpen}
        setOpen={setAddMemberDialogOpen}
        groupId={groupId}
      />
      <View className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-muted font-semibold text-lg">Group Members</Text>
          <Text className="text-foreground text-sm">{members?.length ?? 0} members</Text>
        </View>
        <Button size="sm" onPress={() => setAddMemberDialogOpen(true)}>
          <Icon as={PlusCircleIcon} size={20} className="text-white" />
          <Text>Invite member</Text>
        </Button>
      </View>
      {members?.map((member) => (
        <View key={member.id}>
          <MemberCard member={member} />
        </View>
      ))}
    </View>
  );
}

interface MemberCardProps {
  member: RouterOutputs["groups"]["members"][number];
}

const MemberCard = ({ member }: MemberCardProps) => {
  const { icon: BatteryIcon, colorClass } = getBatteryVisual({
    batteryLevel: member.batteryLevel,
    charging: member.battery.charging,
  });

  return (
    <View className="bg-card p-4 rounded-lg border border-border">
      <View className="flex flex-row items-center gap-3">
        <View className="flex-row items-center gap-3">
          <Avatar alt={member.user.name} className="size-12">
            <AvatarImage source={{ uri: member.user.image ?? "" }} />
            <AvatarFallback>
              <Text className="font-bold">
                {member.user.name.charAt(0) + member.user.name.charAt(1)}
              </Text>
            </AvatarFallback>
          </Avatar>
        </View>
        <View className="gap-1 flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-foreground font-bold text-xl">{member.user.name}</Text>
            <Icon as={ChevronRightIcon} className="text-muted" />
          </View>
          <View className="flex-row items-start gap-1">
            <Icon as={MapPinIcon} className="text-secondary size-4 mt-1" />
            <View className="flex-col items-start">
              <Text className="text-muted text-md">
                <Text className="font-semibold">Current Location:</Text> {member.lastLocation.place}
              </Text>
              <Text className="text-muted text-sm">
                Location updated {timeSince(member.lastLocation.timestamp)}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            <Icon as={BatteryIcon} size={20} className={colorClass} />
            <Text className={`${colorClass} text-sm`}>Battery: {member.batteryLevel}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const getBatteryVisual = ({
  batteryLevel,
  charging,
}: {
  batteryLevel: number;
  charging: boolean;
}) => {
  if (charging) {
    return { icon: BatteryChargingIcon, colorClass: "text-green-500" };
  }

  if (batteryLevel <= 25) {
    return { icon: BatteryLowIcon, colorClass: "text-red-500" };
  }

  if (batteryLevel <= 60) {
    return { icon: BatteryMediumIcon, colorClass: "text-orange-500" };
  }

  return { icon: BatteryFullIcon, colorClass: "text-green-500" };
};
