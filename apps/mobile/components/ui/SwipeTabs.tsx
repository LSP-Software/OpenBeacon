import type { LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  type ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useColors } from "../../lib/theme.ts";
import { Icon } from "./Icon.tsx";
import { getExpandingTabLayouts, getSceneIndexFromOffset, getSwipeTabsIndex } from "./swipeTabs.ts";
import { Text } from "./Text.tsx";

export type SwipeTabsItem<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
};

export const SwipeTabs = <T extends string>({
  ariaLabel = "Swipe tabs",
  onValueChange,
  renderScene,
  tabs,
  value,
}: {
  ariaLabel?: string;
  onValueChange: (value: T) => void;
  renderScene: (value: T) => React.ReactNode;
  tabs: readonly SwipeTabsItem<T>[];
  value: T;
}) => {
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const scrollViewRef = useRef<ScrollView>(null);
  const hasMounted = useRef(false);
  const requestedValueRef = useRef<T | null>(null);
  const scrollX = useSharedValue(0);
  const [containerWidth, setContainerWidth] = useState(windowWidth);
  const [visited, setVisited] = useState<Set<T>>(() => new Set([value]));
  const pageGap = 16;
  const [barWidth, setBarWidth] = useState(0);
  const activeIndex = getSwipeTabsIndex(tabs, value);
  const pageWidth = Math.max(containerWidth, 1);
  const inputRange = tabs.map((_, index) => index * pageWidth);
  const layouts = getExpandingTabLayouts({ barWidth, tabCount: tabs.length });
  const activeLefts = layouts.map((pageLayouts, index) => pageLayouts[index]?.left ?? 0);
  const activeWidths = layouts.map((pageLayouts, index) => pageLayouts[index]?.width ?? 0);

  useEffect(() => {
    setVisited((currentVisited) => {
      if (currentVisited.has(value)) {
        return currentVisited;
      }

      const nextVisited = new Set(currentVisited);
      nextVisited.add(value);
      return nextVisited;
    });
  }, [value]);

  useEffect(() => {
    const nextScrollPosition = activeIndex * pageWidth;

    if (!hasMounted.current) {
      scrollX.value = nextScrollPosition;
      scrollViewRef.current?.scrollTo({
        x: nextScrollPosition,
        animated: false,
      });
      hasMounted.current = true;
      return;
    }

    if (requestedValueRef.current !== null) {
      return;
    }

    scrollX.value = nextScrollPosition;
    scrollViewRef.current?.scrollTo({
      x: nextScrollPosition,
      animated: false,
    });
  }, [activeIndex, pageWidth, scrollX]);

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);

    if (nextWidth > 0 && nextWidth !== containerWidth) {
      setContainerWidth(nextWidth);
    }
  };

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.x;
    const requestedValue = requestedValueRef.current;

    if (requestedValue) {
      requestedValueRef.current = null;

      if (requestedValue !== value) {
        onValueChange(requestedValue);
      }

      return;
    }

    const nextIndex = getSceneIndexFromOffset({
      offset,
      pageWidth,
      sceneCount: tabs.length,
    });
    const nextTab = tabs[nextIndex];

    if (nextTab && nextTab.value !== value) {
      onValueChange(nextTab.value);
    }
  };

  const handleTabPress = (tabValue: T) => {
    if (tabValue !== value) {
      const nextIndex = getSwipeTabsIndex(tabs, tabValue);
      requestedValueRef.current = tabValue;

      scrollViewRef.current?.scrollTo({
        x: nextIndex * pageWidth,
        animated: true,
      });

      onValueChange(tabValue);
    }
  };

  const indicatorStyle = useAnimatedStyle(() => {
    if (barWidth === 0 || inputRange.length === 0) {
      return { opacity: 0 };
    }

    return {
      opacity: 1,
      left: interpolate(scrollX.value, inputRange, activeLefts, Extrapolation.CLAMP),
      width: interpolate(scrollX.value, inputRange, activeWidths, Extrapolation.CLAMP),
    };
  });

  const overlayTrackStyle = useAnimatedStyle(() => {
    if (barWidth === 0 || inputRange.length === 0) {
      return { opacity: 0 };
    }

    return {
      opacity: 1,
      transform: [
        {
          translateX: -interpolate(scrollX.value, inputRange, activeLefts, Extrapolation.CLAMP),
        },
      ],
    };
  });

  return (
    <View className="gap-4">
      <View
        className="rounded-2xl p-1"
        style={{ backgroundColor: colors.isDark ? "#0F0C1A" : "#EEE6FA" }}
        accessibilityLabel={ariaLabel}
        accessibilityRole="tablist"
      >
        <View
          className="relative h-11"
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            if (nextWidth !== barWidth) setBarWidth(nextWidth);
          }}
        >
          {barWidth > 0
            ? tabs.map((tab, index) => {
                const isActive = tab.value === value;

                return (
                  <ExpandingTabSlot
                    key={tab.value}
                    inputRange={inputRange}
                    layouts={layouts.map(
                      (pageLayouts) => pageLayouts[index] ?? { left: 0, width: 0 },
                    )}
                    scrollX={scrollX}
                  >
                    <Pressable
                      onPress={() => handleTabPress(tab.value)}
                      accessibilityRole="tab"
                      accessibilityLabel={tab.label}
                      accessibilityState={{ selected: isActive }}
                      className="h-11 items-center justify-center"
                    >
                      {tab.icon ? (
                        <Icon as={tab.icon} size={20} color={colors.textSecondary} />
                      ) : (
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.textSecondary }}
                          numberOfLines={1}
                        >
                          {tab.label}
                        </Text>
                      )}
                    </Pressable>
                  </ExpandingTabSlot>
                );
              })
            : null}
          {barWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              accessible={false}
              className="absolute bottom-0 top-0 overflow-hidden rounded-xl"
              style={[indicatorStyle, { backgroundColor: colors.primary }]}
            >
              <Animated.View className="absolute inset-0" style={overlayTrackStyle}>
                {tabs.map((tab, index) => (
                  <ExpandingTabSlot
                    key={tab.value}
                    inputRange={inputRange}
                    layouts={layouts.map(
                      (pageLayouts) => pageLayouts[index] ?? { left: 0, width: 0 },
                    )}
                    scrollX={scrollX}
                  >
                    <View className="h-11 flex-row items-center justify-center gap-2 px-3">
                      {tab.icon ? <Icon as={tab.icon} size={18} color={colors.onPrimary} /> : null}
                      <Text
                        className="shrink text-sm font-semibold leading-none"
                        style={{ color: colors.onPrimary }}
                        numberOfLines={1}
                      >
                        {tab.label}
                      </Text>
                    </View>
                  </ExpandingTabSlot>
                ))}
              </Animated.View>
            </Animated.View>
          ) : null}
        </View>
      </View>

      <View onLayout={handleContainerLayout}>
        <Animated.ScrollView
          ref={scrollViewRef}
          horizontal
          nestedScrollEnabled
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          directionalLockEnabled
          onScroll={handleScroll}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          {tabs.map((tab, index) => (
            <View
              key={tab.value}
              style={{
                width: pageWidth,
                paddingLeft: index === 0 ? 0 : pageGap / 2,
                paddingRight: index === tabs.length - 1 ? 0 : pageGap / 2,
              }}
            >
              {visited.has(tab.value) ? renderScene(tab.value) : <View />}
            </View>
          ))}
        </Animated.ScrollView>
      </View>
    </View>
  );
};

const ExpandingTabSlot = ({
  children,
  inputRange,
  layouts,
  scrollX,
}: {
  children: React.ReactNode;
  inputRange: number[];
  layouts: { left: number; width: number }[];
  scrollX: SharedValue<number>;
}) => {
  const lefts = layouts.map((layout) => layout.left);
  const widths = layouts.map((layout) => layout.width);
  const style = useAnimatedStyle(() => ({
    left: interpolate(scrollX.value, inputRange, lefts, Extrapolation.CLAMP),
    width: interpolate(scrollX.value, inputRange, widths, Extrapolation.CLAMP),
  }));

  return (
    <Animated.View className="absolute bottom-0 top-0" style={style}>
      {children}
    </Animated.View>
  );
};
