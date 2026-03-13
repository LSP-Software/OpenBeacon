import { forwardRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useColors } from "../lib/theme.ts";

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "email" | "password" | "name" | "off";
  textContentType?: "emailAddress" | "password" | "name" | "username" | "URL" | "none";
  returnKeyType?: "next" | "done" | "go";
  onSubmitEditing?: () => void;
};

export const FormInput = forwardRef<TextInput, Props>(function FormInput(
  {
    label,
    value,
    onChangeText,
    placeholder,
    secureTextEntry,
    keyboardType = "default",
    autoCapitalize = "sentences",
    autoComplete,
    textContentType,
    returnKeyType,
    onSubmitEditing,
  },
  ref,
) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <View className="gap-2">
      <Text className="text-foreground text-sm font-bold tracking-wide">{label.toUpperCase()}</Text>
      <View className={`rounded-lg border border-border bg-input ${focused && "border-primary"}`}>
        <TextInput
          ref={ref}
          className="py-4 px-4 text-foreground"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? label}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCorrect={false}
          spellCheck={false}
        />
      </View>
    </View>
  );
});
