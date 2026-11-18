import { CheckIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

type Person = {
  color: string;
  decrypted: number;
  done: boolean;
  name: string;
  total: number;
  userId: string;
};

export const TimelineDecryptCard = ({
  loading,
  people,
  top,
}: {
  loading: boolean;
  people: readonly Person[] | null;
  top: number;
}) => {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(loading);
  const opacity = useRef(new Animated.Value(loading ? 1 : 0)).current;

  useEffect(() => {
    if (loading) {
      setMounted(true);
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    if (reduceMotion) {
      setMounted(false);
      return;
    }
    const fade = Animated.timing(opacity, {
      delay: 350,
      duration: 300,
      easing: Easing.out(Easing.quad),
      toValue: 0,
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => fade.stop();
  }, [loading, opacity, reduceMotion]);

  if (!mounted) return null;
  const ready = people?.filter((person) => person.done).length ?? 0;
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute left-6 right-6 gap-3 rounded-2xl bg-foreground p-4 shadow-md shadow-black/30"
      style={{ opacity, top }}
    >
      <View className="gap-0.5">
        <Text className="font-semibold text-background">Decrypting on this phone…</Text>
        <Text accessibilityLiveRegion="polite" className="text-xs text-background opacity-70">
          {!people
            ? "Downloading locations"
            : `${ready} of ${people.length} ${people.length === 1 ? "person" : "people"} ready`}
        </Text>
      </View>
      {people?.map((person, index) => (
        <DecryptRow key={person.userId} index={index} person={person} reduceMotion={reduceMotion} />
      ))}
    </Animated.View>
  );
};

const DecryptRow = ({
  index,
  person,
  reduceMotion,
}: {
  index: number;
  person: Person;
  reduceMotion: boolean;
}) => {
  const fraction = person.total > 0 ? person.decrypted / person.total : 1;
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const bar = useRef(new Animated.Value(reduceMotion ? fraction : 0)).current;
  const check = useRef(new Animated.Value(person.done ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      appear.setValue(1);
      return;
    }
    const animation = Animated.timing(appear, {
      delay: index * 70,
      duration: 220,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [appear, index, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      bar.setValue(fraction);
      return;
    }
    const animation = Animated.timing(bar, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
      toValue: fraction,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [bar, fraction, reduceMotion]);

  useEffect(() => {
    if (!person.done || reduceMotion) {
      check.setValue(person.done ? 1 : 0);
      return;
    }
    const animation = Animated.spring(check, {
      friction: 6,
      tension: 140,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [check, person.done, reduceMotion]);

  return (
    <Animated.View
      accessible
      accessibilityLabel={
        person.done
          ? `${person.name}, done`
          : `${person.name}, ${person.decrypted.toLocaleString()} of ${person.total.toLocaleString()} locations`
      }
      className="gap-1.5"
      style={{
        opacity: appear,
        transform: [
          { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
        ],
      }}
    >
      <View className="flex-row items-center gap-2">
        <View className="size-2.5 rounded-full" style={{ backgroundColor: person.color }} />
        <Text className="flex-1 text-sm font-semibold text-background" numberOfLines={1}>
          {person.name}
        </Text>
        {person.done ? (
          <Animated.View
            className="flex-row items-center gap-1"
            style={{
              opacity: check,
              transform: [
                { scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
              ],
            }}
          >
            <Icon as={CheckIcon} size={14} className="text-background" />
            <Text className="text-xs text-background">Done</Text>
          </Animated.View>
        ) : (
          <Text className="text-xs text-background opacity-70">
            {person.decrypted.toLocaleString()} of {person.total.toLocaleString()}
          </Text>
        )}
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-background/20">
        <Animated.View
          className="h-full rounded-full"
          style={{
            backgroundColor: person.color,
            transform: [{ scaleX: bar }],
            transformOrigin: "left",
          }}
        />
      </View>
    </Animated.View>
  );
};
