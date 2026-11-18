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
