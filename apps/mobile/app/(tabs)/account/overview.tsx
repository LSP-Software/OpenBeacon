import { useIsFocused } from "@react-navigation/native";
import { Alert } from "../../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import {
  BatteryMediumIcon,
  BellIcon,
  BellOffIcon,
  BookOpenIcon,
  ChevronRightIcon,
  EyeIcon,
  GaugeIcon,
  NavigationIcon,
  HistoryIcon,
  InfoIcon,
  KeyRoundIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  ScanFaceIcon,
  SmartphoneIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { AnnouncementBanner } from "../../../components/AnnouncementBanner.tsx";
import { SettingsContainer } from "../../../components/containers/settingsContainer.tsx";
import { TabHeader, tabScreenEdges } from "../../../components/headers/TabHeader.tsx";
import { LocationSharingCard } from "../../../components/LocationSharingCard.tsx";
import { ProfileImage } from "../../../components/image/ProfileImage.tsx";
import { PromptCard } from "../../../components/PromptCard.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/Dialog.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Input } from "../../../components/ui/Input.tsx";
import { ListRow } from "../../../components/ui/List.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useHeldHistoryKeyVersions } from "../../../hooks/useHeldHistoryKeyVersions.ts";
import { useHistoryShare } from "../../../hooks/useHistoryShare.ts";
import { useUnits } from "../../../hooks/useUnits.ts";
import {
  directionsAppKey,
  directionsAppName,
  parseDirectionsApp,
} from "../../../lib/directions.ts";
import { trpc } from "../../../lib/api.ts";
import { useAppLock } from "../../../lib/appLock.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { getStoredDeviceId } from "../../../lib/deviceKeys.ts";
import { historyLossRisk } from "../../../lib/historyLossRisk.ts";
import { historyShareLabel } from "../../../lib/historyShare.ts";
import { removePhoneRecoveryPrompt } from "../../../lib/keyRemovalWarnings.ts";
import { useLowPowerMode } from "../../../lib/lowPowerMode.ts";
import {
  getLocationPermissionWarningDescription,
  getLocationPermissionWarningTitle,
} from "../../../lib/locationPermissions.ts";
import { useNotificationSettings } from "../../../lib/notifications.ts";
import { dismissRestoreCard, isRestoreCardDismissed } from "../../../lib/restoreReminders.ts";
import { storage } from "../../../lib/storage.ts";
import { useMMKVString } from "react-native-mmkv";
import { thisDeviceNoun } from "../../../lib/thisDeviceNoun.ts";
import { appVersion } from "../../../lib/versions.ts";
import { useLocationPermissions } from "../../../providers/LocationPermissionProvider.tsx";
import { useTheme } from "../../../providers/ThemeProvider.tsx";
import { userMessage } from "../../../lib/userMessage.ts";

const schema = z.object({ name: accountNameSchema });

const AccountScreen = () => {
  const { data: session, refetch } = authClient.useSession();
  const queryClient = useQueryClient();
  const updateName = useMutation(trpc.account.updateName.mutationOptions());
  const [nameOpen, setNameOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });
  const isFocused = useIsFocused();
  const devices = useQuery({ ...trpc.account.listDevices.queryOptions(), subscribed: isFocused });
  const { openLocationPermissionSettings, permissionState } = useLocationPermissions();
  const notifications = useNotificationSettings();
  const appLock = useAppLock();
  const lowPowerMode = useLowPowerMode();
  const historyShare = useHistoryShare();
  const { appThemePreference } = useTheme();
  const units = useUnits();
  const [storedDirectionsApp] = useMMKVString(directionsAppKey, storage);
  const directionsApp = parseDirectionsApp(storedDirectionsApp);
  const unitsLabel = `${units.distance === "mi" ? "Miles" : "Kilometres"}, ${units.speed === "mph" ? "mph" : "km/h"}`;
  const [signOutPhase, setSignOutPhase] = useState<"uploading" | "signingOut" | null>(null);
  const signingOut = useRef(false);
  const recoveryStatus = useQuery({
    ...trpc.accountRecovery.status.queryOptions(),
    subscribed: isFocused,
  });
  const recoveryPromptKey = `recovery.promptDismissed.${session?.user.id}`;
  const [recoveryPromptDismissed, setRecoveryPromptDismissed] = useState(false);
  const showRecoveryPrompt =
    !!session?.user.id &&
    recoveryStatus.data?.recoveryKey === null &&
    !recoveryPromptDismissed &&
    storage.getBoolean(recoveryPromptKey) !== true;
  const currentHistoryKeyVersion = recoveryStatus.data?.currentHistoryKey?.version ?? 0;
  const heldHistoryKeyVersions = useHeldHistoryKeyVersions(
    session?.user.id,
    recoveryStatus.data?.currentHistoryKey ?? undefined,
  );
  const [restoreBannerDismissed, setRestoreBannerDismissed] = useState(false);
  const showRestoreBanner =
    !!session?.user.id &&
    !!recoveryStatus.data?.recoveryKey &&
    !!heldHistoryKeyVersions.data &&
    !heldHistoryKeyVersions.data.includes(currentHistoryKeyVersion) &&
    !restoreBannerDismissed &&
    !isRestoreCardDismissed({ userId: session.user.id, version: currentHistoryKeyVersion });

  const saveName = async ({ name }: z.infer<typeof schema>) => {
    const result = await tryCatch(updateName.mutateAsync({ name }));
    if (result.error) {
      Alert.alert("Couldn’t update name", userMessage(result.error));
      return;
    }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
    ]);
    setNameOpen(false);
  };

  const signOut = async ({ removeThisPhone }: { removeThisPhone: boolean }) => {
    if (signingOut.current) return;
    signingOut.current = true;
    setSignOutPhase("uploading");
    const { signOutOfThisPhone } = await import("../../../lib/signOut.ts");
    const result = await tryCatch(
      signOutOfThisPhone({
        onSigningOut: () => setSignOutPhase("signingOut"),
        removeThisPhone,
        sessionTokenToRevoke: session?.session?.token ?? null,
      }),
    );
    const status = result.data?.status;
    signingOut.current = false;
    setSignOutPhase(null);
    if (status === "serverUnreachable") {
      Alert.alert(
        "Couldn’t reach the server",
        `This ${thisDeviceNoun()} may not have been removed. Try again, or sign out without removing this ${thisDeviceNoun()}.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out without removing", onPress: () => signOut({ removeThisPhone: false }) },
          { text: "Try again", onPress: () => signOut({ removeThisPhone: true }) },
        ],
      );
      return;
    }
    if (removeThisPhone && status === "signedOut") {
      Alert.alert(
        `This ${thisDeviceNoun()} is still in Devices`,
        `You’ve been signed out, but we couldn’t remove this ${thisDeviceNoun()}. Remove it from another device in Account → Devices.`,
      );
    }
    router.replace("/");
  };

  const confirmRemoveThisPhone = () => {
    const risk = historyLossRisk({
      devices: devices.data,
      heldVersions: heldHistoryKeyVersions.data,
      recoveryStatus: recoveryStatus.data,
      thisDeviceId: session?.user.id ? getStoredDeviceId(session.user.id) : undefined,
    });
    if (risk === "none") {
      const prompt = removePhoneRecoveryPrompt({
        noun: thisDeviceNoun(),
        recoveryStatus: recoveryStatus.data,
      });
      if (!prompt) {
        void signOut({ removeThisPhone: true });
        return;
      }
      Alert.alert(prompt.title, prompt.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Set up recovery phrase", onPress: () => router.push("/account/recovery-setup") },
        {
          text: "Remove anyway",
          style: "destructive",
          onPress: () => signOut({ removeThisPhone: true }),
        },
      ]);
      return;
    }
    Alert.alert(
      risk === "possible"
        ? "Your location history might be lost"
        : "Your location history will be lost",
      risk === "possible"
        ? "We couldn’t check whether another phone or a recovery phrase can read your location history. If this is the only phone with it, removing it means your history can’t be recovered."
        : "This is the only phone with your location history and you haven’t set up a recovery phrase. If you remove it, your history can’t be recovered. Set up a recovery phrase first.",
      [
        { text: "Cancel", style: "cancel" },
        ...(recoveryStatus.data
          ? [
              {
                text: "Set up recovery phrase",
                onPress: () => router.push("/account/recovery-setup"),
              },
            ]
          : []),
        {
          text: risk === "possible" ? "Remove anyway" : "Remove and lose history",
          style: "destructive",
          onPress: () => signOut({ removeThisPhone: true }),
        },
      ],
    );
  };

  const confirmSignOut = () =>
    Alert.alert(
      "Sign out?",
      `Signing out keeps this ${thisDeviceNoun()} in Account → Devices and keeps your keys on it, so you can sign in again and carry on. If you’re giving it away or won’t use it again, remove it too. That deletes your keys from it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Also remove this ${thisDeviceNoun()} from your account`,
          style: "destructive",
          onPress: confirmRemoveThisPhone,
        },
        { text: "Sign out", onPress: () => signOut({ removeThisPhone: false }) },
      ],
    );

  const editName = () => {
    form.reset({ name: session?.user.name ?? "" });
    setNameOpen(true);
  };

  return (
    <SafeAreaView edges={tabScreenEdges} className="flex-1 bg-background">
      <Dialog
        open={nameOpen}
        onOpenChange={(open) => {
          setNameOpen(open);
          if (!open) form.reset({ name: session?.user.name ?? "" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change name</DialogTitle>
          </DialogHeader>
          <Input
            control={form.control}
            name="name"
            label="Name"
            autoCapitalize="words"
            autoComplete="name"
          />
          <Button onPress={form.handleSubmit(saveName)} loading={updateName.isPending}>
            <Text>Save name</Text>
          </Button>
        </DialogContent>
      </Dialog>

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <TabHeader title="Account" />
        <AnnouncementBanner />
        <View
          className={
            Platform.OS === "ios"
              ? "flex-row items-center gap-4 rounded-[26px] bg-card p-4"
              : "flex-row items-center gap-4 rounded-[28px] bg-primary-soft p-5"
          }
        >
          <ProfileImage imageUrl={session?.user?.image ?? null} />
          <Pressable
            className="min-w-0 flex-1 flex-row items-center gap-2"
            accessibilityRole="button"
            accessibilityLabel={`Edit name, ${session?.user.name ?? ""}`}
            onPress={editName}
          >
            <View className="min-w-0 flex-1">
              <Text
                className={
                  Platform.OS === "ios"
                    ? "text-foreground text-[22px] font-semibold"
                    : "text-[22px] text-primary-soft-foreground"
                }
                numberOfLines={1}
              >
                {session?.user.name}
              </Text>
              <Text
                className={
                  Platform.OS === "ios"
                    ? "text-secondary text-[15px]"
                    : "text-sm text-primary-soft-foreground"
                }
                numberOfLines={1}
              >
                {session?.user.email}
              </Text>
            </View>
            {Platform.OS === "ios" ? (
              <Icon as={ChevronRightIcon} size={20} className="text-border-strong" />
            ) : null}
          </Pressable>
          {Platform.OS === "ios" ? null : (
            <Button size="sm" accessibilityLabel="Edit name" onPress={editName}>
              <Icon as={PencilIcon} size={16} className="text-white" />
              <Text>Edit</Text>
            </Button>
          )}
        </View>
        <LocationSharingCard>
          <ListRow
            title="Who can see me"
            icon={EyeIcon}
            iconColor="blue"
            href="/account/who-can-see-me"
          />
          <ListRow
            title="Location history"
            icon={HistoryIcon}
            iconColor="indigo"
            href="/account/location-history"
            value={
              historyShare.setting ? historyShareLabel(historyShare.setting.account) : undefined
            }
          />
          <ListRow
            title="Save battery while moving"
            icon={BatteryMediumIcon}
            iconColor="green"
            href="/account/save-battery"
            value={lowPowerMode ? "On" : "Off"}
          />
        </LocationSharingCard>
        {permissionState?.shouldShowAccountWarning && (
          <PromptCard
            icon={MapPinIcon}
            tone="warning"
            title={getLocationPermissionWarningTitle(permissionState)}
            description={getLocationPermissionWarningDescription(permissionState)}
          >
            <Button size="sm" onPress={openLocationPermissionSettings}>
              <Text>Grant permissions</Text>
            </Button>
          </PromptCard>
        )}

        {notifications.enabled === false && (
          <PromptCard
            icon={BellOffIcon}
            tone="warning"
            title="Notifications are off"
            description={`This ${thisDeviceNoun()} can’t show that it’s sharing your location, or tell you if sharing stops.`}
          >
            <Button size="sm" onPress={notifications.turnOn} loading={notifications.turningOn}>
              <Text>Turn on notifications</Text>
            </Button>
          </PromptCard>
        )}
        {showRecoveryPrompt && (
          <PromptCard
            icon={KeyRoundIcon}
            tone="primary"
            title="Create recovery phrase"
            description="So you can read your location history on a new phone."
          >
            <Link href="/account/recovery-setup" asChild>
              <Button size="sm">
                <Text>Create phrase</Text>
              </Button>
            </Link>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                storage.set(recoveryPromptKey, true);
                setRecoveryPromptDismissed(true);
              }}
            >
              <Text>Dismiss</Text>
            </Button>
          </PromptCard>
        )}

        {showRestoreBanner && (
          <PromptCard
            icon={HistoryIcon}
            tone="primary"
            title="Restore your history"
            description={
              heldHistoryKeyVersions.data?.length
                ? "Your recovery phrase was reset on another phone. Enter the new phrase to keep reading new history here."
                : `Enter your recovery phrase to read your location history on this ${thisDeviceNoun()}.`
            }
          >
            <Link href="/account/recovery-restore" asChild>
              <Button size="sm">
                <Text>Restore</Text>
              </Button>
            </Link>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                if (session?.user.id) {
                  dismissRestoreCard({
                    userId: session.user.id,
                    version: currentHistoryKeyVersion,
                  });
                }
                setRestoreBannerDismissed(true);
              }}
            >
              <Text>Dismiss</Text>
            </Button>
          </PromptCard>
        )}

        <SettingsContainer
          categories={[
            {
              label: "Account",
              settings: [
                {
                  label: "Notifications",
                  icon: BellIcon,
                  color: "red",
                  href: "/account/notifications",
                },
                {
                  label: "Devices",
                  icon: SmartphoneIcon,
                  color: "gray",
                  href: "/account/devices",
                  value: devices.data ? String(devices.data.length) : undefined,
                },
                {
                  label: "Password and security",
                  icon: LockIcon,
                  color: "green",
                  href: "/account/password",
                },
                {
                  label: "App lock",
                  icon: ScanFaceIcon,
                  color: "teal",
                  href: "/account/app-lock",
                  value: appLock.enabled ? "On" : "Off",
                },
                {
                  label: "Recovery phrase",
                  icon: KeyRoundIcon,
                  color: "orange",
                  href: "/account/recovery",
                  value: recoveryStatus.data
                    ? recoveryStatus.data.recoveryKey
                      ? "Set up"
                      : "Not set up"
                    : undefined,
                },
              ],
            },
            {
              label: "Preferences",
              settings: [
                {
                  label: "Theme",
                  icon: SunIcon,
                  color: "purple",
                  href: "/account/theme",
                  value: { system: `Match ${thisDeviceNoun()}`, light: "Light", dark: "Dark" }[
                    appThemePreference
                  ],
                },
                {
                  label: "Units",
                  icon: GaugeIcon,
                  color: "blue",
                  href: "/account/units",
                  value:
                    units.speedPreference === "auto" && units.distancePreference === "auto"
                      ? `${unitsLabel} (${thisDeviceNoun()} region)`
                      : unitsLabel,
                },
                {
                  label: "Directions",
                  icon: NavigationIcon,
                  color: "green",
                  href: "/account/directions",
                  value: directionsApp ? directionsAppName(directionsApp) : "Ask me",
                },
              ],
            },
            {
              label: "Help",
              settings: [
                {
                  label: "Help centre",
                  icon: BookOpenIcon,
                  color: "blue",
                  href: "https://docs.openbeacon.net",
                },
                {
                  label: "Contact us",
                  icon: MailIcon,
                  color: "green",
                  href: "/account/contact-us",
                },
                {
                  label: "About",
                  icon: InfoIcon,
                  color: "gray",
                  href: "/account/about",
                  value: appVersion,
                },
              ],
            },
            {
              settings: [
                {
                  label: signOutPhase ? "Signing out…" : "Sign out",
                  icon: LogOutIcon,
                  color: "gray",
                  onPress: confirmSignOut,
                  disabled: !!signOutPhase,
                },
                {
                  label: "Delete account",
                  icon: Trash2Icon,
                  href: "/account/delete",
                  tone: "danger",
                },
              ],
            },
          ]}
        />
        {signOutPhase && (
          <Text accessibilityLiveRegion="polite" className="text-secondary px-1 text-sm">
            {signOutPhase === "uploading"
              ? "Uploading saved locations before signing out. This may take up to 10 seconds; any remaining locations will be saved for your next sign-in."
              : "Contacting the server to sign out."}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default AccountScreen;
