import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { type TextInputProps, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/Field.tsx";
import {
  type Option,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select.tsx";

type FormInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> = Omit<
  TextInputProps,
  "value" | "onChangeText" | "onBlur" | "onFocus"
> & {
  control: Control<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  fieldClassName?: string;
  values: Option[];
  placeholder?: string;
};

export const FormSelectInput = <
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  placeholder = "Select a value",
  fieldClassName = "",
  className,
  values,
  ...props
}: FormInputProps<TFieldValues, TName>) => {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        return (
          <Field data-invalid={fieldState.invalid} className={cn(fieldClassName, className)}>
            {(label || description) && (
              <View className="mb-2 flex flex-col">
                {label && (
                  <FieldLabel className="text-lg font-medium" htmlFor={name}>
                    {label}
                  </FieldLabel>
                )}
                {description && <FieldDescription>{description}</FieldDescription>}
              </View>
            )}
            <Select
              {...props}
              value={{
                label: values.find((option) => option?.value === field.value)?.label ?? "",
                value: field.value,
              }}
              defaultValue={field.value}
              onValueChange={(option) => {
                field.onChange(option?.value ?? "N/A", {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger className="h-[52px] w-full rounded-lg border border-border-strong bg-input">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {values.map((value) => (
                    <SelectItem
                      key={value?.value}
                      label={value?.label ?? ""}
                      value={value?.value ?? ""}
                    >
                      {value?.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
};
