import { zodResolver } from "@hookform/resolvers/zod";
import { createGroupSchema } from "@openbeacon/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CameraIcon } from "lucide-react-native";
import { useForm } from "react-hook-form";
import { Alert, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api.ts";
import { buildCreateGroupInput } from "../../lib/groupEncryption.ts";
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

interface CreateGroupDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const CreateGroupDialog = ({ open, setOpen }: CreateGroupDialogProps) => {
  const queryClient = useQueryClient();
  const createGroupMutation = useMutation(trpc.groupLifecycle.create.mutationOptions());
  const createGroupSubmission = useSingleFlight<"create-group">();

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
      try {
        const createGroupInput = await buildCreateGroupInput({ name: data.name });
        const createdGroup = await createGroupMutation.mutateAsync(createGroupInput);

        queryClient.setQueryData(trpc.groupMembership.list.queryKey(), (previous) => {
          if (!previous) {
            return [createdGroup.newGroup];
          }
          return [createdGroup.newGroup, ...previous];
        });
        closeForm();
      } catch (error) {
        Alert.alert(
          "Unable to create group",
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  };

  const closeForm = () => {
    setOpen(false);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={(open) => setOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new group</DialogTitle>
          <DialogDescription>
            Create a new group to start sharing locations privately; All location data is end to end
            encrypted. Only members of your group can see each other.
          </DialogDescription>
        </DialogHeader>

        <View className="flex flex-row items-center gap-4">
          <View className="relative flex size-20 shrink-0  items-center justify-center rounded-lg border-border border-2 border-dashed transition-all">
            <Icon as={CameraIcon} size={20} className="text-secondary" />
          </View>
          <Input
            control={form.control}
            name="name"
            label="Group Name"
            placeholder="Group name"
            autoComplete="off"
          />
        </View>

        <View className="flex-row gap-4 justify-between">
          <Button className="flex-1" onPress={closeForm} variant={"secondary"}>
            <Text>Cancel</Text>
          </Button>
          <Button
            className="flex-1"
            onPress={form.handleSubmit(onSubmit)}
            loading={createGroupSubmission.isPending || createGroupMutation.isPending}
          >
            <Text>Create Group</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  );
};
