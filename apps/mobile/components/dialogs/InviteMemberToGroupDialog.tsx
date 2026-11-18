import { Alert } from "../../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { LinkIcon, MailIcon, PlusIcon, QrCodeIcon, Trash2Icon } from "lucide-react-native";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api.ts";
import { limitAlert } from "../../lib/limitAlert.ts";
import { SharedInvite } from "./SharedInvite.tsx";
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
  canInviteEditors: boolean;
  isOwner: boolean;
}

export const InviteMemberToGroupDialog = ({
  open,
  setOpen,
  groupId,
  canInviteEditors,
  isOwner,
}: InviteMemberToGroupDialogProps) => {
  const [value, setValue] = useState("email");
  const seats = useQuery({
    ...trpc.groupInvites.seats.queryOptions({ groupId }),
    enabled: open,
    staleTime: 0,
  });
  const blocked = seats.data?.blockedBy ? seats.data : null;

  return (
    <Dialog open={open} onOpenChange={(open) => setOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
        </DialogHeader>
        {blocked ? (
          <View className="gap-2">
            <Text variant="large">
              {blocked.blockedBy === "GROUP_FULL" ? "Group full" : "No free seats"}
            </Text>
            <Text className="text-secondary">{blocked.message}</Text>
            <View className="mt-2 gap-2">
              {isOwner && blocked.blockedBy !== "GROUP_FULL" ? (
                <Link href="/account/usage" asChild>
                  <Button onPress={() => setOpen(false)}>
                    <Text>See usage</Text>
                  </Button>
                </Link>
              ) : null}
              <Button variant="secondary" onPress={() => setOpen(false)}>
                <Text>Done</Text>
              </Button>
            </View>
          </View>
        ) : (
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
                canInviteEditors={canInviteEditors}
              />
            </TabsContent>
            {open && <SharedInvite groupId={groupId} open={open} setOpen={setOpen} value={value} />}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

interface InviteMembersInputsProps {
  canInviteEditors: boolean;
  groupId: string;
  setOpen: (open: boolean) => void;
}

export const InviteMembersInputs = ({
  groupId,
  setOpen,
  canInviteEditors,
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
  const onSubmit = async (data: z.infer<typeof inviteMemberToGroupSchema>) => {
    const result = await tryCatch(
      inviteMemberMutation.mutateAsync({
        ...data,
        invites: canInviteEditors
          ? data.invites
          : data.invites.map((invite) => ({ ...invite, role: "MEMBER" as const })),
      }),
    );
    if (result.error) {
      const limit = limitAlert(result.error);
      Alert.alert(limit?.title ?? "Unable to send invitation", result.error.message);
      return;
    }
    form.reset();
    setOpen(false);
  };

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
                {canInviteEditors && (
                  <View>
                    <FormSelectInput
                      control={form.control}
                      name={`invites.${index}.role`}
                      fieldClassName="w-28"
                      values={[
                        { label: "Editor", value: "EDITOR" },
                        { label: "Member", value: "MEMBER" },
                      ]}
                    />
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove this email"
                  className="size-[52px] items-center justify-center"
                  onPress={() => handleRemoveInvite(index)}
                >
                  <Icon as={Trash2Icon} className="text-destructive-text size-5" />
                </Pressable>
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
          {canInviteEditors && (
            <Text className="text-secondary text-sm">
              <Text className="text-foreground text-sm font-semibold">Editor:</Text> Can view
              locations, invite people, remove Members, and change the group’s name, picture and
              places
            </Text>
          )}
        </View>
        <Button onPress={form.handleSubmit(onSubmit)} loading={inviteMemberMutation.isPending}>
          <Icon as={MailIcon} className="text-white" />
          <Text>Send invitation{fields.length > 1 ? "s" : ""}</Text>
        </Button>
      </View>
    </View>
  );
};
