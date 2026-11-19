import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { type Control, type FieldValues, useController } from "react-hook-form";
import { createRoot, type Root } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sent: unknown[] = [];
let finishSend: () => void = () => {};
const Host = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
  React.createElement("host", props, children);

mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  ScrollView: Host,
  useWindowDimensions: () => ({ height: 800, width: 400 }),
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutateAsync: (input: unknown) => {
      sent.push(input);
      return new Promise<void>((resolve) => {
        finishSend = resolve;
      });
    },
  }),
}));
mock.module("lucide-react-native", () => ({
  LinkIcon: () => null,
  MailIcon: () => null,
  PlusIcon: () => null,
  QrCodeIcon: () => null,
  Trash2Icon: () => null,
}));
mock.module("../lib/api.ts", () => ({
  trpc: { groupInvites: { send: { mutationOptions: () => ({}) } } },
}));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../components/dialogs/SharedInvite.tsx", () => ({ SharedInvite: () => null }));
mock.module("../components/formInputs/FormSelectInput.tsx", () => ({
  FormSelectInput: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Dialog.tsx", () => ({
  Dialog: Host,
  DialogContent: Host,
  DialogHeader: Host,
  DialogTitle: Host,
}));
mock.module("../components/ui/Tabs.tsx", () => ({
  Tabs: Host,
  TabsContent: Host,
  TabsList: Host,
  TabsTrigger: Host,
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: Host }));
mock.module("../components/ui/Input.tsx", () => ({
  Input: ({ control, name }: { control: Control<FieldValues>; name: string }) => {
    const { field } = useController({ control, name });
    return React.createElement("mock-input", { name, onChangeText: field.onChange });
  },
}));

const { InviteMembersInputs } = await import("../components/dialogs/InviteMemberToGroupDialog.tsx");

let root: Root;

const removeButtons = () =>
  root.container.queryAll(
    (item) => item.type === "pressable" && item.props["accessibilityLabel"] === "Remove this email",
  );

const press = async (label: string) => {
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes(label));
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => (button.props as { onPress: () => void }).onPress());
};

beforeEach(async () => {
  sent.length = 0;
  root = createRoot();
  await act(async () =>
    root.render(
      <InviteMembersInputs groupId="group-1" setOpen={() => {}} canInviteAdmins={false} />,
    ),
  );
});

test("the only email row can't be removed, so the form can't be emptied", async () => {
  expect(removeButtons()).toHaveLength(0);

  await press("Add another email");
  expect(removeButtons()).toHaveLength(2);

  const [firstRemove] = removeButtons();
  if (!firstRemove) throw new Error("Missing remove button");
  await act(async () => (firstRemove.props as { onPress: () => void }).onPress());
  expect(removeButtons()).toHaveLength(0);
  expect(root.container.queryAll((item) => item.type === "mock-input")).toHaveLength(1);
});

test("tapping Send twice sends the invitation once", async () => {
  const [input] = root.container.queryAll((item) => item.type === "mock-input");
  if (!input) throw new Error("Missing email input");
  await act(async () =>
    (input.props as { onChangeText: (value: string) => void }).onChangeText("a@example.com"),
  );

  const send = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Send invitation"));
  if (!send) throw new Error("Missing send button");
  const onPress = (send.props as { onPress: () => Promise<void> }).onPress;
  let submissions: Promise<void>[] = [];
  await act(async () => {
    submissions = [onPress(), onPress()];
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(sent).toHaveLength(1);
  await act(async () => {
    finishSend();
    await Promise.all(submissions);
  });
});
