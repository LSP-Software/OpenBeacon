import { zodResolver } from "@hookform/resolvers/zod";
import { createGroupSchema } from "@openbeacon/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type z from "zod";
import { trpc } from "../../lib/api";
import { Button } from "../Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";

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
        form.reset();
        setOpen(false);
      },
    });
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
          <Input
            control={form.control}
            name="name"
            label="Group Name"
            placeholder="Group name"
            autoComplete="off"
          />
          <Button title="Submit" onPress={form.handleSubmit(onSubmit)} />
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
