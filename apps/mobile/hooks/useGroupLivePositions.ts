import { useLiveTrackingPositions } from "./useLiveTrackingPositions.ts";

export const useGroupLivePositions = (groupId: string) => useLiveTrackingPositions({ groupId });
