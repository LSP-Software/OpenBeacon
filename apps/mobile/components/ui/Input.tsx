import { type RefObject, useState } from "react";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Platform, TextInput, type TextInputProps, View } from "react-native";
import { cn } from "../../lib/cn";
import { Field, FieldDescription, FieldError, FieldLabel } from "./Field";

type FormInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> = Omit<
  TextInputProps,
  "value" | "onChangeText"
> & {
  control: Control<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  fieldClassName?: string;
  hideError?: boolean;
  descriptionPosition?: "aboveInput" | "belowInput";
  inputRef?: ((instance: TextInput | null) => void) | RefObject<TextInput | null>;
};

function Input<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  label,
  description,
  fieldClassName,
  hideError = false,
  className,
  onBlur,
  onFocus,
  inputRef,
  descriptionPosition = "aboveInput",
  ...props
}: FormInputProps<TFieldValues, TName>) {
  const [inputFocused, setInputFocused] = useState(false);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        return (
          <Field data-invalid={fieldState.invalid}>
            {(label || description) && (
              <View
                className={"flex flex-col"}
                accessible={Platform.OS === "web"}
                focusable={Platform.OS === "web"}
                importantForAccessibility={Platform.OS === "web" ? "auto" : "no"}
                pointerEvents={Platform.OS === "web" ? "auto" : "none"}
              >
                {label && (
                  <FieldLabel
                    className="text-lg font-medium"
                    {...(Platform.OS === "web" ? { htmlFor: name } : {})}
                  >
                    {label}
                  </FieldLabel>
                )}
                {description && <FieldDescription>{description}</FieldDescription>}
              </View>
            )}

            <TextInput
              {...field}
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
                `rounded-lg border border-border bg-input ${inputFocused && "border-primary"} py-4 px-4`,
                props.editable === false &&
                  cn(
                    "opacity-50",
                    Platform.select({
                      web: "disabled:pointer-events-none disabled:cursor-not-allowed",
                    }),
                  ),
                Platform.select({
                  web: cn(
                    "placeholder:text-muted-foreground selection:bg-primary outline-none transition-[color,box-shadow] md:text-sm",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
                  ),
                  native: "placeholder:text-secondary",
                }),
                className,
              )}
              {...props}
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}

export { Input };
