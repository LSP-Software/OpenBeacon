export const getSwipeTabsIndex = <T extends string>(
  tabs: readonly { value: T }[],
  value: T,
): number => {
  const nextIndex = tabs.findIndex((tab) => tab.value === value);

  return Math.max(nextIndex, 0);
};

export const getSceneIndexFromOffset = ({
  offset,
  pageWidth,
  sceneCount,
}: {
  offset: number;
  pageWidth: number;
  sceneCount: number;
}): number => {
  if (pageWidth <= 0 || sceneCount <= 1) {
    return 0;
  }

  const unclampedIndex = Math.round(offset / pageWidth);

  return Math.min(Math.max(unclampedIndex, 0), sceneCount - 1);
};

export const getActiveSceneHeight = <T extends string>({
  sceneHeights,
  value,
}: {
  sceneHeights: Partial<Record<T, number>>;
  value: T;
}): number => {
  const activeSceneHeight = sceneHeights[value];

  if (typeof activeSceneHeight === "number" && activeSceneHeight > 0) {
    return activeSceneHeight;
  }

  const fallbackSceneHeight = Object.values(sceneHeights).find(
    (sceneHeight): sceneHeight is number =>
      typeof sceneHeight === "number" && Number.isFinite(sceneHeight) && sceneHeight > 0,
  );

  return fallbackSceneHeight ?? 1;
};

export const getExpandingTabLayouts = ({
  barWidth,
  tabCount,
}: {
  barWidth: number;
  tabCount: number;
}) => {
  const inactiveWidth = tabCount <= 1 ? barWidth : Math.max(44, Math.round(barWidth * 0.17));
  const activeWidth =
    tabCount <= 1 ? barWidth : Math.max(barWidth - inactiveWidth * (tabCount - 1), inactiveWidth);
  return Array.from({ length: tabCount }, (_, activeIndex) =>
    Array.from({ length: tabCount }, (_, index) => ({
      left:
        index <= activeIndex ? index * inactiveWidth : (index - 1) * inactiveWidth + activeWidth,
      width: index === activeIndex ? activeWidth : inactiveWidth,
    })),
  );
};
