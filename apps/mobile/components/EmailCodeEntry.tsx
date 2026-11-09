import { zodResolver } from "@hookform/resolvers/zod";
import { emailCodeSchema } from "@openbeacon/schemas";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import type { z } from "zod";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Text } from "./ui/Text.tsx";

const resendCooldownMs = 60_000;

export const EmailCodeEntry = ({
  email,
  submitLabel,
  onSubmit,
  onResend,
  notice,
  description = (
    <>
      We sent a 6-digit code to <Text className="font-semibold">{email}</Text>. It expires in 10
      minutes. If it hasn't arrived, check your spam folder.
    </>
  ),
}: {
  email: string;
  description?: React.ReactNode;
  submitLabel: string;
  onSubmit: (code: string) => Promise<string | undefined>;
  onResend: () => Promise<string | undefined>;
  notice?: string | undefined;
}) => {
  const form = useForm<z.infer<typeof emailCodeSchema>>({
    resolver: zodResolver(emailCodeSchema),
    mode: "onSubmit",
    defaultValues: { code: "" },
  });
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(notice ?? null);
  const [resendAvailableAt, setResendAvailableAt] = useState(() => Date.now() + resendCooldownMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (now >= resendAvailableAt) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [now, resendAvailableAt]);

  const secondsLeft = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));
  const resendDisabled = secondsLeft > 0 || resending;

  const submit = async ({ code }: z.infer<typeof emailCodeSchema>) => {
    setSubmitting(true);
    const error = await onSubmit(code);
    setSubmitting(false);
    if (error) form.setError("code", { message: error });
  };

  const resend = async () => {
    setResending(true);
    const error = await onResend();
    setResending(false);
    if (error) {
      setResendMessage(error);
      return;
    }
    setResendMessage("We've sent a new code. Earlier codes no longer work.");
    form.reset();
    setResendAvailableAt(Date.now() + resendCooldownMs);
    setNow(Date.now());
  };

  return (
    <View className="gap-4">
      <Text className="text-muted">{description}</Text>
      <Input
        control={form.control}
        name="code"
        label="Code"
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submitting ? undefined : form.handleSubmit(submit)}
      />
      <Button onPress={form.handleSubmit(submit)} loading={submitting}>
        <Text>{submitLabel}</Text>
      </Button>
      <Pressable
        className="items-center py-1"
        onPress={resend}
        disabled={resendDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: resendDisabled }}
      >
        <Text className={resendDisabled ? "text-muted" : "font-semibold text-primary-text"}>
          {resending
            ? "Sending a new code…"
            : secondsLeft > 0
              ? `Resend code in ${secondsLeft}s`
              : "Resend code"}
        </Text>
      </Pressable>
      {resendMessage ? (
        <Text className="text-center text-sm text-muted">{resendMessage}</Text>
      ) : null}
    </View>
  );
};
