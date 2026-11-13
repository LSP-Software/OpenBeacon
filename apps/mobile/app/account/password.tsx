import { Alert } from "../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { passwordErrorMessage } from "../../lib/passwordErrorMessage.ts";
import { authClient } from "../../lib/auth-client.ts";
import { changePasswordFormSchema } from "../../lib/changePasswordSchema.ts";
import { ensureDeviceKeyRegistration } from "../../lib/deviceKeys.ts";
import { isSessionLinkRefused, signOutAfterRefusedSessionLink } from "../../lib/sessionLink.ts";

const PasswordScreen = () => {
  const [saving, setSaving] = useState(false);
  const accounts = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });
  const hasPassword = accounts.data?.some((account) => account.providerId === "credential");
  const form = useForm<z.infer<typeof changePasswordFormSchema>>({
    resolver: zodResolver(changePasswordFormSchema),
    mode: "onTouched",
    defaultValues: { currentPassword: "", newPassword: "", confirmNewPassword: "" },
  });

  const changePassword = async ({
    currentPassword,
    newPassword,
  }: z.infer<typeof changePasswordFormSchema>) => {
    setSaving(true);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) {
      setSaving(false);
      Alert.alert(
        "Unable to change password",
        passwordErrorMessage(result.error, "Please try again."),
      );
      return;
    }
    form.reset();
    const linked = await tryCatch(ensureDeviceKeyRegistration({ linkSession: true }));
    setSaving(false);
    if (isSessionLinkRefused(linked.error)) {
      await signOutAfterRefusedSessionLink();
      return;
    }
    Alert.alert(
      "Password changed",
      "Your other devices have been signed out. Use your new password next time you sign in.",
    );
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Password</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-6 py-6 pb-32"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {hasPassword && (
            <View className="gap-2">
              <Text className="text-foreground text-3xl font-bold">Change password</Text>
              <Text className="text-muted-foreground text-base leading-6">
                Enter your current password, then choose a new one.
              </Text>
            </View>
          )}

          {accounts.isError && <Text>Unable to load your sign-in methods. Please try again.</Text>}
          {accounts.data && !hasPassword && (
            <Text>
              Your account uses Google to sign in, so it doesn’t have a password. If you think
              someone else is using your Google account, change your Google password, then sign out
              of all other sessions.
            </Text>
          )}
          {hasPassword && (
            <View className="gap-4">
              <Input
                control={form.control}
                name="currentPassword"
                label="Current password"
                placeholder="Current password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
              />
              <Input
                control={form.control}
                name="newPassword"
                label="New password"
                placeholder="New password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
              />
              <Input
                control={form.control}
                name="confirmNewPassword"
                label="Confirm new password"
                placeholder="Confirm new password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={form.handleSubmit(changePassword)}
              />
              <Button onPress={form.handleSubmit(changePassword)} disabled={saving}>
                <Text>{saving ? "Changing password…" : "Change password"}</Text>
              </Button>
            </View>
          )}
          <View className="gap-4">
            {hasPassword && (
              <Text className="text-muted-foreground text-base leading-6">
                Lost a phone or tablet? Sign out everywhere else without changing your password.
              </Text>
            )}
            <Link href="/account/sign-out-others" replace asChild>
              <Button variant="outline">
                <Text>Sign out of all other sessions</Text>
              </Button>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default PasswordScreen;
