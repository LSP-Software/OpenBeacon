import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import type { useTimelinePlayerCard } from "../../hooks/useTimelinePlayerCard.ts";
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
        className={card.collapsible ? "px-4 pb-3" : "px-4 pb-3 pt-3"}
        onLayout={card.onFullLayout}
      >
        {card.collapsible ? <View className="h-5" /> : null}
        <View onLayout={card.measure("content")}>{children}</View>
      </View>
      {card.collapsible ? (
        <Animated.View
          {...card.miniOnly}
          className="absolute inset-x-0 top-0 px-4 pb-1 pt-5"
          onLayout={card.onMiniLayout}
        >
          <View
            pointerEvents="box-none"
            className="flex-row items-center gap-3"
            onLayout={card.measure("miniRow")}
          >
            <View
              pointerEvents="none"
              style={card.miniSlots.play}
              onLayout={card.measure("miniPlay")}
            />
            <View
              pointerEvents="none"
              className="min-w-0 flex-1"
              onLayout={card.measure("miniColumn")}
            >
              <View style={card.miniSlots.clock} onLayout={card.measure("miniClock")} />
              <Text
                className="text-xs text-secondary"
                maxFontSizeMultiplier={1.5}
                numberOfLines={1}
              >
                {miniDate}
              </Text>
            </View>
            <View
              pointerEvents="none"
              style={card.miniSlots.speed}
              onLayout={card.measure("miniSpeed")}
            />
          </View>
          {miniScrubber}
        </Animated.View>
      ) : null}
      {card.collapsible ? (
        <View pointerEvents="box-none" className="absolute inset-x-0 top-0 items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={card.open ? "Collapse player" : "Expand player"}
            accessibilityState={{ expanded: card.open }}
            onPress={() => card.setExpanded(!card.open)}
            className="h-11 w-24 items-center pt-2"
          >
            <View className="h-1 w-9 rounded-full bg-border-strong" />
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  </View>
);
