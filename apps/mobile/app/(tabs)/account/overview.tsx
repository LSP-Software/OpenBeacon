import { zodResolver } from "@hookform/resolvers/zod";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  AlertCircleIcon,
  BellIcon,
  CameraIcon,
  HelpCircleIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react-native";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { SettingsContainer } from "../../../components/containers/settingsContainer.tsx";
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
import { trpc } from "../../../lib/api.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../../../lib/auth-client.ts";
import {
  getLocationPermissionWarningDescription,
  getLocationPermissionWarningTitle,
} from "../../../lib/locationPermissions.ts";
import { useLocationPermissions } from "../../../providers/LocationPermissionProvider.tsx";

const categories = [
  {
    label: "Account",
    settings: [
      {
        label: "Notifications",
        icon: BellIcon,
      },
      {
        label: "Password and Security",
        icon: LockIcon,
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

const AccountScreen = () => {
  const { data: session, refetch } = authClient.useSession();
  const queryClient = useQueryClient();
  const updateName = useMutation(trpc.account.updateName.mutationOptions());
  const [nameOpen, setNameOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });
  const groups = useQuery(trpc.groupMembership.list.queryOptions());
  const devices = useQuery(trpc.auth.listMyDeviceKeys.queryOptions());
  const { openLocationPermissionSettings, permissionState } = useLocationPermissions();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const saveName = async ({ name }: z.infer<typeof schema>) => {
    const result = await tryCatch(updateName.mutateAsync({ name }));
    if (result.error) {
      Alert.alert("Unable to update name", result.error.message);
      return;
    }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.members.queryKey() }),
    ]);
    setNameOpen(false);
    Alert.alert("Profile updated", "Your name has been saved.");
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const sessionTokenToRevoke = session?.session?.token ?? null;

    const tracking = await import("../../../lib/tracking.ts");
    await tryCatch(tracking.prepareTrackingSignOut());
    const { error: signOutError } = await authClient.signOut();

    if (signOutError && sessionTokenToRevoke) {
      await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke));
    }

    setIsSigningOut(false);
    router.replace("/");
  };

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

              <View className="flex flex-col items-center">
                <Text className="text-foreground font-bold text-xl">
                  {devices.isError
                    ? "—"
                    : (devices.data?.filter((device) => !device.revokedAt).length ?? "—")}
                </Text>
                <Text className="text-muted-foreground text-base font-medium">Devices</Text>
              </View>
            </View>
          </View>
        </View>
        {permissionState?.shouldShowAccountWarning && (
          <Card variant="warning">
            <CardHeader className="flex flex-row items-start gap-2">
              <Icon as={AlertCircleIcon} className="text-warning-accent size-6" />
              <View>
                <CardTitle>
                  <Text className="text-primary-foreground">
                    {getLocationPermissionWarningTitle(permissionState)}
                  </Text>
                </CardTitle>
                <CardDescription>
                  <Text className="text-muted">
                    {getLocationPermissionWarningDescription(permissionState)}
                  </Text>
                </CardDescription>
              </View>
            </CardHeader>
            <CardContent>
              <Button size="sm" onPress={openLocationPermissionSettings}>
                <Icon as={MapPinIcon} className="size-5 text-white" />
                <Text>Grant Location Permissions</Text>
              </Button>
            </CardContent>
          </Card>
        )}

        <SettingsContainer categories={categories} />

        <View className="mb-28 gap-3">
          {isSigningOut && (
            <Text accessibilityLiveRegion="polite" className="text-muted">
              Uploading saved locations before signing out. This may take up to 10 seconds; any
              remaining locations will be saved for your next sign-in.
            </Text>
          )}
          <Button onPress={handleSignOut} disabled={isSigningOut}>
            <Text>{isSigningOut ? "Signing out…" : "Sign out"}</Text>
          </Button>
        </View>
      </ScrollView>
    </View>
  );
};

export default AccountScreen;
