import { zodResolver } from "@hookform/resolvers/zod";
import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { View } from "react-native";
import { z } from "zod";
import { Alert } from "../lib/alert.ts";
import { confirmWithPhoneLock, phoneScreenLockQueryOptions } from "../lib/appLock.ts";
import { trpc } from "../lib/api.ts";
import { isNativeGoogleSignInConfigured, signInWithGoogle } from "../lib/auth.ts";
import { authClient, saveSessionTokenToRevoke } from "../lib/auth-client.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { endSession } from "../lib/endSession.ts";
import { readSignInError, signInCodeEntryError, signInWithPassword } from "../lib/emailCodes.ts";
import { isDeviceRemovedError } from "../lib/deviceRemovedError.ts";
import { passwordErrorMessage } from "../lib/passwordErrorMessage.ts";
import { isSessionLinkRefused, signOutAfterRefusedSessionLink } from "../lib/sessionLink.ts";
import { EmailCodeEntry } from "./EmailCodeEntry.tsx";
import { LoadingIndicator } from "./LoadingIndicator.tsx";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Text } from "./ui/Text.tsx";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

export const ConfirmIdentity = ({ onConfirmed }: { onConfirmed: () => void }) => {
  const { data: session } = authClient.useSession();
  const methods = useQuery(trpc.account.deletionVerificationMethods.queryOptions());
  const screenLock = useQuery(phoneScreenLockQueryOptions);
  const [pending, setPending] = useState(false);
  const [signInCode, setSignInCode] = useState<{
    password: string;
    notice: string | undefined;
  } | null>(null);
  const form = useForm<{ password: string }>({
    resolver: zodResolver(
      z.object({ password: z.string().min(1, { message: "Password is required" }) }),
    ),
    defaultValues: { password: "" },
  });
  const google = methods.data?.google === true && isNativeGoogleSignInConfigured;

  const finishConfirming = async (previous: { token: string; userId: string }) => {
    const current = await tryCatch(authClient.getSession());
    const currentSession = current.data?.data;
    if (!currentSession || currentSession.session.token === previous.token) {
      setPending(false);
      Alert.alert("Couldn’t confirm it’s you", "Please try again.");
      return;
    }
    if (currentSession.user.id !== previous.userId) {
      await tryCatch(saveSessionTokenToRevoke(previous.token));
      await tryCatch(endSession({ reason: "signedOut" }));
      router.replace("/");
      Alert.alert(
        "Signed in to a different account",
        "That Google account isn’t the one you were signed in with, so you’ve been signed out. Sign in again with your own account.",
      );
      return;
    }
    await tryCatch(authClient.revokeSession({ token: previous.token }));
    const linked = await tryCatch(ensureDeviceKeyRegistration({ linkSession: true }));
    setPending(false);
    if (isDeviceRemovedError(linked.error)) return;
    if (isSessionLinkRefused(linked.error)) {
      await signOutAfterRefusedSessionLink();
      return;
    }
    if (linked.error) {
      Alert.alert(
        "Couldn’t confirm it’s you",
        `This ${thisDeviceNoun()} couldn’t confirm it’s yours. Check your connection and try again.`,
      );
      return;
    }
    onConfirmed();
  };

  const confirmWithPassword = async (password: string, code?: string) => {
    if (!session) {
      return { kind: "failed", code: undefined, message: "Sign in again to continue." } as const;
    }
    const previous = { token: session.session.token, userId: session.user.id };
    form.reset();
    setPending(true);
    const result = await tryCatch(
      signInWithPassword({ email: session.user.email, password, code }),
    );
    const outcome = readSignInError(result.error ?? result.data.error);
    if (outcome.kind === "codeRequired") setSignInCode({ password, notice: outcome.notice });
    if (outcome.kind !== "signedIn") {
      setPending(false);
      return outcome;
    }
    setSignInCode(null);
    await finishConfirming(previous);
    return outcome;
  };

  const confirmWithCode = async (password: string, code?: string) => {
    const outcome = await confirmWithPassword(password, code);
    if (outcome.kind === "wrongPassword") {
      setSignInCode(null);
      Alert.alert("Couldn’t confirm it’s you", outcome.message);
      return undefined;
    }
    return signInCodeEntryError(outcome, code !== undefined);
  };

  const confirmWithGoogle = async () => {
    if (!session) return;
    const previous = { token: session.session.token, userId: session.user.id };
    setPending(true);
    const phoneLock = await confirmWithPhoneLock("Confirm it’s you");
    if (phoneLock === "lockedOut" || phoneLock === "failed") {
      setPending(false);
      if (phoneLock === "lockedOut") {
        Alert.alert("Couldn’t confirm it’s you", "Too many tries. Wait a moment, then try again.");
      }
      return;
    }
    const result = await tryCatch(signInWithGoogle());
    if (result.data && "cancelled" in result.data) {
      setPending(false);
      return;
    }
    if (result.data && "unavailable" in result.data) {
      setPending(false);
      Alert.alert("Couldn’t confirm it’s you", "Please try again.");
      return;
    }
    const failure = result.error ?? result.data.error;
    if (failure) {
      setPending(false);
      Alert.alert("Couldn’t confirm it’s you", passwordErrorMessage(failure, "Please try again."));
      return;
    }
    await finishConfirming(previous);
  };

  return (
    <View className="gap-4">
      <Text className="text-foreground text-3xl font-bold">Confirm it’s you</Text>
      <Text className="text-secondary text-base">
        {methods.data?.password !== false
          ? `Sign in again to continue. This stops anyone who picks up your unlocked ${thisDeviceNoun()} from making important changes to your account.`
          : screenLock.data === true
            ? `Use your ${thisDeviceNoun()}’s screen lock, then sign in with Google again to continue. This stops anyone who picks up your unlocked ${thisDeviceNoun()} from making important changes to your account.`
            : "Sign in with Google again to continue."}
      </Text>
      {signInCode && (
        <>
          <EmailCodeEntry
            email={session?.user.email ?? ""}
            notice={signInCode.notice}
            submitLabel="Continue"
            onSubmit={(code) => confirmWithCode(signInCode.password, code)}
            onResend={() => confirmWithCode(signInCode.password)}
          />
          <Button variant="secondary" onPress={() => setSignInCode(null)} disabled={pending}>
            <Text>{google ? "Use a different method" : "Back"}</Text>
          </Button>
        </>
      )}
      {methods.data?.password && !signInCode && (
        <>
          <Input
            control={form.control}
            name="password"
            label="Password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <Button
            onPress={form.handleSubmit(async ({ password }) => {
              const outcome = await confirmWithPassword(password);
              if (outcome.kind === "wrongPassword" || outcome.kind === "failed") {
                Alert.alert("Couldn’t confirm it’s you", outcome.message);
              }
            })}
            disabled={pending}
          >
            <Text>{pending ? "Checking…" : "Continue"}</Text>
          </Button>
        </>
      )}
      {google && !signInCode && (
        <Button
          variant={methods.data?.password ? "secondary" : "default"}
          onPress={confirmWithGoogle}
          disabled={pending}
        >
          <Text>Continue with Google</Text>
        </Button>
      )}
      {methods.isPending && <LoadingIndicator />}
      {methods.isError && (
        <View className="gap-4">
          <Text>Unable to load sign-in methods. Please try again.</Text>
          <Button variant="secondary" onPress={() => methods.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      )}
      {methods.data && !methods.data.password && !google && (
        <Text>
          No sign-in method is available on this {thisDeviceNoun()}. Please contact support.
        </Text>
      )}
    </View>
  );
};
