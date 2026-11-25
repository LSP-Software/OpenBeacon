import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { CarIcon } from "lucide-react-native";
import { Platform, ScrollView, View } from "react-native";
import { ScreenHeader } from "../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../components/LoadingIndicator.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/Accordion.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Switch } from "../components/ui/Switch.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useCachedGroup } from "../hooks/useCachedGroup.ts";
import { useDriveAlertMutes } from "../hooks/useDriveAlertMutes.ts";
import { useLiveTrackingPositions } from "../hooks/useLiveTrackingPositions.ts";
import { useMemberNames } from "../hooks/useMemberNames.ts";
import { usePlaceAlertMutes } from "../hooks/usePlaceAlertMutes.ts";
import { authClient } from "../lib/auth-client.ts";
import { driveMuteState } from "../lib/driveAlertMutes.ts";
import { initials } from "../lib/initials.ts";
import { placeMuteState } from "../lib/placeAlertMutes.ts";
import { groupPlacesQueryOptions } from "../lib/placeSync.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const PlaceAlertsScreen = () => {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const cachedGroup = useCachedGroup(groupId);
  const { group } = cachedGroup;
  const places = useQuery({ ...groupPlacesQueryOptions(groupId, userId), subscribed: isFocused });
  const memberName = useMemberNames(groupId);
  const { mutes, setMute } = usePlaceAlertMutes(groupId);
  const driveMutes = useDriveAlertMutes(groupId);
  const live = useLiveTrackingPositions({ groupId });
  const memberUserIds = (group?.members ?? [])
    .map((member) => member.userId)
    .filter((memberUserId) => memberUserId !== userId);
  const nameOf = (memberUserId: string) => memberName(memberUserId) ?? "Someone";
  const driveState = driveMuteState({
    memberUserIds,
    mutes: driveMutes.mutes.data?.mutes ?? [],
    nameOf,
    quietUserIds: live.positions
      .filter((position) => position.driveAlertsOff)
      .map((position) => position.userId),
  });
  const showDrives = Platform.OS === "android";

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Alerts" subtitle={group?.name} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-32 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-secondary text-base">
          {`Choose whose ${showDrives ? "drives, " : ""}arrivals and departures you hear about. This changes your alerts on all your ${thisDeviceNoun()}s. Everyone else still gets theirs.`}
        </Text>

        {cachedGroup.isMissing ? (
          <Text>{`This group isn’t available on this ${thisDeviceNoun()}.`}</Text>
        ) : cachedGroup.isError ? (
          <View className="gap-3">
            <Text>Couldn’t load your groups. Check your connection and try again.</Text>
            <Button variant="secondary" onPress={() => void cachedGroup.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        ) : (places.isError && !places.data) ||
          (mutes.isError && !mutes.data) ||
          (showDrives && driveMutes.mutes.isError && !driveMutes.mutes.data) ? (
          <View className="gap-3">
            <Text>Couldn’t load your alerts. Check your connection and try again.</Text>
            <Button
              variant="secondary"
              onPress={() => {
                void places.refetch();
                void mutes.refetch();
                void driveMutes.mutes.refetch();
              }}
            >
              <Text>Try again</Text>
            </Button>
          </View>
        ) : places.isPending ||
          mutes.isPending ||
          (showDrives && driveMutes.mutes.isPending) ||
          !group ? (
          <LoadingIndicator />
        ) : (
          <Accordion type="multiple">
            <View className="gap-4">
              {showDrives ? (
                <AccordionItem value="drives" className="rounded-3xl bg-card px-5">
                  <AccordionTrigger className="items-center">
                    <View className="flex-1 flex-row items-center gap-4">
                      <View className="size-12 items-center justify-center rounded-xl bg-secondary">
                        <Icon as={CarIcon} size={24} className="text-primary" />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-foreground text-lg font-semibold" numberOfLines={1}>
                          Drive alerts
                        </Text>
                        <Text className="text-tertiary text-base">{driveState.summary}</Text>
                      </View>
                    </View>
                  </AccordionTrigger>
                  <AccordionContent className="pb-1">
                    <View className="flex-row items-center gap-4 border-t border-border py-4">
                      <View className="flex-1 gap-0.5">
                        <Text className="text-foreground text-base font-semibold">
                          Mute everyone
                        </Text>
                        <Text className="text-tertiary text-sm">
                          Includes people who join later
                        </Text>
                      </View>
                      <Switch
                        accessibilityLabel="Mute everyone’s Drive alerts"
                        value={driveState.everyoneMuted}
                        onValueChange={(muted) => driveMutes.setMute({ mutedUserId: null, muted })}
                      />
                    </View>
                    {driveState.members.map((member) => {
                      const name = nameOf(member.userId);
                      return (
                        <View
                          key={member.userId}
                          className="flex-row items-center gap-4 border-t border-border py-3"
                        >
                          <View className="size-10 items-center justify-center rounded-full bg-primary">
                            <Text className="font-bold text-white">{initials(name)}</Text>
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-foreground text-lg" numberOfLines={1}>
                              {name}
                            </Text>
                            <Text className="text-tertiary text-sm">
                              {member.sendsAlerts
                                ? member.alertsOn
                                  ? "Alerts on"
                                  : "Alerts off"
                                : `Drive alerts are off. ${name} doesn’t send them to ${group.name}.`}
                            </Text>
                          </View>
                          <Switch
                            accessibilityLabel={`Drive alerts for ${name}`}
                            disabled={driveState.everyoneMuted || !member.sendsAlerts}
                            value={member.alertsOn}
                            onValueChange={(alertsOn) =>
                              driveMutes.setMute({ mutedUserId: member.userId, muted: !alertsOn })
                            }
                          />
                        </View>
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              ) : null}
              {places.data.length === 0 ? (
                <Text className="text-tertiary">This group has no places yet.</Text>
              ) : null}
              {places.data.map((place) => {
                const state = placeMuteState({
                  memberUserIds,
                  mutes: mutes.data.mutes,
                  placeId: place.id,
                });
                return (
                  <AccordionItem
                    key={place.id}
                    value={place.id}
                    className="rounded-3xl bg-card px-5"
                  >
                    <AccordionTrigger className="items-center">
                      <View className="flex-1 flex-row items-center gap-4">
                        <View className="size-12 items-center justify-center rounded-xl bg-secondary">
                          <Text className="text-2xl">{place.emoji}</Text>
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-foreground text-lg font-semibold" numberOfLines={1}>
                            {place.name}
                          </Text>
                          <Text className="text-tertiary text-base">{state.summary}</Text>
                        </View>
                      </View>
                    </AccordionTrigger>
                    <AccordionContent className="pb-1">
                      <View className="flex-row items-center gap-4 border-t border-border py-4">
                        <View className="flex-1 gap-0.5">
                          <Text className="text-foreground text-base font-semibold">
                            Mute everyone here
                          </Text>
                          <Text className="text-tertiary text-sm">
                            Includes people who join later
                          </Text>
                        </View>
                        <Switch
                          accessibilityLabel={`Mute everyone at ${place.name}`}
                          value={state.everyoneMuted}
                          onValueChange={(muted) =>
                            setMute({ placeId: place.id, mutedUserId: null, muted })
                          }
                        />
                      </View>
                      {state.members.map((member) => {
                        const name = memberName(member.userId) ?? "Someone";
                        return (
                          <View
                            key={member.userId}
                            className="flex-row items-center gap-4 border-t border-border py-3"
                          >
                            <View className="size-10 items-center justify-center rounded-full bg-primary">
                              <Text className="font-bold text-white">{initials(name)}</Text>
                            </View>
                            <Text className="text-foreground flex-1 text-lg" numberOfLines={1}>
                              {name}
                            </Text>
                            <Text className="text-tertiary w-20 text-right text-sm">
                              {member.alertsOn ? "Alerts on" : "Alerts off"}
                            </Text>
                            <Switch
                              accessibilityLabel={`Alerts for ${name} at ${place.name}`}
                              disabled={state.everyoneMuted}
                              value={member.alertsOn}
                              onValueChange={(alertsOn) =>
                                setMute({
                                  placeId: place.id,
                                  mutedUserId: member.userId,
                                  muted: !alertsOn,
                                })
                              }
                            />
                          </View>
                        );
                      })}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </View>
          </Accordion>
        )}
      </ScrollView>
    </View>
  );
};

export default PlaceAlertsScreen;
