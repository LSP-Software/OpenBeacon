import { zodResolver } from "@hookform/resolvers/zod";
import { type createGroupSchema, inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CameraIcon,
  LinkIcon,
  MailIcon,
  SendIcon,
  Trash2Icon,
  TrashIcon,
} from "lucide-react-native";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { TextInput, View } from "react-native";
import type z from "zod";
import { trpc } from "../../lib/api";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { Text } from "../ui/Text";

interface InviteMemberToGroupDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const InviteMemberToGroupDialog = ({ open, setOpen }: InviteMemberToGroupDialogProps) => {
  const queryClient = useQueryClient();
  const inviteMemberToGroupMutation = useMutation(trpc.groups.inviteMember.mutationOptions());

  const form = useForm<z.infer<typeof inviteMemberToGroupSchema>>({
    resolver: zodResolver(inviteMemberToGroupSchema),
    mode: "all",
    defaultValues: {
      email: "",
      role: "MEMBER",
    },
    shouldFocusError: true,
  });

  const onSubmit = async (data: z.infer<typeof inviteMemberToGroupSchema>) => {
    await inviteMemberToGroupMutation.mutateAsync(data, {
      onError: (error) => {
        console.log("error", error);
      },
    });
  };

  const closeForm = () => {
    setOpen(false);
    form.reset();
  };
  const [value, setValue] = useState("email");

  return (
    <Dialog open={open} onOpenChange={(open) => setOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Invite a member to the group. They will receive an email with a link to join the group
            and start sharing locations privately.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={value} onValueChange={setValue}>
          <TabsList className="flex justify-center w-full bg-secondary">
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
            {/* <View className="flex flex-row items-center gap-4"> */}
            <InviteMembersInputs />
            {/* </View> */}
            <Button>
              <Icon as={MailIcon} className="text-white" />
              <Text>Send invitation</Text>
            </Button>
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
      email: "",
      role: "MEMBER",
    },
    shouldFocusError: true,
  });

  return (
    <View className="flex flex-row items-center justify-between gap-2 rounded-lg p-4">
      <Input
        control={form.control}
        name="email"
        label="Email"
        description="The email of the member to invite"
      />
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Select a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Fruits</SelectLabel>
            <SelectItem label="Apple" value="apple">
              Apple
            </SelectItem>
            <SelectItem label="Banana" value="banana">
              Banana
            </SelectItem>
            <SelectItem label="Blueberry" value="blueberry">
              Blueberry
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Icon className="text-destructive size-6" as={Trash2Icon} />
    </View>
  );
};
