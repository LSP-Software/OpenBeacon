import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  HANDLE_HEIGHT,
  MINI_CLOCK_LEFT,
  MINI_LINE_TOP,
  type useTimelinePlayerCard,
} from "../../hooks/useTimelinePlayerCard.ts";
import { Text } from "../ui/Text.tsx";

type PlayerCard = ReturnType<typeof useTimelinePlayerCard>;

export const TimelineCardShared = ({
  children,
  motion,
}: {
  children: ReactNode;
  motion: PlayerCard["shared"]["clock"];
}) => (
  <View onLayout={motion.onLayout}>
    <Animated.View style={motion.style}>{children}</Animated.View>
  </View>
);

export const TimelinePlayerCard = ({
  bottom,
  card,
  children,
  miniDate,
  miniScrubber,
}: {
  bottom: number;
  card: PlayerCard;
  children: ReactNode;
  miniDate: string;
  miniScrubber: ReactNode;
}) => (
  <View
    className="absolute left-3 right-3 rounded-2xl border border-border bg-card shadow-md shadow-black/15"
    style={{ bottom }}
    {...card.panHandlers}
  >
    <Animated.View className="overflow-hidden rounded-2xl" style={card.heightStyle}>
      <View
        className={card.canCollapse ? "px-4 pb-3" : "px-4 pb-3 pt-3"}
        onLayout={card.onFullLayout}
      >
        {card.canCollapse ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={card.open ? "Collapse player" : "Expand player"}
            accessibilityState={{ expanded: card.open }}
            onPress={() => card.setExpanded(!card.open)}
            className="items-center justify-center"
            style={{ height: HANDLE_HEIGHT }}
          >
            <View className="h-1 w-9 rounded-full bg-border-strong" />
          </Pressable>
        ) : null}
        {children}
      </View>
      {card.canCollapse ? (
        <Animated.View
          {...card.miniOnly}
          className="absolute inset-x-0 top-0 px-4"
          style={[card.miniOnly.style, { paddingTop: HANDLE_HEIGHT }]}
        >
          <Text
            pointerEvents="none"
            className="text-xs text-secondary"
            numberOfLines={1}
            style={{ marginLeft: MINI_CLOCK_LEFT, marginTop: 30 }}
          >
            {miniDate}
          </Text>
          <View className="absolute inset-x-4" style={{ top: HANDLE_HEIGHT + MINI_LINE_TOP }}>
            {miniScrubber}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  </View>
);
