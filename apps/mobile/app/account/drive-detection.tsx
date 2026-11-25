import { isSharingPaused } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import {
  CarIcon,
  FlaskConicalIcon,
  InfoIcon,
  ServerIcon,
  SirenIcon,
  UsersIcon,
} from "lucide-react-native";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import {
  joinGroupNames,
  localEmergencyNumber,
  openPhoneSafetySettings,
  setCrashAlerts,
  tryCrashCountdown,
  useCrashAlerts,
} from "../../lib/crashAlerts.ts";
import { setDriveDetection, useDriveDetection } from "../../lib/driveDetection.ts";
import { setTellGroup, useQuietDriveGroups } from "../../lib/driveSettings.ts";
import { hasLocallyPausedSharing, serverNow } from "../../lib/locationSharing.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { getPushStatus } from "../../lib/tracking.ts";

const DriveDetectionScreen = () => {
  const on = useDriveDetection();
  const crashAlerts = useCrashAlerts();
  const quietGroups = useQuietDriveGroups();
  const { data: session } = authClient.useSession();
  const change = (next: boolean) => void setDriveDetection(next, session?.user.id);
  const groups = useQuery(trpc.groupMembership.list.queryOptions());
  const sharing = useQuery(trpc.account.locationSharing.queryOptions());
  const push = useQuery({
    queryKey: ["pushStatus"],
    queryFn: getPushStatus,
    enabled: Platform.OS === "android",
    gcTime: 0,
    retry: false,
    networkMode: "always",
  });
  const now = serverNow();
  const paused =
    (session?.user.id ? hasLocallyPausedSharing(session.user.id) : false) ||
    (sharing.data
      ? isSharingPaused(sharing.data.account, now) ||
        (sharing.data.device ? isSharingPaused(sharing.data.device, now) : false)
      : false);
  const slowServer = push.data ? push.data.serverPush === false || !push.data.builtIn : false;
  const groupNames = joinGroupNames((groups.data ?? []).map((group) => group.name));
  const noun = thisDeviceNoun();
  const emergencyNumber = localEmergencyNumber();
  const crashOn = on && crashAlerts;
  const changeCrashAlerts = (next: boolean) => void setCrashAlerts(next);
  const crashSubtitle = !on
    ? "Needs Drive detection"
    : !crashAlerts
      ? `Off on this ${noun}. Your groups see that Crash alerts are off.`
      : paused
        ? "Location sharing is paused, so no Crash alert would be sent. Resume sharing to turn them back on."
        : `If this ${noun} suspects a crash during a drive and nobody taps I’m OK within 60 s, ${groupNames} get a Crash alert with the time, place and speed.`;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Drive detection" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-secondary px-4 text-[15px] leading-5">
          {`When this ${noun} is in a moving vehicle, OpenBeacon records the drive: when and where it started and ended, how far it went and how fast. Your drives are end-to-end encrypted and shared with your groups, like your location history.`}
        </Text>
        <ListSection
          footer={`While a drive is being recorded, the sharing notice says “Recording a drive”. Bus, train and taxi rides can be recorded too. When this is off, this ${noun} records no drives and your groups see that Drive detection is off.`}
        >
          <ListRow
            title="Drive detection"
            icon={CarIcon}
            iconColor="teal"
            subtitle={on ? `On for this ${noun}.` : `Off for this ${noun}.`}
            accessibilityRole="switch"
            accessibilityState={{ checked: on }}
            onPress={() => change(!on)}
            trailing={
              <Switch accessibilityLabel="Drive detection" value={on} onValueChange={change} />
            }
          />
          <ListRow
            title="Crash alerts"
            icon={SirenIcon}
            iconColor="red"
            subtitle={crashSubtitle}
            disabled={!on}
            accessibilityRole="switch"
            accessibilityState={{ checked: crashOn }}
            onPress={on ? () => changeCrashAlerts(!crashAlerts) : undefined}
            trailing={
              <Switch
                accessibilityLabel="Crash alerts"
                value={crashOn}
                disabled={!on}
                onValueChange={changeCrashAlerts}
              />
            }
          />
        </ListSection>

        {groups.data && groups.data.length > 0 ? (
          <ListSection
            title="Tell these groups when I finish a drive"
            footer={`A Drive alert gives the distance, time and top speed of a drive you just finished. It never includes your score or Driving events. ${
              quietGroups.length > 0
                ? `Members of ${joinGroupNames(
                    groups.data
                      .filter((group) => quietGroups.includes(group.id))
                      .map((group) => group.name),
                  )} see “Drive alerts are off”.`
                : "Groups you turn off see “Drive alerts are off”."
            }`}
          >
            {groups.data.map((group) => {
              const tells = !quietGroups.includes(group.id);
              return (
                <ListRow
                  key={group.id}
                  title={group.name}
                  icon={UsersIcon}
                  iconColor="teal"
                  subtitle={
                    tells
                      ? "Members get a Drive alert"
                      : "No Drive alerts. Your drives still show in their Timeline."
                  }
                  accessibilityRole="switch"
                  accessibilityState={{ checked: tells }}
                  onPress={() => void setTellGroup(group.id, !tells)}
                  trailing={
                    <Switch
                      accessibilityLabel={`Tell ${group.name} when I finish a drive`}
                      value={tells}
                      onValueChange={(next) => void setTellGroup(group.id, next)}
                    />
                  }
                />
              );
            })}
          </ListSection>
        ) : null}

        {slowServer && crashOn ? (
          <View className="gap-2 rounded-2xl border border-warning-border bg-warning p-4">
            <View className="flex-row gap-3">
              <Icon as={ServerIcon} size={20} className="mt-0.5 text-warning-text" />
              <Text className="flex-1 text-warning-text">
                {`Your server doesn’t send push notifications, so a Crash alert can take several minutes to reach others. Your ${noun} may have its own crash detection that can call ${emergencyNumber ?? "emergency services"} for you (Pixel Safety or iPhone Crash Detection).`}
              </Text>
            </View>
            {Platform.OS === "android" ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void openPhoneSafetySettings()}
                className="pl-8"
              >
                <Text className="font-semibold text-warning-text">Open phone safety settings</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View className="flex-row gap-3 rounded-2xl bg-card p-4">
          <Icon as={InfoIcon} size={20} className="mt-0.5 text-secondary" />
          <Text className="flex-1 text-secondary">
            {`Crash alerts may help, but they can miss a crash or go off when nothing happened. OpenBeacon never contacts emergency services. It doesn’t replace calling ${emergencyNumber ?? "your local emergency number"}.`}
          </Text>
        </View>

        {crashOn && Platform.OS === "android" ? (
          <View className="gap-2">
            <Button variant="secondary" onPress={() => void tryCrashCountdown()}>
              <Icon as={FlaskConicalIcon} size={18} />
              <Text>Try it</Text>
            </Button>
            <Text className="text-secondary text-center text-[13px]">
              {`Runs the countdown on this ${noun}. Nobody is alerted.`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default DriveDetectionScreen;
