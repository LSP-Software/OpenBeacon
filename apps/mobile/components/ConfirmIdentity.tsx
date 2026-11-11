import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { isNativeGoogleSignInConfigured, signInWithGoogle } from "../lib/auth.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../lib/auth-client.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { LoadingIndicator } from "./LoadingIndicator.tsx";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Text } from "./ui/Text.tsx";

export const ConfirmIdentity = ({ onConfirmed }: { onConfirmed: () => void }) => {
  const { data: session } = authClient.useSession();
  const methods = useQuery(trpc.account.deletionVerificationMethods.queryOptions());
  const [pending, setPending] = useState(false);
  const form = useForm<{ password: string }>({ defaultValues: { password: "" } });
  const google = methods.data?.google === true && isNativeGoogleSignInConfigured;

  const confirm = async (
    signIn: () => Promise<{
      cancelled?: boolean;
      error?: { message?: string | undefined } | null | undefined;
    }>,
  ) => {
    if (!session) return;
    const previous = { token: session.session.token, userId: session.user.id };
    setPending(true);
    const result = await tryCatch(signIn());
    if (result.data?.cancelled) {
      setPending(false);
      return;
    }
    const failure = result.error ?? result.data.error;
    if (failure) {
      setPending(false);
      Alert.alert("Unable to confirm it’s you", failure.message || "Please try again.");
      return;
    }
    const current = await tryCatch(authClient.getSession());
    const currentSession = current.data?.data;
    if (!currentSession || currentSession.session.token === previous.token) {
      setPending(false);
      Alert.alert("Unable to confirm it’s you", "Please try again.");
      return;
    }
    if (currentSession.user.id !== previous.userId) {
      await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, previous.token));
      await tryCatch(authClient.signOut());
      router.replace("/");
      Alert.alert(
        "Signed in to a different account",
        "That Google account isn’t the one you were signed in with, so you’ve been signed out. Sign in again with your own account.",
      );
      return;
    }
    await tryCatch(authClient.revokeSession({ token: previous.token }));
    const linked = await tryCatch(ensureDeviceKeyRegistration({ checkOwner: true }));
    setPending(false);
    if (linked.error) {
      Alert.alert(
        "Unable to confirm it’s you",
        "This phone couldn’t confirm it’s yours. Check your connection and try again.",
      );
      return;
    }
    onConfirmed();
  };

  const confirmWithPassword = ({ password }: { password: string }) => {
    const email = session?.user.email ?? "";
    form.reset();
    return confirm(() => authClient.signIn.email({ email, password }));
  };

  const confirmWithGoogle = () =>
    confirm(async () => {
      const result = await signInWithGoogle();
      return "error" in result || "data" in result ? result : { cancelled: true };
    });

  return (
    <View className="gap-4">
      <Text className="text-foreground text-3xl font-bold">Confirm it’s you</Text>
      <Text className="text-muted-foreground text-base leading-6">
        {methods.data?.password === false
          ? "Sign in with Google again to continue."
          : "Sign in again to continue. This stops anyone who picks up your unlocked phone from making important changes to your account."}
      </Text>
      {methods.data?.password && (
        <>
          <Input
            control={form.control}
            name="password"
            label="Password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <Button onPress={form.handleSubmit(confirmWithPassword)} disabled={pending}>
            <Text>{pending ? "Checking…" : "Continue"}</Text>
          </Button>
        </>
      )}
      {google && (
        <Button
          variant={methods.data?.password ? "outline" : "default"}
          onPress={confirmWithGoogle}
          disabled={pending}
        >
          <Text>Continue with Google</Text>
        </Button>
      )}
      {methods.isLoading && <LoadingIndicator />}
      {methods.isError && (
        <View className="gap-4">
          <Text>Unable to load sign-in methods. Please try again.</Text>
          <Button variant="outline" onPress={() => methods.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      )}
      {methods.data && !methods.data.password && !google && (
        <Text>No sign-in method is available on this phone. Please contact support.</Text>
      )}
    </View>
  );
};
