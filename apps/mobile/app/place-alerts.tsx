import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../components/LoadingIndicator.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/Accordion.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Switch } from "../components/ui/Switch.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useCachedGroup } from "../hooks/useCachedGroup.ts";
import { useMemberNames } from "../hooks/useMemberNames.ts";
import { usePlaceAlertMutes } from "../hooks/usePlaceAlertMutes.ts";
import { authClient } from "../lib/auth-client.ts";
import { initials } from "../lib/initials.ts";
import { placeMuteState } from "../lib/placeAlertMutes.ts";
import { groupPlacesQueryOptions } from "../lib/placeSync.ts";

const PlaceAlertsScreen = () => {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const { group } = useCachedGroup(groupId);
  const places = useQuery({ ...groupPlacesQueryOptions(groupId, userId), subscribed: isFocused });
  const memberName = useMemberNames(groupId);
  const { mutes, setMute } = usePlaceAlertMutes(groupId);
  const memberUserIds = (group?.members ?? [])
    .map((member) => member.userId)
    .filter((memberUserId) => memberUserId !== userId);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Alerts" subtitle={group?.name} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-tertiary text-base leading-6">
          Choose whose arrivals and departures you hear about. This only changes your alerts.
          Everyone else still gets theirs.
        </Text>

        {places.isError || mutes.isError ? (
          <View className="gap-3">
            <Text>Couldn’t load your alerts. Check your connection and try again.</Text>
            <Button
              variant="secondary"
              onPress={() => {
                void places.refetch();
                void mutes.refetch();
              }}
            >
              <Text>Try again</Text>
            </Button>
          </View>
        ) : places.isPending || mutes.isPending || !group ? (
          <LoadingIndicator />
        ) : places.data.length === 0 ? (
          <Text className="text-tertiary">This group has no places yet.</Text>
        ) : (
          <Accordion type="multiple">
            <View className="gap-4">
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
                    className="rounded-3xl border border-border bg-card px-5"
                  >
                    <AccordionTrigger className="items-center">
                      <View className="flex-1 flex-row items-center gap-4">
                        <View className="size-12 items-center justify-center rounded-xl bg-primary/10">
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
