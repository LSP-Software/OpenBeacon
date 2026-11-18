import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { CheckIcon, CircleAlertIcon, MinusIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { OnboardingScreen } from "../../components/onboarding/OnboardingScreen.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { useAppLock } from "../../lib/appLock.ts";
import { cn } from "../../lib/cn.ts";
import { useNotificationSettings } from "../../lib/notifications.ts";
import { finishOnboarding } from "../../lib/onboarding.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { useLocationPermissions } from "../../providers/LocationPermissionProvider.tsx";

const OnboardingDoneScreen = () => {
  const noun = thisDeviceNoun();
  const notifications = useNotificationSettings();
  const { permissionState, openLocationPermissionSettings } = useLocationPermissions();
  const recovery = useQuery(trpc.accountRecovery.status.queryOptions());
  const appLock = useAppLock();

  const rows: {
    label: string;
    tone: "on" | "missing" | "off";
    value: string;
    href?: "/account/recovery-setup";
    action?: { onPress: () => void; accessibilityLabel: string; disabled?: boolean };
  }[] = [
    notifications.enabled === null
      ? { label: "Notifications", tone: "off", value: "Checking…" }
      : notifications.enabled
        ? { label: "Notifications", tone: "on", value: "On" }
        : {
            label: "Notifications",
            tone: "missing",
            value: "Turn on",
            action: {
              onPress: () => void notifications.turnOn(),
              accessibilityLabel: "Turn on notifications",
              disabled: notifications.turningOn,
            },
          },
    permissionState === null
      ? { label: "Location", tone: "off", value: "Checking…" }
      : permissionState.isReadyForSharing
        ? { label: "Location", tone: "on", value: "Always, precise" }
        : {
            label: "Location",
            tone: "missing",
            value: "Fix",
            action: {
              onPress: () => void openLocationPermissionSettings(),
              accessibilityLabel: "Fix location access",
            },
          },
    ...(recovery.data
      ? [
          recovery.data.recoveryKey
            ? { label: "Recovery phrase", tone: "on" as const, value: "Set up" }
            : {
                label: "Recovery phrase",
                tone: "missing" as const,
                value: "Create now",
                href: "/account/recovery-setup" as const,
              },
        ]
      : []),
    {
      label: "App lock",
      tone: appLock.enabled ? "on" : "off",
      value: appLock.enabled ? "On" : "Off",
    },
  ];

  return (
    <OnboardingScreen
      illustration={
        <View className="items-center py-8">
          <View className="size-24 items-center justify-center rounded-full bg-primary">
            <Icon as={CheckIcon} className="size-12 text-white" />
          </View>
        </View>
      }
      title="You’re all set"
      description={`This ${noun} is ready. Create a group or scan an invite from the Groups tab to start sharing.`}
      primary={{ label: "Go to the map", onPress: finishOnboarding }}
    >
      <View className="rounded-3xl border border-border bg-card px-4">
        {rows.map((row, index) => (
          <View
            key={row.label}
            className={cn(
              "flex-row items-center gap-3 py-3",
              index < rows.length - 1 && "border-b border-border/50",
            )}
          >
            <View
              className={cn(
                "size-7 items-center justify-center rounded-full",
                row.tone === "on" && "bg-primary/10",
                row.tone === "missing" && "bg-warning-accent/15",
                row.tone === "off" && "bg-secondary",
              )}
            >
              <Icon
                as={
                  row.tone === "on"
                    ? CheckIcon
                    : row.tone === "missing"
                      ? CircleAlertIcon
                      : MinusIcon
                }
                className={cn(
                  "size-4",
                  row.tone === "on" && "text-primary",
                  row.tone === "missing" && "text-warning-accent",
                  row.tone === "off" && "text-muted-foreground",
                )}
              />
            </View>
            <Text className="text-foreground flex-1 text-base font-medium">{row.label}</Text>
            {row.href ? (
              <Link
                href={row.href}
                accessibilityRole="link"
                accessibilityLabel={`Create ${row.label.toLowerCase()} now`}
                className="py-1"
              >
                <Text className="text-primary-text text-sm font-semibold">{row.value}</Text>
              </Link>
            ) : row.action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={row.action.accessibilityLabel}
                accessibilityState={{ disabled: row.action.disabled ?? false }}
                disabled={row.action.disabled ?? false}
                onPress={row.action.onPress}
                hitSlop={8}
                className="py-1"
              >
                <Text className="text-primary-text text-sm font-semibold">{row.value}</Text>
              </Pressable>
            ) : (
              <Text className="text-muted-foreground text-sm">{row.value}</Text>
            )}
          </View>
        ))}
      </View>
      <Text className="text-muted-foreground text-center text-sm">
        You can change any of these in Account.
      </Text>
    </OnboardingScreen>
  );
};

export default OnboardingDoneScreen;
