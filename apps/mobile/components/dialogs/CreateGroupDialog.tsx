import { Alert } from "../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGroupSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CameraIcon, XIcon } from "lucide-react-native";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api.ts";
import { buildCreateGroupInput, submitEpochChange } from "../../lib/groupEncryption.ts";
import { uploadNewGroupImage } from "../../lib/groupImageUpload.ts";
import { groupLimitAlert } from "../../lib/groupLimitAlert.ts";
import { cleanupTempFile } from "../../lib/image-upload.ts";
import { storeOwnImageKeyInGroup } from "../../lib/imageKeys.ts";
import { pickImage, processImage } from "../../lib/pickImage.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";
import { useSingleFlight } from "../../lib/useSingleFlight.ts";
import { Button } from "../ui/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Input } from "../ui/Input.tsx";
import { Text } from "../ui/Text.tsx";
import { userMessage } from "../../lib/userMessage.ts";

export const CreateGroupDialog = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const createGroupMutation = useMutation(trpc.groupLifecycle.create.mutationOptions());
  const createGroupSubmission = useSingleFlight<"create-group">();
  const picturePicker = useSingleFlight<"pick-picture">();
  const [pictureUri, setPictureUri] = useState<string | null>(null);

  const form = useForm<z.infer<typeof createGroupSchema>>({
    resolver: zodResolver(createGroupSchema),
    mode: "all",
    defaultValues: {
      name: "",
    },
    shouldFocusError: true,
  });

  const onSubmit = async (data: z.infer<typeof createGroupSchema>) => {
    await createGroupSubmission.run("create-group", async () => {
      const result = await tryCatch(
        (async () => {
          const createdGroup = await submitEpochChange({
            build: () => buildCreateGroupInput({ name: data.name }),
            submit: createGroupMutation.mutateAsync,
          });

          queryClient.setQueryData(trpc.groupMembership.list.queryKey(), (previous) => {
            if (!previous) {
              return [createdGroup.newGroup];
            }
            return [createdGroup.newGroup, ...previous];
          });
          void tryCatch(storeOwnImageKeyInGroup(createdGroup.newGroup.id));
          requestTrackingSync();
          setOpen(false);
          form.reset();
          setPictureUri(null);
          if (pictureUri) {
            void uploadNewGroupImage({ groupId: createdGroup.newGroup.id, uri: pictureUri });
          }
        })(),
      );

      const limit = groupLimitAlert(result.error);
      if (limit) {
        Alert.alert(limit.title, limit.message);
        return;
      }
      if (result.error) {
        Alert.alert("Couldn’t create group", userMessage(result.error));
      }
    });
  };

  const removePicture = () => {
    if (pictureUri) cleanupTempFile(pictureUri);
    setPictureUri(null);
  };

  const choosePicture = () =>
    picturePicker.run("pick-picture", async () => {
      const pickedUri = await pickImage();
      if (!pickedUri) return;
      const processedUri = await processImage(pickedUri);
      if (!processedUri) return;
      if (pictureUri) cleanupTempFile(pictureUri);
      setPictureUri(processedUri);
    });

  const closeForm = () => {
    if (createGroupSubmission.isPending) return;
    setOpen(false);
    form.reset();
    removePicture();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (open) setOpen(true);
        else closeForm();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new group</DialogTitle>
          <DialogDescription>
            Create a group to share your location with people you choose. Locations are end-to-end
            encrypted.
          </DialogDescription>
        </DialogHeader>

        <View className="flex flex-row items-center gap-4">
          <View className="relative size-20 shrink-0">
            <Pressable
              onPress={choosePicture}
              disabled={picturePicker.isPending || createGroupSubmission.isPending}
              accessibilityRole="button"
              accessibilityLabel={pictureUri ? "Change group picture" : "Choose group picture"}
              className={`size-20 items-center justify-center overflow-hidden rounded-full ${pictureUri ? "" : "border-border border-2 border-dashed"}`}
            >
              {pictureUri ? (
                <Image source={{ uri: pictureUri }} className="size-full" />
              ) : picturePicker.isPending ? (
                <ActivityIndicator className="text-secondary" />
              ) : (
                <Icon as={CameraIcon} size={20} className="text-secondary" />
              )}
            </Pressable>
            {pictureUri && (
              <Pressable
                onPress={removePicture}
                disabled={createGroupSubmission.isPending}
                accessibilityRole="button"
                accessibilityLabel="Remove group picture"
                hitSlop={8}
                className="absolute -right-2 -top-2 size-6 items-center justify-center rounded-full bg-secondary"
              >
                <Icon as={XIcon} size={14} className="text-secondary-foreground" />
              </Pressable>
            )}
          </View>
          <Input
            control={form.control}
            name="name"
            label="Group name"
            placeholder="Group name"
            autoComplete="off"
          />
        </View>

        <View className="flex-row gap-4 justify-between">
          <Button
            className="flex-1"
            onPress={closeForm}
            disabled={picturePicker.isPending || createGroupSubmission.isPending}
            variant={"secondary"}
          >
            <Text>Cancel</Text>
          </Button>
          <Button
            className="flex-1"
            onPress={form.handleSubmit(onSubmit)}
            loading={createGroupSubmission.isPending || createGroupMutation.isPending}
            disabled={picturePicker.isPending}
          >
            <Text>Create group</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  );
};
