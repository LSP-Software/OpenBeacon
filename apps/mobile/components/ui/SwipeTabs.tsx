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
import { cn } from "../../lib/cn.ts";
import { getSceneIndexFromOffset, getSwipeTabsIndex } from "./swipeTabs.ts";
import { Text } from "./Text.tsx";

export type SwipeTabsItem<T extends string> = {
  value: T;
  label: string;
  badge?: boolean;
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
    if (barWidth === 0) {
      return { opacity: 0 };
    }

    const tabWidth = barWidth / tabs.length;

    return {
      opacity: 1,
      width: tabWidth - 24,
      left:
        12 +
        interpolate(
          scrollX.value,
          [0, Math.max(tabs.length - 1, 1) * pageWidth],
          [0, Math.max(tabs.length - 1, 1) * tabWidth],
          Extrapolation.CLAMP,
        ),
    };
  });

  return (
    <View className="gap-4">
      <View
        className="flex-row border-b border-border"
        accessibilityLabel={ariaLabel}
        accessibilityRole="tablist"
        onLayout={(event) => {
          const nextWidth = Math.round(event.nativeEvent.layout.width);
          if (nextWidth !== barWidth) setBarWidth(nextWidth);
        }}
      >
        {tabs.map((tab) => (
          <Pressable
            key={tab.value}
            onPress={() => handleTabPress(tab.value)}
            accessibilityRole="tab"
            accessibilityLabel={tab.badge ? `${tab.label}, new activity` : tab.label}
            accessibilityState={{ selected: tab.value === value }}
            className="h-12 flex-1 flex-row items-center justify-center gap-1.5"
          >
            <Text
              className={cn(
                "text-base",
                tab.value === value
                  ? "text-foreground font-semibold"
                  : "text-secondary font-medium",
              )}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
            {tab.badge ? <View className="size-2 rounded-full bg-primary" /> : null}
          </Pressable>
        ))}
        <Animated.View
          pointerEvents="none"
          className="absolute -bottom-px h-[3px] rounded-t-full bg-primary"
          style={indicatorStyle}
        />
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
