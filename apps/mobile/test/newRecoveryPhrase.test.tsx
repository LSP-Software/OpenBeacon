import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-screen-capture", () => ({
  allowScreenCaptureAsync: async () => {},
  disableAppSwitcherProtectionAsync: async () => {},
  enableAppSwitcherProtectionAsync: async () => {},
  preventScreenCaptureAsync: async () => {},
}));
mock.module("react-native", () => ({ View }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/recovery.ts", () => ({
  confirmsRecoveryPhrase: () => true,
  pickConfirmationIndexes: () => [0, 1, 2],
}));
mock.module("../components/RecoveryPhraseGrid.tsx", () => ({
  RecoveryPhraseGrid: (props: object) => React.createElement("phrase-grid", props),
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
    React.createElement("test-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));

const { NewRecoveryPhrase } = await import("../components/NewRecoveryPhrase.tsx");

test("keeps the entered words when confirming fails, so they don't need typing again", async () => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <NewRecoveryPhrase
        onConfirm={async () => {}}
        submitLabel="Confirm"
        submittingLabel="Setting up…"
      />,
    ),
  );
  const [writtenDown] = root.container.queryAll((item) => item.type === "test-button");
  if (!writtenDown) throw new Error("Missing the written-down button");
  await act(async () => (writtenDown.props as { onPress: () => void }).onPress());
  const grid = () =>
    root.container.queryAll((item) => item.type === "phrase-grid")[0]?.props as {
      words: string[];
      onChangeWords: (words: string[]) => void;
      onSubmit: () => Promise<void>;
    };
  await act(async () => grid().onChangeWords(["apple", "banana", "cherry"]));

  await act(async () => grid().onSubmit());

  expect(grid().words).toEqual(["apple", "banana", "cherry"]);
  await act(async () => root.unmount());
});
