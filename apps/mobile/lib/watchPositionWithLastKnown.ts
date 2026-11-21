import { tryCatch } from "@openbeacon/shared";

export const watchPositionWithLastKnown = async <Position extends { timestamp: number }>({
  getLastKnownPosition,
  isWanted,
  onPosition,
  watchPosition,
}: {
  getLastKnownPosition: () => Promise<Position | null>;
  isWanted: () => boolean;
  onPosition: (position: Position) => void;
  watchPosition: (onPosition: (position: Position) => void) => Promise<{ remove: () => void }>;
}) => {
  let stopped = false;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  const deliver = (position: Position) => {
    if (stopped || !isWanted() || position.timestamp <= latestTimestamp) {
      return;
    }

    latestTimestamp = position.timestamp;
    onPosition(position);
  };

  void tryCatch(getLastKnownPosition()).then((lastKnown) => {
    if (lastKnown.data) {
      deliver(lastKnown.data);
    }
  });

  const watchResult = await tryCatch(watchPosition(deliver));
  if (watchResult.error) {
    stopped = true;
    throw watchResult.error;
  }

  const subscription = watchResult.data;
  return {
    remove: () => {
      stopped = true;
      subscription.remove();
    },
  };
};
