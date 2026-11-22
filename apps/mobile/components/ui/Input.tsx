import { EyeIcon, EyeOffIcon } from "lucide-react-native";
import { type RefObject, useState } from "react";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Platform, Pressable, TextInput, type TextInputProps, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Field, FieldDescription, FieldError, FieldLabel } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import { Text } from "./Text.tsx";

type FormInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> = Omit<
  TextInputProps,
  "value" | "onChangeText"
> & {
  control: Control<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  fieldClassName?: string;
  inputRef?: ((instance: TextInput | null) => void) | RefObject<TextInput | null>;
};

function Input<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  label,
  description,
  fieldClassName,
  className,
  onBlur,
  onFocus,
  inputRef,
  secureTextEntry,
  ...props
}: FormInputProps<TFieldValues, TName>) {
  const [inputFocused, setInputFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPasswordInput = secureTextEntry === true;
  const outlined = Platform.OS !== "ios";

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        return (
          <Field data-invalid={fieldState.invalid}>
            {((label && !outlined) || description) && (
              <View className={"flex flex-col"}>
                {label && !outlined && (
                  <FieldLabel className="px-1 text-[13px] uppercase text-secondary">
                    {label}
                  </FieldLabel>
                )}
                {description && <FieldDescription>{description}</FieldDescription>}
              </View>
            )}

            <View className={cn("relative", fieldClassName)}>
              <TextInput
                value={field.value}
                autoComplete="off"
                accessibilityLabel={props.accessibilityLabel ?? label}
                onChangeText={field.onChange}
                ref={(instance) => {
                  field.ref(instance);
                  if (!inputRef) return;

                  if (typeof inputRef === "function") return inputRef(instance);
                  inputRef.current = instance;
                }}
                onFocus={(event) => {
                  onFocus?.(event);
                  setInputFocused(true);
                }}
                onBlur={(event) => {
                  onBlur?.(event);
                  setInputFocused(false);
                  field.onBlur();
                }}
                className={cn(
                  outlined
                    ? `h-14 rounded-[4px] border bg-input px-4 text-base text-foreground ${inputFocused ? "border-2 border-primary-text" : "border-border-strong"}`
                    : "h-[50px] rounded-[12px] bg-card px-4 text-[17px] text-foreground",
                  isPasswordInput && "pr-12",
                  props.editable === false && "opacity-50",
                  "placeholder:text-tertiary",
                  className,
                )}
                {...props}
                secureTextEntry={isPasswordInput ? !passwordVisible : secureTextEntry}
              />
              {outlined && label ? (
                <View pointerEvents="none" className="absolute -top-2 left-3 bg-background px-1">
                  <Text
                    className={cn(
                      "text-xs",
                      inputFocused ? "text-primary-text" : "text-secondary",
                      fieldState.invalid && "text-destructive-text",
                    )}
                  >
                    {label}
                  </Text>
                </View>
              ) : null}
              {isPasswordInput && (
                <Pressable
                  className="absolute right-4 top-0 bottom-0 justify-center"
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                  onPress={() => {
                    setPasswordVisible((current) => !current);
                  }}
                >
                  <Icon
                    as={passwordVisible ? EyeOffIcon : EyeIcon}
                    className="text-tertiary"
                    size={20}
                  />
                </Pressable>
              )}
            </View>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}

export { Input };
