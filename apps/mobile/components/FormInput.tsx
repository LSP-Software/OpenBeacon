import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
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
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: focused ? colors.primary : colors.textSecondary }]}>
        {label.toUpperCase()}
      </Text>
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.inputBackground,
            borderColor: focused ? colors.inputBorderFocused : colors.inputBorder,
          },
        ]}
      >
        <TextInput
          ref={ref}
          style={[styles.input, { color: colors.text }]}
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

const styles = StyleSheet.create({
  wrapper: {
    gap: 7,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  inputContainer: {
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
