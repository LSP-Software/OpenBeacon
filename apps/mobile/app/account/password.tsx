import { Alert } from "../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { LogOutIcon, MailCheckIcon } from "lucide-react-native";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import type { z } from "zod";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { passwordErrorMessage } from "../../lib/passwordErrorMessage.ts";
import { authClient } from "../../lib/auth-client.ts";
import { changePasswordFormSchema } from "../../lib/changePasswordSchema.ts";
import { ensureDeviceKeyRegistration } from "../../lib/deviceKeys.ts";
import { isSessionLinkRefused, signOutAfterRefusedSessionLink } from "../../lib/sessionLink.ts";
import { useSingleFlight } from "../../lib/useSingleFlight.ts";

const PasswordScreen = () => {
  const [saving, setSaving] = useState(false);
  const submission = useSingleFlight<"change">();
  const accounts = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });
  const hasPassword = accounts.data?.some((account) => account.providerId === "credential");
  const signInCodes = useQuery(trpc.signInCodes.status.queryOptions());
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
        "Couldn’t change password",
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

  const submit = form.handleSubmit((values) =>
    submission.run("change", () => changePassword(values)),
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Password and security" />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-4 pb-10 pt-2"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {hasPassword && (
            <Text className="text-secondary px-4 text-[15px] leading-5">
              Enter your current password, then choose a new one.
            </Text>
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
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
              />
              <Input
                control={form.control}
                name="newPassword"
                label="New password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
              />
              <Input
                control={form.control}
                name="confirmNewPassword"
                label="Confirm new password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={submit}
              />
              <Button onPress={submit} disabled={saving}>
                <Text>{saving ? "Changing password…" : "Change password"}</Text>
              </Button>
            </View>
          )}
          <ListSection
            footer={
              hasPassword
                ? "Lost a phone or tablet? Sign out everywhere else without changing your password."
                : undefined
            }
          >
            <ListRow
              title="Sign out other sessions"
              icon={LogOutIcon}
              iconColor="orange"
              accessibilityRole="link"
              onPress={() => router.replace("/account/sign-out-others")}
            />
          </ListSection>
          {hasPassword && signInCodes.isError && (
            <ListSection
              title="Sign-in codes"
              footer="We couldn’t load this setting. Check your connection and try again."
            >
              <ListRow title="Sign-in codes" icon={MailCheckIcon} iconColor="blue" disabled />
            </ListSection>
          )}
          {hasPassword &&
            signInCodes.data &&
            (signInCodes.data.on || signInCodes.data.canTurnOn) && (
              <ListSection
                title="Sign-in codes"
                footer={
                  signInCodes.data.on
                    ? "Signing in on a new phone also needs a code we email you."
                    : "Turn on to also need a code from your email when you sign in on a new phone, so your password alone isn’t enough."
                }
              >
                <ListRow
                  title="Manage sign-in codes"
                  icon={MailCheckIcon}
                  iconColor="blue"
                  value={signInCodes.data.on ? "On" : "Off"}
                  href="/account/sign-in-codes"
                />
              </ListSection>
            )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default PasswordScreen;
