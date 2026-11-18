import { Alert } from "../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation } from "@tanstack/react-query";
import { LinkIcon, MailIcon, PlusIcon, QrCodeIcon, Trash2Icon } from "lucide-react-native";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api.ts";
import { useSingleFlight } from "../../lib/useSingleFlight.ts";
import { SharedInvite } from "./SharedInvite.tsx";
import { FormSelectInput } from "../formInputs/FormSelectInput.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Input } from "../ui/Input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs.tsx";
import { Text } from "../ui/Text.tsx";
import { userMessage } from "../../lib/userMessage.ts";

interface InviteMemberToGroupDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  groupId: string;
  canInviteAdmins: boolean;
}

export const InviteMemberToGroupDialog = ({
  open,
  setOpen,
  groupId,
  canInviteAdmins,
}: InviteMemberToGroupDialogProps) => {
  const [value, setValue] = useState("email");
  const { height } = useWindowDimensions();

  return (
    <Dialog open={open} onOpenChange={(open) => setOpen(open)}>
      <DialogContent style={{ maxHeight: height - 32 }}>
        <ScrollView
          className="shrink"
          contentContainerClassName="gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
          </DialogHeader>
          <Tabs value={value} onValueChange={setValue}>
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="email" className="flex-1">
                <Icon as={MailIcon} />
                <Text>Email</Text>
              </TabsTrigger>
              <TabsTrigger value="link" className="flex-1">
                <Icon as={LinkIcon} />
                <Text>Link / Code</Text>
              </TabsTrigger>
              <TabsTrigger value="qr" className="flex-1">
                <Icon as={QrCodeIcon} />
                <Text>QR code</Text>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="email" className="flex flex-col gap-4">
              <InviteMembersInputs
                groupId={groupId}
                setOpen={setOpen}
                canInviteAdmins={canInviteAdmins}
              />
            </TabsContent>
            {open && <SharedInvite groupId={groupId} open={open} setOpen={setOpen} value={value} />}
          </Tabs>
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
};

interface InviteMembersInputsProps {
  canInviteAdmins: boolean;
  groupId: string;
  setOpen: (open: boolean) => void;
}

export const InviteMembersInputs = ({
  groupId,
  setOpen,
  canInviteAdmins,
}: InviteMembersInputsProps) => {
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
  const submission = useSingleFlight<"send">();
  const onSubmit = (data: z.infer<typeof inviteMemberToGroupSchema>) =>
    submission.run("send", async () => {
      const result = await tryCatch(
        inviteMemberMutation.mutateAsync({
          ...data,
          invites: canInviteAdmins
            ? data.invites
            : data.invites.map((invite) => ({ ...invite, role: "MEMBER" as const })),
        }),
      );
      if (result.error) {
        Alert.alert("Unable to send invitation", userMessage(result.error));
        return;
      }
      form.reset();
      setOpen(false);
    });

  return (
    <View className="flex flex-col gap-4">
      <View className="flex flex-col gap-2">
        <Text variant="label">Email addresses</Text>
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
                />
                {canInviteAdmins && (
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
                )}
                {fields.length > 1 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove this email"
                    className="size-[52px] items-center justify-center"
                    onPress={() => handleRemoveInvite(index)}
                  >
                    <Icon as={Trash2Icon} className="text-destructive-text size-5" />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        <Button variant="ghost" size="sm" onPress={handleAddNewInvite} className="self-start">
          <Icon as={PlusIcon} className="text-primary-text size-4" />
          <Text>Add another email</Text>
        </Button>
      </View>
      <View className="flex flex-col gap-2">
        <Text variant="label">Role permissions</Text>
        <View className="flex flex-col gap-1 pb-2">
          <Text className="text-secondary text-sm">
            <Text className="text-foreground text-sm font-semibold">Member:</Text> Can view
            locations of all group members
          </Text>
          {canInviteAdmins && (
            <Text className="text-secondary text-sm">
              <Text className="text-foreground text-sm font-semibold">Admin:</Text> Can view
              locations, invite and remove members, and manage group settings
            </Text>
          )}
        </View>
        <Button onPress={form.handleSubmit(onSubmit)} loading={submission.isPending}>
          <Icon as={MailIcon} className="text-white" />
          <Text>Send invitation{fields.length > 1 ? "s" : ""}</Text>
        </Button>
      </View>
    </View>
  );
};
