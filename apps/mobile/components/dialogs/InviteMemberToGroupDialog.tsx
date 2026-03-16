import { zodResolver } from "@hookform/resolvers/zod";
import { GroupRole } from "@openbeacon/database";
import { inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LinkIcon, MailIcon, PlusIcon, Trash2Icon } from "lucide-react-native";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api";
import { FormSelectInput } from "../formInputs/FormSelectInput";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { Text } from "../ui/Text";

interface InviteMemberToGroupDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const InviteMemberToGroupDialog = ({ open, setOpen }: InviteMemberToGroupDialogProps) => {
  const [value, setValue] = useState("email");

  return (
    <Dialog open={open} onOpenChange={(open) => setOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription className="text-secondary">
            Invite a member to the group. They will receive an email with a link to join the group
            and start sharing locations privately.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={value} onValueChange={setValue}>
          <TabsList className="flex justify-center w-full bg-secondary mb-4">
            <TabsTrigger value="email" className="flex-1">
              <Icon as={MailIcon} />
              <Text>Email</Text>
            </TabsTrigger>
            <TabsTrigger value="Link" className="flex-1">
              <Icon as={LinkIcon} />
              <Text>Link</Text>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="email" className="flex flex-col gap-4">
            <InviteMembersInputs />
          </TabsContent>
          <TabsContent value="Link">
            <Text>Phone</Text>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export const InviteMembersInputs = () => {
  const form = useForm<z.infer<typeof inviteMemberToGroupSchema>>({
    resolver: zodResolver(inviteMemberToGroupSchema),
    mode: "all",
    defaultValues: {
      invites: [
        {
          email: "",
          role: "MEMBER",
        },
      ],
    },
    shouldFocusError: true,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "invites",
  });

  const handleAddNewInvite = () => {
    append({ email: "", role: "MEMBER" });
  };

  const handleRemoveInvite = (index: number) => {
    remove(index);
  };

  const queryClient = useQueryClient();
  const inviteMemberMutation = useMutation(trpc.groups.inviteMember.mutationOptions());
  const onSubmit = async (data: z.infer<typeof inviteMemberToGroupSchema>) => {
    await inviteMemberMutation.mutateAsync(data, {
      onSuccess: (data) => {
        console.log(data);
      },
      onError: (error) => {
        console.log(error);
      },
    });
  };

  return (
    <View className="flex flex-col gap-4">
      <View className="flex flex-col gap-2">
        <Text className="text-foreground font-semibold text-md">Email Addresses</Text>
        <Text className="text-secondary text-sm">
          If there are accounts associated with the provided emails an invite will be sent to them.
        </Text>
        <View className="flex flex-col gap-2">
          {fields.map((field, index) => {
            return (
              <View key={field.id} className="flex flex-row items-start gap-2">
                <Input
                  control={form.control}
                  name={`invites.${index}.email`}
                  placeholder="name@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  className="h-12 rounded-xl border border-border bg-input px-4 py-0 text-base text-foreground"
                />
                <View>
                  <FormSelectInput
                    control={form.control}
                    name={`invites.${index}.role`}
                    fieldClassName="w-28"
                    values={[
                      { label: "Admin", value: "ADMIN" },
                      { label: "Member", value: "MEMBER" },
                    ]}
                  />
                </View>
                <Pressable
                  className="h-10 w-10 items-center justify-center"
                  onPress={() => handleRemoveInvite(index)}
                >
                  <Icon as={Trash2Icon} className="text-destructive size-5" />
                </Pressable>
              </View>
            );
          })}
        </View>
        <Button variant={"secondary"} size="sm" onPress={handleAddNewInvite} className="mt-2">
          <Icon as={PlusIcon} className="size-5" />
          <Text>Add {fields.length === 1 ? "another email" : "email"}</Text>
        </Button>
      </View>
      <View className="flex flex-col gap-2 rounded-xl p-2">
        <Text className="text-md font-semibold">Role Permissions:</Text>
        <View className="flex flex-col">
          <Text className="text-secondary text-sm">
            <Text className="font-semibold">Member:</Text> Can view locations of all family members
          </Text>
          <Text className="text-secondary text-sm">
            <Text className="font-semibold">Admin:</Text> Can view locations, invite/remove members
            and manage group settings
          </Text>
        </View>
        <Button size="sm" onPress={form.handleSubmit(onSubmit)}>
          <Icon as={MailIcon} className="text-white" />
          <Text>Send invitation{fields.length > 1 ? "s" : ""}</Text>
        </Button>
      </View>
    </View>
  );
};
