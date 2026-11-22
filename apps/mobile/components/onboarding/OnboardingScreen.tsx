import { Stack, useFocusEffect } from "expo-router";
import { ArrowLeftIcon } from "lucide-react-native";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cn } from "../../lib/cn.ts";
import {
  advanceOnboarding,
  goToOnboardingStep,
  readOnboardingPosition,
} from "../../lib/onboarding.ts";
import type { OnboardingStep } from "../../lib/onboardingTypes.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { screenTitleClass } from "./screenTitleClass.ts";

export const useAdvanceOnboardingOnce = () => {
  const advanced = useRef(false);
  return useCallback((steps: Parameters<typeof advanceOnboarding>[0]) => {
    if (advanced.current) return;
    advanced.current = true;
    advanceOnboarding(steps);
  }, []);
};

export const OnboardingProgress = ({ step }: { step: OnboardingStep }) => {
  const [position] = useState(() => readOnboardingPosition(step));
  const previous = position?.previous ?? null;
  const leaving = useRef(false);

  const goBack = useCallback(() => {
    if (!previous || leaving.current) return;
    leaving.current = true;
    goToOnboardingStep(previous);
  }, [previous]);

  useFocusEffect(
    useCallback(() => {
      if (!position) return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        goBack();
        return true;
      });
      return () => subscription.remove();
    }, [position, goBack]),
  );

  if (!position) return null;

  return (
    <View className="flex-row items-center gap-2 px-2 pt-1">
      {previous ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          className="size-11 items-center justify-center rounded-full active:bg-container"
        >
          <Icon as={ArrowLeftIcon} className="text-foreground size-6" />
        </Pressable>
      ) : (
        <View className="size-11" />
      )}
      <View
        className="flex-1 flex-row gap-1"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {Array.from({ length: position.total }, (_, index) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full",
              index < position.number ? "bg-primary" : "bg-container",
            )}
          />
        ))}
      </View>
      <Text
        className="text-tertiary w-14 text-right text-sm"
        accessibilityLabel={`Step ${position.number} of ${position.total}`}
      >
        {position.number} of {position.total}
      </Text>
    </View>
  );
};

export const OnboardingScreen = ({
  step,
  illustration,
  title,
  description,
  children,
  primary,
  secondary,
}: {
  step?: OnboardingStep;
  illustration?: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
  primary: {
    label: string;
    onPress: () => void;
    loading?: boolean | undefined;
    disabled?: boolean | undefined;
  };
  secondary?: { label: string; onPress: () => void; disabled?: boolean | undefined } | undefined;
}) => (
  <SafeAreaView className="flex-1 bg-background">
    <Stack.Screen options={{ gestureEnabled: false }} />
    {step && <OnboardingProgress step={step} />}
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-grow gap-6 px-5 py-5"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {illustration}
      <View className="gap-3">
        <Text accessibilityRole="header" className={screenTitleClass}>
          {title}
        </Text>
        <Text className="text-secondary text-base">{description}</Text>
      </View>
      {children}
    </ScrollView>
    <View className="gap-2 px-5 pb-6 pt-2">
      <Button
        accessibilityLabel={primary.label}
        onPress={primary.onPress}
        loading={primary.loading ?? false}
        disabled={primary.disabled ?? false}
      >
        <Text>{primary.label}</Text>
      </Button>
      {secondary && (
        <Button
          variant="ghost"
          accessibilityLabel={secondary.label}
          onPress={secondary.onPress}
          disabled={secondary.disabled ?? false}
        >
          <Text>{secondary.label}</Text>
        </Button>
      )}
    </View>
  </SafeAreaView>
);

export const OnboardingNote = ({ text }: { text: string }) => (
  <View className="rounded-3xl bg-container px-4 py-3">
    <Text className="text-foreground text-sm leading-5">{text}</Text>
  </View>
);

export const OnboardingPoint = ({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof Icon>["as"];
  title: string;
  description: string;
}) => (
  <View className="flex-row gap-4 rounded-3xl bg-card p-4">
    <View className="size-10 items-center justify-center rounded-full bg-primary-soft">
      <Icon as={icon} className="text-primary-soft-foreground size-5" />
    </View>
    <View className="flex-1 gap-1">
      <Text className="text-foreground text-base font-semibold">{title}</Text>
      <Text className="text-secondary text-sm">{description}</Text>
    </View>
  </View>
);
