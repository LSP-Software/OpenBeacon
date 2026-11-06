import { zodResolver } from "@hookform/resolvers/zod";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { Button } from "../../../components/ui/Button.tsx";
import { Input } from "../../../components/ui/Input.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { trpc } from "../../../lib/api.ts";
import { authClient } from "../../../lib/auth-client.ts";

const schema = z.object({ name: accountNameSchema });

const ProfileScreen = () => {
  const { data: session, refetch } = authClient.useSession();
  const queryClient = useQueryClient();
  const requestDeletion = useMutation(trpc.account.requestDeletion.mutationOptions());
  const beginGoogleVerification = useMutation(
    trpc.account.beginGoogleDeletionVerification.mutationOptions(),
  );
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const verificationMethods = useQuery({
    ...trpc.account.deletionVerificationMethods.queryOptions(),
    enabled: confirmingDeletion,
  });
  const [isGoogleVerifying, setIsGoogleVerifying] = useState(false);
  const deletionForm = useForm<{ password: string }>({ defaultValues: { password: "" } });
  const updateName = useMutation(trpc.account.updateName.mutationOptions());
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (session?.user.name) form.reset({ name: session.user.name });
  }, [session?.user.name, form.reset]);

  const save = async ({ name }: z.infer<typeof schema>) => {
    const result = await tryCatch(updateName.mutateAsync({ name }));
    if (result.error) {
      Alert.alert("Unable to update name", result.error.message);
      return;
    }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({
        queryKey: trpc.groupMembership.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.groupMembership.members.queryKey(),
      }),
    ]);
    Alert.alert("Profile updated", "Your name has been saved.");
  };

  const requestAccountDeletion = (
    verification: { password: string } | { google: { state: string; code: string } },
  ) => {
    Alert.alert(
      "Delete account?",
      "You will be signed out on all devices. Your account will be deleted after seven days unless you sign in again. Groups where you are the only member will be deleted. Transfer ownership or delete other groups where you are the only owner first.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(requestDeletion.mutateAsync(verification));
            deletionForm.reset();
            if (result.error) {
              Alert.alert("Unable to delete account", result.error.message);
              return;
            }
            await tryCatch(authClient.signOut());
            router.replace("/");
            Alert.alert(
              "Account deletion requested",
              "Sign in within seven days to cancel deletion.",
            );
          },
        },
      ],
    );
  };

  const verifyWithGoogle = async () => {
    if (isGoogleVerifying) return;
    setIsGoogleVerifying(true);
    const authorization = await tryCatch(beginGoogleVerification.mutateAsync());
    if (authorization.error) {
      setIsGoogleVerifying(false);
      Alert.alert("Google verification failed", "Please try again.");
      return;
    }
    const result = await tryCatch(
      WebBrowser.openAuthSessionAsync(authorization.data.url, "openbeacon://google-deletion"),
    );
    setIsGoogleVerifying(false);
    if (result.error) {
      Alert.alert("Google verification failed", "Please try again.");
      return;
    }
    if (result.data.type !== "success") return;
    const resultUrl = result.data.url;
    const parsed = await tryCatch(Promise.resolve().then(() => new URL(resultUrl)));
    const callback = parsed.data;
    const state = callback?.searchParams.get("state");
    const code = callback?.searchParams.get("code");
    if (
      callback?.protocol !== "openbeacon:" ||
      callback.hostname !== "google-deletion" ||
      state !== authorization.data.state ||
      !code
    ) {
      Alert.alert("Google verification failed", "Please try again.");
      return;
    }
    requestAccountDeletion({ google: { state, code } });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="gap-4 p-6">
        <Text className="text-2xl font-bold">Manage Profile</Text>
        <Input
          control={form.control}
          name="name"
          label="Name"
          autoCapitalize="words"
          autoComplete="name"
        />
        <Button onPress={form.handleSubmit(save)} disabled={updateName.isPending}>
          <Text>Save name</Text>
        </Button>
        {confirmingDeletion ? (
          <>
            {verificationMethods.data?.password && (
              <>
                <Input
                  control={deletionForm.control}
                  name="password"
                  label="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                />
                <Text>Enter your account password to continue.</Text>
                <Button
                  onPress={deletionForm.handleSubmit(requestAccountDeletion)}
                  disabled={requestDeletion.isPending || isGoogleVerifying}
                >
                  <Text>Confirm deletion</Text>
                </Button>
              </>
            )}
            {verificationMethods.data?.google && (
              <Button
                onPress={verifyWithGoogle}
                disabled={requestDeletion.isPending || isGoogleVerifying}
              >
                <Text>Verify with Google</Text>
              </Button>
            )}
            {verificationMethods.isError && (
              <Text>Unable to load verification methods. Please try again.</Text>
            )}
            {verificationMethods.data &&
              !verificationMethods.data.password &&
              !verificationMethods.data.google && (
                <Text>No verification method is available. Please contact support.</Text>
              )}
            <Button
              variant="outline"
              onPress={() => {
                deletionForm.reset();
                setConfirmingDeletion(false);
              }}
            >
              <Text>Cancel</Text>
            </Button>
          </>
        ) : (
          <Button variant="outline" onPress={() => setConfirmingDeletion(true)}>
            <Text>Delete account</Text>
          </Button>
        )}
      </View>
    </SafeAreaView>
  );
};

export default ProfileScreen;
