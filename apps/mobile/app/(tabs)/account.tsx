import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ChevronRightIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/Button.tsx";
import { ProfileImage } from "../../components/ProfileImage.tsx";
import { queryClient, trpc } from "../../lib/api.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../../lib/auth-client.ts";
import { tryCatch } from "../../lib/tryCatch.ts";

const DEFAULT_MAX_PFP_IMAGE_RESOLUTION = 1024;
const envMaxPfpResolution = process.env["EXPO_PUBLIC_MAX_PFP_IMAGE_RESOLUTION"];
const MAX_PFP_IMAGE_RESOLUTION =
  envMaxPfpResolution !== undefined
    ? Number.parseInt(envMaxPfpResolution, 10) || DEFAULT_MAX_PFP_IMAGE_RESOLUTION
    : DEFAULT_MAX_PFP_IMAGE_RESOLUTION;

type SettingRowProps = {
  label: string;
  sublabel?: string;
  onPress: () => void;
};

function SettingRow({ label, sublabel, onPress }: SettingRowProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between gap-2 px-4 py-3 border-b border-border"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View className="w-2 h-2 rounded-full bg-primary items-center" />
      <View className="flex-1 gap-1">
        <Text className="text-foreground font-medium">{label}</Text>
        {sublabel !== undefined && <Text className="text-muted text-sm">{sublabel}</Text>}
      </View>
      <ChevronRightIcon />
    </Pressable>
  );
}

export default function AccountScreen() {
  const { data: session } = authClient.useSession();
  const { data: profile } = useQuery(trpc.account.getProfile.queryOptions());
  const requestUploadMutation = useMutation(trpc.account.requestImageUpload.mutationOptions());
  const confirmUploadMutation = useMutation(trpc.account.confirmImageUpload.mutationOptions());
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const name = session?.user.name ?? "";
  const email = session?.user.email ?? "";

  const handleEditProfileImage = async () => {
    if (isUploading) return;

    const {
      cleanupTempFile,
      computeSha256Base64,
      getFileSize,
      pickAndCropImage,
      processImage,
      uploadToPresignedUrl,
    } = await import("../../lib/image-upload.ts");

    console.log("MAX_PFP_IMAGE_RESOLUTION:", MAX_PFP_IMAGE_RESOLUTION);

    const imagePath = await pickAndCropImage(MAX_PFP_IMAGE_RESOLUTION);
    if (!imagePath) return;

    setIsUploading(true);
    let processedUri: string | null = null;

    const { data: processed, error: processError } = await tryCatch(processImage(imagePath));
    if (processError) {
      Alert.alert("Image processing failed", processError.message);
      setIsUploading(false);
      return;
    }
    processedUri = processed;

    const fileSize = getFileSize(processedUri);
    const { data: contentHash, error: hashError } = await tryCatch(
      computeSha256Base64(processedUri),
    );
    if (hashError) {
      Alert.alert("Image processing failed", hashError.message);
      cleanupTempFile(processedUri);
      setIsUploading(false);
      return;
    }

    const { data: uploadData, error: requestError } = await tryCatch(
      requestUploadMutation.mutateAsync({ fileSize, contentHash }),
    );
    if (requestError) {
      Alert.alert("Upload request failed", requestError.message);
      cleanupTempFile(processedUri);
      setIsUploading(false);
      return;
    }

    const { error: uploadError } = await tryCatch(
      uploadToPresignedUrl(uploadData.presignedUrl, processedUri, contentHash),
    );
    if (uploadError) {
      Alert.alert("Image upload failed", uploadError.message);
      cleanupTempFile(processedUri);
      setIsUploading(false);
      return;
    }

    const { error: confirmError } = await tryCatch(
      confirmUploadMutation.mutateAsync({ fileName: uploadData.fileName }),
    );
    if (confirmError) {
      Alert.alert("Upload confirmation failed", confirmError.message);
      cleanupTempFile(processedUri);
      setIsUploading(false);
      return;
    }

    cleanupTempFile(processedUri);
    await queryClient.invalidateQueries({ queryKey: trpc.account.getProfile.queryKey() });
    setIsUploading(false);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const sessionTokenToRevoke = session?.session?.token ?? null;

    const { error: signOutError } = await tryCatch(authClient.signOut());

    if (signOutError && sessionTokenToRevoke) {
      await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke));
    }

    setIsSigningOut(false);
    router.replace("/");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="z-10">
        <View className="px-8 pt-4 pb-10">
          <Text className="text-muted uppercase font-bold">Your</Text>
          <Text className="text-foreground text-3xl font-bold">Account</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-28 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center py-6 gap-4">
          <ProfileImage
            imageUrl={profile?.imageUrl ?? null}
            size={80}
            showEditButton
            onEditPress={handleEditProfileImage}
          />
          <View className="items-center gap-1">
            <Text className="text-foreground text-2xl font-bold">{name}</Text>
            <Text className="text-muted text-sm">{email}</Text>
          </View>
        </View>

        <View className="rounded-lg overflow-hidden border border-border bg-surface">
          <SettingRow
            label="Profile details"
            sublabel="Name, email and account"
            onPress={() => {}}
          />
          <SettingRow
            label="Server Configuration"
            sublabel="Self-hosted or managed"
            onPress={() => router.push("/serverUrl")}
          />
        </View>

        <Button title="Sign out" onPress={handleSignOut} variant="primary" />
        <Text className="text-muted text-sm text-center">OpenBeacon · Open Source</Text>
      </ScrollView>
    </View>
  );
}
