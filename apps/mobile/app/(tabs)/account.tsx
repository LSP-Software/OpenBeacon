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
import {
  cleanupTempFile,
  computeSha256Base64,
  getFileSize,
  pickAndCropImage,
  processImage,
  readImageBytes,
  uploadToPresignedUrl,
} from "../../lib/image-upload.ts";
import { tryCatch } from "../../lib/tryCatch.ts";

const MAX_PFP_IMAGE_RESOLUTION = 512;

type SettingRowProps = {
  label: string;
  sublabel?: string;
  onPress: () => void;
};

const SettingRow = ({ label, sublabel, onPress }: SettingRowProps) => {
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
};

const AccountScreen = () => {
  const { data: session } = authClient.useSession();
  const { data: profile } = useQuery(trpc.account.getProfile.queryOptions());
  const requestUploadMutation = useMutation(trpc.account.requestImageUpload.mutationOptions());
  const confirmUploadMutation = useMutation(trpc.account.confirmImageUpload.mutationOptions());
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const name = session?.user.name ?? "";
  const email = session?.user.email ?? "";

  const handleEditProfileImage = async () => {
    if (isUploading || isPickerOpen) return;

    setIsPickerOpen(true);
    const pickResult = await pickAndCropImage(MAX_PFP_IMAGE_RESOLUTION);
    setIsPickerOpen(false);
    if (pickResult.ok) {
      setIsUploading(true);
    } else if ("cancelled" in pickResult) {
      return;
    } else {
      Alert.alert("Image selection failed", pickResult.error.message);
      return;
    }

    const { data: processedUri, error: processError } = await tryCatch(processImage(pickResult.path, MAX_PFP_IMAGE_RESOLUTION));
    cleanupTempFile(pickResult.path);
    if (processError) {
      Alert.alert("Image processing failed", processError.message);
      setIsUploading(false);
      return;
    }

    const uploadError = await uploadProfilePhoto(processedUri);
    cleanupTempFile(processedUri);
    if (uploadError) {
      Alert.alert("Upload failed", uploadError);
      setIsUploading(false);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: trpc.account.getProfile.queryKey() });
    setIsUploading(false);
  };

  const uploadProfilePhoto = async (uri: string): Promise<string | undefined> => {
    const fileSize = await getFileSize(uri);
    if (!fileSize) return "unable to get file size";

    const { data: bytes, error: readError } = await tryCatch(readImageBytes(uri));
    if (readError) return "unable to read image bytes";

    const { data: contentHash, error: hashError } = await tryCatch(computeSha256Base64(bytes));
    if (hashError) return "unable to compute content hash";

    const { data: uploadData, error: requestError } = await tryCatch(requestUploadMutation.mutateAsync({ fileSize, contentHash }));
    if (requestError) return "unable to request upload";

    const { error: uploadError } = await tryCatch(uploadToPresignedUrl(uploadData.presignedUrl, bytes, contentHash));
    if (uploadError) return "unable to upload image";

    const { error: confirmError } = await tryCatch(confirmUploadMutation.mutateAsync({ fileName: uploadData.fileName }),);
    if (confirmError) return "unable to confirm upload";

    return undefined;
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
            imageUrl={profile?.image ?? null}
            showEditButton
            isLoading={isPickerOpen || isUploading}
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
};

export default AccountScreen;
