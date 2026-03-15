import { zodResolver } from "@hookform/resolvers/zod";
import { createGroupSchema } from "@openbeacon/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CameraIcon } from "lucide-react-native";
import { useForm } from "react-hook-form";
import { View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Text } from "../ui/Text";

interface CreateGroupDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const CreateGroupDialog = ({ open, setOpen }: CreateGroupDialogProps) => {
  const queryClient = useQueryClient();
  const createGroupMutation = useMutation(trpc.groups.create.mutationOptions());

  const form = useForm<z.infer<typeof createGroupSchema>>({
    resolver: zodResolver(createGroupSchema),
    mode: "all",
    defaultValues: {
      name: "",
    },
    shouldFocusError: true,
  });

  const onSubmit = async (data: z.infer<typeof createGroupSchema>) => {
    await createGroupMutation.mutateAsync(data, {
      onError: (error) => {
        console.log("error", error);
      },
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.groups.list.queryKey(), (previous) => {
          if (!previous) {
            return [data.newGroup];
          }
          return [data.newGroup, ...previous];
        });
        closeForm();
      },
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
          <Button className="flex-1" onPress={closeForm}>
            <Text>Cancel</Text>
          </Button>
          <Button
            className="flex-1"
            onPress={form.handleSubmit(onSubmit)}
            loading={createGroupMutation.isPending}
          >
            <Text>Create Group</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  );
};
