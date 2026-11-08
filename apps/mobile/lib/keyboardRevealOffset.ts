const REVEAL_MARGIN = 16;

export const keyboardRevealOffset = ({
  focusedTop,
  formBottom,
  viewportHeight,
}: {
  focusedTop: number;
  formBottom: number;
  viewportHeight: number;
}) =>
  Math.max(0, Math.min(formBottom + REVEAL_MARGIN - viewportHeight, focusedTop - REVEAL_MARGIN));
