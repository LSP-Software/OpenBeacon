import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { type Control, useController } from "react-hook-form";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host =
  (type: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(type, props, children);
const openChanges: boolean[] = [];
const { promise: created, resolve: finishCreating } = Promise.withResolvers<object>();

mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
  useQueryClient: () => ({ setQueryData: () => {} }),
}));
mock.module("lucide-react-native", () => ({ CameraIcon: () => null, XIcon: () => null }));
mock.module("react-native", () => ({
  ActivityIndicator: () => null,
  Image: () => null,
  Pressable: host("pressable"),
  View: host("view"),
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: host("mock-button") }));
mock.module("../components/ui/Dialog.tsx", () => ({
  Dialog: host("dialog"),
  DialogContent: host("view"),
  DialogDescription: host("view"),
  DialogHeader: host("view"),
  DialogTitle: host("view"),
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Input.tsx", () => ({
  Input: ({ control, name }: { control: Control<{ name: string }>; name: "name" }) => {
    const { field } = useController({ control, name });
    return React.createElement("mock-input", { onChangeText: field.onChange });
  },
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: host("text") }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    groupLifecycle: { create: { mutationOptions: () => ({}) } },
    groupMembership: { list: { queryKey: () => [] } },
  },
}));
mock.module("../lib/groupEncryption.ts", () => ({
  buildCreateGroupInput: async () => ({}),
  submitEpochChange: async () => {
    await created;
    return { newGroup: { id: "group-1" } };
  },
}));
mock.module("../lib/groupImageUpload.ts", () => ({ uploadNewGroupImage: async () => {} }));
mock.module("../lib/groupLimitAlert.ts", () => ({ groupLimitAlert: () => null }));
mock.module("../lib/image-upload.ts", () => ({ cleanupTempFile: () => {} }));
mock.module("../lib/imageKeys.ts", () => ({ storeOwnImageKeyInGroup: async () => {} }));
mock.module("../lib/pickImage.ts", () => ({
  pickImage: async () => null,
  processImage: async () => null,
}));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));

const { CreateGroupDialog } = await import("../components/dialogs/CreateGroupDialog.tsx");

test("the dialog can't be closed while the group is being created", async () => {
  const root = createRoot();
  await act(async () =>
    root.render(<CreateGroupDialog open setOpen={(open) => openChanges.push(open)} />),
  );
  const [input] = root.container.queryAll((item) => item.type === "mock-input");
  await act(async () =>
    (input!.props as { onChangeText: (text: string) => void }).onChangeText("Family"),
  );
  const create = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Create group"));
  await act(async () => {
    void (create!.props as { onPress: () => Promise<void> }).onPress();
  });
  const [dialog] = root.container.queryAll((item) => item.type === "dialog");
  await act(async () =>
    (dialog!.props as { onOpenChange: (open: boolean) => void }).onOpenChange(false),
  );

  expect(openChanges).toEqual([]);
  await act(async () => finishCreating({}));
  expect(openChanges).toEqual([false]);
  await act(async () => root.unmount());
});
