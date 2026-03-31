import { zodResolver } from "@hookform/resolvers/zod";
import { inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { useMutation } from "@tanstack/react-query";
import { LinkIcon, MailIcon, PlusIcon, Trash2Icon } from "lucide-react-native";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api.ts";
import { FormSelectInput } from "../formInputs/FormSelectInput.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Input } from "../ui/Input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs.tsx";
import { Text } from "../ui/Text.tsx";

interface InviteMemberToGroupDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  groupId: string;
}

export const InviteMemberToGroupDialog = ({
  open,
  setOpen,
  groupId,
}: InviteMemberToGroupDialogProps) => {
  const [value, setValue] = useState("email");

  return (
    <Dialog open={open} onOpenChange={(open) => setOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
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
            <InviteMembersInputs groupId={groupId} setOpen={setOpen} />
          </TabsContent>
          <TabsContent value="Link">
            <Text>Phone</Text>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

interface InviteMembersInputsProps {
  groupId: string;
  setOpen: (open: boolean) => void;
}

export const InviteMembersInputs = ({ groupId, setOpen }: InviteMembersInputsProps) => {
  const form = useForm<z.infer<typeof inviteMemberToGroupSchema>>({
    resolver: zodResolver(inviteMemberToGroupSchema),
    mode: "onBlur",
    defaultValues: {
      groupId: groupId,
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

  const inviteMemberMutation = useMutation(trpc.groupInvites.send.mutationOptions());
  const onSubmit = async (data: z.infer<typeof inviteMemberToGroupSchema>) => {
    await inviteMemberMutation.mutateAsync(data, {
      onSuccess: () => {
        form.reset();
        setOpen(false);
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
        <Button
          variant="outline"
          size="sm"
          onPress={handleAddNewInvite}
          className="mt-2 h-12 rounded-xl border-border bg-card"
        >
          <Icon as={PlusIcon} className="size-5 text-primary" />
          <Text className="text-primary">Add another email</Text>
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
        <Button
          size="sm"
          onPress={form.handleSubmit(onSubmit)}
          loading={inviteMemberMutation.isPending}
        >
          <Icon as={MailIcon} className="text-white" />
          <Text>Send invitation{fields.length > 1 ? "s" : ""}</Text>
        </Button>
      </View>
    </View>
  );
};
