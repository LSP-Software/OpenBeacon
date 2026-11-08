import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { isNativeGoogleSignInConfigured, signInWithGoogle } from "../lib/auth.ts";
import { authClient } from "../lib/auth-client.ts";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Text } from "./ui/Text.tsx";

export const ConfirmIdentity = ({ onConfirmed }: { onConfirmed: () => void }) => {
  const { data: session } = authClient.useSession();
  const methods = useQuery(trpc.account.deletionVerificationMethods.queryOptions());
  const [pending, setPending] = useState(false);
  const form = useForm<{ password: string }>({ defaultValues: { password: "" } });
  const google = methods.data?.google === true && isNativeGoogleSignInConfigured;

  const finish = async (previous: { token: string; userId: string }) => {
    const current = await tryCatch(authClient.getSession());
    const currentSession = current.data?.data;
    if (!currentSession || currentSession.session.token === previous.token) return;
    if (currentSession.user.id !== previous.userId) {
      await tryCatch(authClient.signOut());
      router.replace("/");
      Alert.alert(
        "Signed in to a different account",
        "That Google account isn’t the one you were signed in with, so you’ve been signed out.",
      );
      return;
    }
    await tryCatch(authClient.revokeSession({ token: previous.token }));
    onConfirmed();
  };

  const confirmWithPassword = async ({ password }: { password: string }) => {
    if (!session) return;
    const previous = { token: session.session.token, userId: session.user.id };
    setPending(true);
    const result = await authClient.signIn.email({ email: session.user.email, password });
    form.reset();
    if (result.error) {
      setPending(false);
      Alert.alert("Unable to confirm it’s you", result.error.message ?? "Please try again.");
      return;
    }
    await finish(previous);
    setPending(false);
  };

  const confirmWithGoogle = async () => {
    if (!session) return;
    const previous = { token: session.session.token, userId: session.user.id };
    setPending(true);
    const result = await signInWithGoogle();
    if (result.error) {
      setPending(false);
      Alert.alert("Unable to confirm it’s you", result.error.message ?? "Please try again.");
      return;
    }
    await finish(previous);
    setPending(false);
  };

  return (
    <View className="gap-4">
      <Text className="text-foreground text-3xl font-bold">Confirm it’s you</Text>
      <Text className="text-muted-foreground text-base leading-6">
        Sign in again to continue. This stops anyone who picks up your unlocked phone from changing
        your recovery phrase.
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
      {methods.isError && <Text>Unable to load sign-in methods. Please try again.</Text>}
      {methods.data && !methods.data.password && !google && (
        <Text>No sign-in method is available on this phone. Please contact support.</Text>
      )}
    </View>
  );
};
