import { Alert } from "../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "@openbeacon/schemas";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { EmailCodeEntry } from "../components/EmailCodeEntry.tsx";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { completeAuthenticatedSessionSetup } from "../lib/auth.ts";
import { authClient } from "../lib/auth-client.ts";
import { emailCodeErrorMessage, emailCodes } from "../lib/emailCodes.ts";
import { finishAuthentication } from "../lib/finishAuthentication.ts";

const resetFormSchema = signInSchema
  .extend({ confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

const ForgotPassword = () => {
  const params = useLocalSearchParams<{ joinCode?: string; email?: string }>();
  const [step, setStep] = useState<
    | { name: "email" }
    | { name: "code"; email: string; notice: string | undefined }
    | { name: "password"; email: string; resetToken: string }
  >({ name: "email" });
  const [loading, setLoading] = useState(false);
  const form = useForm<z.infer<typeof resetFormSchema>>({
    resolver: zodResolver(resetFormSchema),
    mode: "onTouched",
    defaultValues: { email: params.email ?? "", password: "", confirmPassword: "" },
    shouldFocusError: true,
  });

  const sendCode = async () => {
    if (!(await form.trigger("email"))) return;
    const email = resetFormSchema.shape.email.parse(form.getValues("email"));
    setLoading(true);
    const result = await emailCodes.requestPasswordReset(email);
    setLoading(false);
    if (result.error && result.error.status !== 429) {
      Alert.alert("Couldn't send a code", emailCodeErrorMessage(result.error));
      return;
    }
    setStep({
      name: "code",
      email,
      notice: result.error ? emailCodeErrorMessage(result.error) : undefined,
    });
  };

  const resetPassword = async ({ password }: z.infer<typeof resetFormSchema>) => {
    if (step.name !== "password") return;
    setLoading(true);
    const reset = await authClient.resetPassword({
      token: step.resetToken,
      newPassword: password,
    });
    if (reset.error) {
      setLoading(false);
      if (reset.error.code === "INVALID_TOKEN") {
        Alert.alert(
          "Enter a new code",
          "You took longer than 5 minutes to choose a password. Request a new code to try again.",
        );
        setStep({ name: "email" });
        return;
      }
      Alert.alert("Couldn't reset your password", reset.error.message);
      return;
    }

    const signedIn = await authClient.signIn.email({ email: step.email, password });
    const sessionSetup = signedIn.error ? null : await completeAuthenticatedSessionSetup();
    if (signedIn.error || sessionSetup?.error) {
      setLoading(false);
      Alert.alert(
        "Password reset",
        "Your password has been reset. Sign in with your new password.",
      );
      router.replace({ pathname: "/signIn", params: { joinCode: params.joinCode } });
      return;
    }
    await finishAuthentication({ joinCode: params.joinCode });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardFormScrollView contentContainerClassName="px-8 pt-2 pb-6 gap-6">
        {(formProps) => (
          <>
            <ReturnToHomeHeader />
            <View className="gap-2">
              <Text className="font-bold text-5xl">
                {step.name === "code" ? "Check your\nemail." : "Reset\npassword."}
              </Text>
              <Text className="text-lg text-muted">
                {step.name === "email"
                  ? "We'll email you a code to reset it"
                  : step.name === "code"
                    ? "Enter the code from your email"
                    : "Choose a new password"}
              </Text>
            </View>

            <View className="gap-4" {...formProps}>
              {step.name === "email" ? (
                <>
                  <Text className="text-muted">
                    A new password signs you back in, but it doesn't recover your encrypted location
                    history. Only your recovery phrase can do that, so keep it somewhere safe.
                  </Text>
                  <Input
                    control={form.control}
                    name="email"
                    label="Email"
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="done"
                    onSubmitEditing={sendCode}
                  />
                  <Button onPress={sendCode} disabled={loading}>
                    <Text>{loading ? "Sending code…" : "Send code"}</Text>
                  </Button>
                </>
              ) : step.name === "code" ? (
                <>
                  <EmailCodeEntry
                    email={step.email}
                    notice={step.notice}
                    description={
                      <>
                        If <Text className="font-semibold">{step.email}</Text> has an OpenBeacon
                        account with a password, we've sent it a 6-digit code. It expires in 10
                        minutes. If you sign in with Google, use Continue with Google instead.
                      </>
                    }
                    submitLabel="Continue"
                    onSubmit={async (code) => {
                      const result = await emailCodes.verifyPasswordResetCode(step.email, code);
                      if (result.error) return emailCodeErrorMessage(result.error);
                      setStep({
                        name: "password",
                        email: step.email,
                        resetToken: result.data.resetToken,
                      });
                      return undefined;
                    }}
                    onResend={async () => {
                      const result = await emailCodes.requestPasswordReset(step.email);
                      return result.error ? emailCodeErrorMessage(result.error) : undefined;
                    }}
                  />
                  <Pressable
                    className="items-center py-1"
                    onPress={() => setStep({ name: "email" })}
                    accessibilityRole="button"
                  >
                    <Text className="text-secondary">Use a different email</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text className="text-muted">
                    Choose a new password for <Text className="font-semibold">{step.email}</Text>{" "}
                    within 5 minutes. Resetting signs your account out on every phone. It doesn't
                    recover encrypted location history. For that you need your recovery phrase.
                  </Text>
                  <Input
                    control={form.control}
                    name="password"
                    label="New password"
                    placeholder="New password"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    autoFocus
                  />
                  <Input
                    control={form.control}
                    name="confirmPassword"
                    label="Confirm new password"
                    placeholder="Confirm new password"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={form.handleSubmit(resetPassword)}
                  />
                  <Button onPress={form.handleSubmit(resetPassword)} disabled={loading}>
                    <Text>{loading ? "Resetting password…" : "Reset password"}</Text>
                  </Button>
                </>
              )}
            </View>

            <View className="items-center gap-4 pt-2">
              <Link href={{ pathname: "/signIn", params: { joinCode: params.joinCode } }} asChild>
                <Pressable accessibilityRole="link">
                  <Text className="text-muted">
                    Remembered it? <Text className="font-semibold text-primary-text">Sign in</Text>
                  </Text>
                </Pressable>
              </Link>
            </View>
          </>
        )}
      </KeyboardFormScrollView>
    </SafeAreaView>
  );
};

export default ForgotPassword;
