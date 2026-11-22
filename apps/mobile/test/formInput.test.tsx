import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { useForm } from "react-hook-form";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host =
  (type: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(type, props, children);
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  Pressable: host("pressable"),
  TextInput: host("text-input"),
  View: host("view"),
}));
mock.module("lucide-react-native", () => ({ EyeIcon: () => null, EyeOffIcon: () => null }));
mock.module("../components/ui/Field.tsx", () => ({
  Field: host("view"),
  FieldDescription: host("view"),
  FieldError: () => null,
  FieldLabel: host("view"),
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: host("text") }));

const { Input } = await import("../components/ui/Input.tsx");

test("a native change event never replaces the typed value", async () => {
  let values: () => { name: string } = () => ({ name: "" });
  const Form = () => {
    const form = useForm<{ name: string }>({ defaultValues: { name: "Fam" } });
    values = form.getValues;
    return <Input control={form.control} name="name" />;
  };
  const root = createRoot();
  await act(async () => root.render(<Form />));
  const [input] = root.container.queryAll((item) => item.type === "text-input");
  const props = input?.props as {
    onChange?: (event: object) => void;
    onChangeText: (text: string) => void;
  };
  await act(async () => props.onChange?.({ nativeEvent: { text: "Fami" } }));

  expect(values().name).toBe("Fam");
  await act(async () => props.onChangeText("Fami"));
  expect(values().name).toBe("Fami");
  await act(async () => root.unmount());
});
