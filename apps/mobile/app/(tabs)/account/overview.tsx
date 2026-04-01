import { tryCatch } from "@openbeacon/shared";
import { Link, router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  AlertCircleIcon,
  BellIcon,
  CameraIcon,
  ChevronRightIcon,
  HelpCircleIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  MapPinCheckIcon,
  MapPinIcon,
  SunIcon,
  UserCircleIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EditableImage } from "../../../components/image/EditableImage.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/Card.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Separator } from "../../../components/ui/Separator.tsx";
import { Text } from "../../../components/ui/Text.tsx";
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
        label: "Manage Profile",
        icon: UserCircleIcon,
        href: "/account/manage-profile",
      },
      {
        label: "Notifications",
        icon: BellIcon,
        href: "/account/notifications",
      },
      {
        label: "Password and Security",
        icon: LockIcon,
        href: "/account/password-and-security",
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
        href: "/account/help-center",
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

const AccountScreen = () => {
  const { data: session } = authClient.useSession();
  const { openLocationPermissionSettings, permissionState } = useLocationPermissions();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const sessionTokenToRevoke = session?.session?.token ?? null;

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
              <EditableImage
                accessibilityLabel={`${session?.user.name}'s profile picture`}
                alt="Profile picture"
                size="md"
                imageUrl={session?.user?.image ?? null}
              />
            </View>
          </View>
          <View className="flex flex-col px-4 pb-4 pt-14">
            <Text className="text-foreground font-semibold text-2xl">{session?.user.name}</Text>
            <Text className="text-muted-foreground text-base">{session?.user.email}</Text>

            <Separator className="my-4" />
            {/* TODO: Add devices count */}
            <View className="flex flex-row items-center gap-6">
              <View className="flex flex-col items-center">
                <Text className="text-foreground font-bold text-xl">24</Text>
                <Text className="text-muted-foreground text-base font-medium">Groups</Text>
              </View>

              <Separator className="my-4" orientation="vertical" />

              {/* TODO: Add devices count */}
              <View className="flex flex-col items-center">
                <Text className="text-foreground font-bold text-xl">4</Text>
                <Text className="text-muted-foreground text-base font-medium">Devices</Text>
              </View>

              <Separator className="my-4" orientation="vertical" />

              <View className="flex flex-row justify-end items-center gap-2">
                <Icon as={MapPinCheckIcon} className="text-primary size-5" />
                <Text className="text-muted-foreground text-sm">London, UK</Text>
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
        {categories.map((category) => {
          return (
            <View key={category.label}>
              <Text className="mb-1 text-lg font-medium text-muted-foreground">
                {category.label}
              </Text>
              <View className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                {category.settings.map((setting) => {
                  const isLastSetting = setting === category.settings[category.settings.length - 1];

                  return (
                    <Link key={setting.label} href={setting.href} asChild>
                      <Pressable
                        className={`flex flex-row items-center justify-between ${
                          isLastSetting ? "" : "border-b-[0.5px] border-border/30 pb-3"
                        }`}
                      >
                        <View className="flex flex-row items-center gap-3">
                          <Icon as={setting.icon} className="text-muted-foreground size-6" />
                          <Text className="text-foreground font-medium">{setting.label}</Text>
                        </View>
                        <Icon as={ChevronRightIcon} className="text-muted-foreground size-6" />
                      </Pressable>
                    </Link>
                  );
                })}
              </View>
            </View>
          );
        })}
        <Button onPress={handleSignOut}>
          <Text>Sign out</Text>
        </Button>
      </ScrollView>
    </View>
  );
};

export default AccountScreen;
