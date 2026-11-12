import { useIsFocused } from "@react-navigation/native";
import { Alert } from "../../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import {
  BellIcon,
  CameraIcon,
  HelpCircleIcon,
  HistoryIcon,
  InfoIcon,
  KeyRoundIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  SmartphoneIcon,
  SunIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { SettingsContainer } from "../../../components/containers/settingsContainer.tsx";
import { LocationSharingCard } from "../../../components/LocationSharingCard.tsx";
import { ProfileImage } from "../../../components/image/ProfileImage.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/Card.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/Dialog.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Input } from "../../../components/ui/Input.tsx";
import { Separator } from "../../../components/ui/Separator.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useHeldHistoryKeyVersions } from "../../../hooks/useHeldHistoryKeyVersions.ts";
import { trpc } from "../../../lib/api.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { getStoredDeviceId } from "../../../lib/deviceKeys.ts";
import { historyLossRisk } from "../../../lib/historyLossRisk.ts";
import {
  getLocationPermissionWarningDescription,
  getLocationPermissionWarningTitle,
} from "../../../lib/locationPermissions.ts";
import { dismissRestoreCard, isRestoreCardDismissed } from "../../../lib/restoreReminders.ts";
import { storage } from "../../../lib/storage.ts";
import { useLocationPermissions } from "../../../providers/LocationPermissionProvider.tsx";

const categories = [
  {
    label: "Account",
    settings: [
      {
        label: "Notifications",
        icon: BellIcon,
        href: "/account/notifications",
        requiresEmailOnIos: true,
      },
      {
        label: "Devices",
        icon: SmartphoneIcon,
        href: "/account/devices",
      },
      {
        label: "Password and Security",
        icon: LockIcon,
        href: "/account/password",
      },
      {
        label: "Recovery phrase",
        icon: KeyRoundIcon,
        href: "/account/recovery",
      },
      {
        label: "Delete account",
        icon: Trash2Icon,
        href: "/account/delete",
      },
    ],
  },
  {
    label: "Preferences",
    settings: [
      {
        label: "Theme",
        icon: SunIcon,
        href: "/account/theme",
      },
    ],
  },
  {
    label: "Support",
    settings: [
      {
        label: "Help Center",
        icon: HelpCircleIcon,
      },
      {
        label: "Contact Us",
        icon: MailIcon,
        href: "/account/contact-us",
      },
      {
        label: "About",
        icon: InfoIcon,
        href: "/account/about",
      },
    ],
  },
];

const schema = z.object({ name: accountNameSchema });

const PromptCard = ({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  tone: "primary" | "warning";
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-start gap-3">
      <View
        className={`size-10 items-center justify-center rounded-full ${tone === "warning" ? "bg-warning-accent/15" : "bg-primary/10"}`}
      >
        <Icon
          as={icon}
          className={`size-5 ${tone === "warning" ? "text-warning-accent" : "text-primary"}`}
        />
      </View>
      <View className="flex-1 gap-1.5">
        <CardTitle>
          <Text>{title}</Text>
        </CardTitle>
        <CardDescription>
          <Text className="text-muted-foreground">{description}</Text>
        </CardDescription>
      </View>
    </CardHeader>
    <CardContent className="flex flex-row gap-3">{children}</CardContent>
  </Card>
);

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
  const groups = useQuery({ ...trpc.groupMembership.list.queryOptions(), subscribed: isFocused });
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
  const devices = useQuery({ ...trpc.account.listDevices.queryOptions(), subscribed: isFocused });
  const { openLocationPermissionSettings, permissionState } = useLocationPermissions();
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
      Alert.alert("Unable to update name", result.error.message);
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
    const { status } = await signOutOfThisPhone({
      onSigningOut: () => setSignOutPhase("signingOut"),
      removeThisPhone,
      sessionTokenToRevoke: session?.session?.token ?? null,
    });
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
        { text: "Sign out", onPress: () => signOut({ removeThisPhone: false }) },
        {
          text: "Also remove this phone from your account",
          style: "destructive",
          onPress: confirmRemoveThisPhone,
        },
      ],
    );

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView
        edges={["top"]}
        className="flex flex-row justify-center border-b border-border bg-background py-4"
      >
        <Text className="text-foreground text-2xl font-bold">Account</Text>
      </SafeAreaView>

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
        contentContainerClassName="px-6 gap-4 my-4 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <View className="overflow-hidden rounded-lg border border-border bg-card">
          <View className="relative">
            <View className="flex flex-row justify-end p-3 bg-primary w-full h-20">
              <View className="size-8 flex items-center justify-center rounded-full bg-black/15">
                <Icon as={CameraIcon} className="text-white size-5" />
              </View>
            </View>
            <View className="absolute left-4 -bottom-12 z-10">
              <ProfileImage imageUrl={session?.user?.image ?? null} />
            </View>
          </View>
          <View className="flex flex-col px-4 pb-4 pt-14">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-foreground font-semibold text-2xl">{session?.user.name}</Text>
                <Text className="text-muted-foreground text-base">{session?.user.email}</Text>
              </View>
              <Button
                variant="outline"
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

            <Separator className="my-4" />
            <View className="flex flex-row items-center gap-6">
              <View className="flex flex-col items-center">
                <Text className="text-foreground font-bold text-xl">
                  {groups.isError ? "—" : (groups.data?.length ?? "—")}
                </Text>
                <Text className="text-muted-foreground text-base font-medium">Groups</Text>
              </View>

              <Separator className="my-4" orientation="vertical" />

              <Link href="/account/devices" asChild>
                <Pressable accessibilityRole="link" className="flex flex-col items-center">
                  <Text className="text-foreground font-bold text-xl">
                    {devices.isError ? "—" : (devices.data?.length ?? "—")}
                  </Text>
                  <Text className="text-muted-foreground text-base font-medium">Devices</Text>
                </Pressable>
              </Link>
            </View>
          </View>
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
              variant="outline"
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
              variant="outline"
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
          categories={categories.map((category) => ({
            ...category,
            settings: category.settings.map((setting) =>
              "requiresEmailOnIos" in setting && Platform.OS !== "android" && !providers?.email
                ? { label: setting.label, icon: setting.icon }
                : setting,
            ),
          }))}
        />

        <View className="mb-28 gap-3">
          {signOutPhase && (
            <Text accessibilityLiveRegion="polite" className="text-muted">
              {signOutPhase === "uploading"
                ? "Uploading saved locations before signing out. This may take up to 10 seconds; any remaining locations will be saved for your next sign-in."
                : "Contacting the server to sign out."}
            </Text>
          )}
          <Button onPress={confirmSignOut} disabled={!!signOutPhase}>
            <Text>{signOutPhase ? "Signing out…" : "Sign out"}</Text>
          </Button>
        </View>
      </ScrollView>
    </View>
  );
};

export default AccountScreen;
