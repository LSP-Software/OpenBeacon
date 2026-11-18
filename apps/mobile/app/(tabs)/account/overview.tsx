import { useIsFocused } from "@react-navigation/native";
import { Alert } from "../../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import {
  BellIcon,
  BellOffIcon,
  BookOpenIcon,
  EyeIcon,
  HistoryIcon,
  InfoIcon,
  KeyRoundIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  MapIcon,
  MapPinIcon,
  ScanFaceIcon,
  SmartphoneIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { AnnouncementBanner } from "../../../components/AnnouncementBanner.tsx";
import { SettingsContainer } from "../../../components/containers/settingsContainer.tsx";
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
import { Input } from "../../../components/ui/Input.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useHeldHistoryKeyVersions } from "../../../hooks/useHeldHistoryKeyVersions.ts";
import { useHistoryShare } from "../../../hooks/useHistoryShare.ts";
import { trpc } from "../../../lib/api.ts";
import { useAppLock } from "../../../lib/appLock.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { getStoredDeviceId } from "../../../lib/deviceKeys.ts";
import { historyLossRisk } from "../../../lib/historyLossRisk.ts";
import { historyShareLabel } from "../../../lib/historyShare.ts";
import {
  getLocationPermissionWarningDescription,
  getLocationPermissionWarningTitle,
} from "../../../lib/locationPermissions.ts";
import { formatMapCacheSize, getMapCacheSizeMb } from "../../../lib/mapCache.ts";
import { useNotificationSettings } from "../../../lib/notifications.ts";
import { dismissRestoreCard, isRestoreCardDismissed } from "../../../lib/restoreReminders.ts";
import { storage } from "../../../lib/storage.ts";
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
  const historyShare = useHistoryShare();
  const { appThemePreference } = useTheme();
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
      Alert.alert("Unable to update name", userMessage(result.error));
      return;
    }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
    ]);
    setNameOpen(false);
    Alert.alert("Profile updated", "Your name has been saved.");
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
        "This phone may not have been removed. Try again, or sign out without removing this phone.",
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
        "This phone is still in Devices",
        "You’ve been signed out, but we couldn’t remove this phone. Remove it from another device in Account → Devices.",
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
      void signOut({ removeThisPhone: true });
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
      "This phone stays in Account → Devices, so you can sign in on it again. If you’re giving it away or won’t use it again, remove it too.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Also remove this phone from your account",
          style: "destructive",
          onPress: confirmRemoveThisPhone,
        },
        { text: "Sign out", onPress: () => signOut({ removeThisPhone: false }) },
      ],
    );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
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
        contentContainerClassName="gap-3 px-4 pb-40"
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          className="text-foreground px-1 pb-1 pt-3 text-3xl font-bold"
        >
          Account
        </Text>
        <AnnouncementBanner />
        <View className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4">
          <ProfileImage imageUrl={session?.user?.image ?? null} />
          <View className="flex-1">
            <Text className="text-foreground text-xl font-bold" numberOfLines={1}>
              {session?.user.name}
            </Text>
            <Text className="text-secondary text-sm" numberOfLines={1}>
              {session?.user.email}
            </Text>
          </View>
          <Button
            variant="secondary"
            size="sm"
            accessibilityLabel="Edit name"
            onPress={() => {
              form.reset({ name: session?.user.name ?? "" });
              setNameOpen(true);
            }}
          >
            <Text>Edit name</Text>
          </Button>
        </View>
        <LocationSharingCard />
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
            description="This phone can’t show that it’s sharing your location, or tell you if sharing stops."
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
            title="Protect your location history"
            description="Create a recovery phrase so you can read your history on a new phone."
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
                : "Enter your recovery phrase to read your location history on this phone."
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

        <View className="pt-3">
          <SettingsContainer
            categories={[
              {
                label: "Privacy",
                settings: [
                  { label: "Who can see me", icon: EyeIcon, href: "/account/who-can-see-me" },
                  {
                    label: "Location history",
                    icon: HistoryIcon,
                    href: "/account/location-history",
                    value: historyShare.setting
                      ? historyShareLabel(historyShare.setting.account)
                      : undefined,
                  },
                ],
              },
              {
                label: "Account and security",
                settings: [
                  { label: "Notifications", icon: BellIcon, href: "/account/notifications" },
                  {
                    label: "Devices",
                    icon: SmartphoneIcon,
                    href: "/account/devices",
                    value: devices.data ? String(devices.data.length) : undefined,
                  },
                  { label: "Password and security", icon: LockIcon, href: "/account/password" },
                  {
                    label: "App lock",
                    icon: ScanFaceIcon,
                    href: "/account/app-lock",
                    value: appLock.enabled ? "On" : "Off",
                  },
                  {
                    label: "Recovery phrase",
                    icon: KeyRoundIcon,
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
                label: "App",
                settings: [
                  {
                    label: "Theme",
                    icon: SunIcon,
                    href: "/account/theme",
                    value: { system: "Match phone", light: "Light", dark: "Dark" }[
                      appThemePreference
                    ],
                  },
                  {
                    label: "Map storage",
                    icon: MapIcon,
                    href: "/account/map-storage",
                    value: formatMapCacheSize(getMapCacheSizeMb()),
                  },
                ],
              },
              {
                label: "Help",
                settings: [
                  { label: "Help centre", icon: BookOpenIcon, href: "https://docs.openbeacon.net" },
                  { label: "Contact us", icon: MailIcon, href: "/account/contact-us" },
                  { label: "About", icon: InfoIcon, href: "/account/about", value: appVersion },
                ],
              },
              {
                settings: [
                  {
                    label: signOutPhase ? "Signing out…" : "Sign out",
                    icon: LogOutIcon,
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
        </View>
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
