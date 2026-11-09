import { zodResolver } from "@hookform/resolvers/zod";
import { emailCodeSchema } from "@openbeacon/schemas";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import type { z } from "zod";
import {
  codeEntryErrorMessage,
  invalidCodeMessage,
  noCodeRejections,
  recordCodeRejection,
  recordNewCode,
} from "../lib/emailCodes.ts";
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
  resentMessage = "We've sent a new code. Earlier codes no longer work.",
  repeatedInvalidCodeHint = "If new codes keep being rejected, wait a few hours and try again.",
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
  resentMessage?: string;
  repeatedInvalidCodeHint?: string;
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
  const codeRejections = useRef(noCodeRejections);

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
    if (!error) return;
    if (error === invalidCodeMessage) {
      codeRejections.current = recordCodeRejection(codeRejections.current);
    }
    form.setError("code", {
      message: codeEntryErrorMessage(error, codeRejections.current, repeatedInvalidCodeHint),
    });
  };

  const resend = async () => {
    form.clearErrors("code");
    setResending(true);
    const error = await onResend();
    setResending(false);
    setResendAvailableAt(Date.now() + resendCooldownMs);
    setNow(Date.now());
    if (error) {
      setResendMessage(error);
      return;
    }
    codeRejections.current = recordNewCode(codeRejections.current);
    setResendMessage(resentMessage);
    form.reset();
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
