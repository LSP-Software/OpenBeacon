import { zodResolver } from "@hookform/resolvers/zod";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { Link } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/Dialog.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Input } from "../../../components/ui/Input.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { trpc } from "../../../lib/api.ts";
import { authClient } from "../../../lib/auth-client.ts";

const schema = z.object({ name: accountNameSchema });

const ProfileScreen = () => {
  const { data: session, refetch } = authClient.useSession();
  const queryClient = useQueryClient();
  const [nameOpen, setNameOpen] = useState(false);
  const updateName = useMutation(trpc.account.updateName.mutationOptions());
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (session?.user.name) form.reset({ name: session.user.name });
  }, [session?.user.name, form.reset]);

  const save = async ({ name }: z.infer<typeof schema>) => {
    const result = await tryCatch(updateName.mutateAsync({ name }));
    if (result.error) {
      Alert.alert("Unable to update name", result.error.message);
      return;
    }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({
        queryKey: trpc.groupMembership.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.groupMembership.members.queryKey(),
      }),
    ]);
    setNameOpen(false);
    Alert.alert("Profile updated", "Your name has been saved.");
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="gap-4 p-6">
        <Text className="text-2xl font-bold">Manage Profile</Text>
        <Text>{session?.user.name}</Text>
        <Button onPress={() => setNameOpen(true)}>
          <Text>Change name</Text>
        </Button>
        <Dialog
          open={nameOpen}
          onOpenChange={(open) => {
            setNameOpen(open);
            if (!open) form.reset({ name: session?.user.name ?? "" });
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change name</DialogTitle>
            </DialogHeader>
            <Input
              control={form.control}
              name="name"
              label="Name"
              autoCapitalize="words"
              autoComplete="name"
            />
            <Button onPress={form.handleSubmit(save)} disabled={updateName.isPending}>
              <Text>Save name</Text>
            </Button>
          </DialogContent>
        </Dialog>
        <Link href="/account/delete" asChild>
          <Button variant="outline">
            <Text>Delete account</Text>
          </Button>
        </Link>
      </View>
    </SafeAreaView>
  );
};

export default ProfileScreen;
