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
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useColors } from "../../lib/theme.ts";
import { Icon } from "./Icon.tsx";
import { getSceneIndexFromOffset, getSwipeTabsIndex } from "./swipeTabs.ts";
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
  const [tabLayouts, setTabLayouts] = useState<Partial<Record<T, { x: number; width: number }>>>(
    {},
  );
  const activeIndex = getSwipeTabsIndex(tabs, value);
  const pageWidth = Math.max(containerWidth, 1);
  const inputRange = tabs.map((_, index) => index * pageWidth);
  const indicatorLeftRange = tabs.map((tab) => tabLayouts[tab.value]?.x ?? 0);
  const indicatorWidthRange = tabs.map((tab) => tabLayouts[tab.value]?.width ?? 0);
  const hasAllTabLayouts = tabs.every((tab) => tabLayouts[tab.value] !== undefined);

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

  const handleTabLayout =
    (tabValue: T) =>
    (event: LayoutChangeEvent): void => {
      const nextLayout = {
        x: event.nativeEvent.layout.x,
        width: event.nativeEvent.layout.width,
      };

      setTabLayouts((currentLayouts) => {
        const currentLayout = currentLayouts[tabValue];

        if (
          currentLayout &&
          currentLayout.x === nextLayout.x &&
          currentLayout.width === nextLayout.width
        ) {
          return currentLayouts;
        }

        return {
          ...currentLayouts,
          [tabValue]: nextLayout,
        };
      });
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
    if (!hasAllTabLayouts || inputRange.length === 0) {
      return {
        opacity: 0,
      };
    }

    return {
      opacity: 1,
      left: interpolate(scrollX.value, inputRange, indicatorLeftRange, Extrapolation.CLAMP),
      width: interpolate(scrollX.value, inputRange, indicatorWidthRange, Extrapolation.CLAMP),
    };
  });

  const overlayTrackStyle = useAnimatedStyle(() => {
    if (!hasAllTabLayouts || inputRange.length === 0) {
      return {
        opacity: 0,
      };
    }

    const left = interpolate(scrollX.value, inputRange, indicatorLeftRange, Extrapolation.CLAMP);

    return {
      opacity: 1,
      transform: [{ translateX: -left }],
    };
  });

  const renderTabFace = ({ tab, textColor }: { tab: SwipeTabsItem<T>; textColor: string }) => {
    return (
      <View className="min-h-11 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2">
        {tab.icon ? <Icon as={tab.icon} size={16} color={textColor} /> : null}
        <Text
          className="text-center text-sm font-semibold leading-none"
          style={{ color: textColor }}
        >
          {tab.label}
        </Text>
      </View>
    );
  };

  return (
    <View className="gap-4">
      <View
        className="relative flex-row rounded-2xl p-1"
        style={{ backgroundColor: colors.isDark ? "#0F0C1A" : "#EEE6FA" }}
        accessibilityLabel={ariaLabel}
      >
        <Animated.View
          pointerEvents="none"
          className="absolute bottom-1 top-1 rounded-xl"
          style={[
            indicatorStyle,
            {
              backgroundColor: colors.primary,
            },
          ]}
        />
        {tabs.map((tab) => {
          const isActive = tab.value === value;

          return (
            <Pressable
              key={tab.value}
              onPress={() => handleTabPress(tab.value)}
              onLayout={handleTabLayout(tab.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              className="flex-1"
            >
              {renderTabFace({
                tab,
                textColor: colors.textSecondary,
              })}
            </Pressable>
          );
        })}
        {hasAllTabLayouts ? (
          <Animated.View
            pointerEvents="none"
            accessible={false}
            className="absolute bottom-1 top-1 overflow-hidden rounded-xl"
            style={indicatorStyle}
          >
            <Animated.View className="absolute inset-0" style={overlayTrackStyle}>
              {tabs.map((tab) => {
                const tabLayout = tabLayouts[tab.value];

                if (!tabLayout) {
                  return null;
                }

                return (
                  <View
                    key={tab.value}
                    className="absolute top-0"
                    style={{
                      left: tabLayout.x,
                      width: tabLayout.width,
                    }}
                  >
                    {renderTabFace({
                      tab,
                      textColor: colors.onPrimary,
                    })}
                  </View>
                );
              })}
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>

      <View onLayout={handleContainerLayout}>
        <Animated.ScrollView
          ref={scrollViewRef}
          horizontal
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
