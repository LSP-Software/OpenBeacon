import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import type { DeviceIcon } from "./deviceIcons.ts";

export type MapPerson = {
  groupNames: string[];
  image: string | null;
  initials: string;
  isSelf: boolean;
  name: string;
  userId: string;
};

export type MapPersonStatus = "cantLocate" | "cantRead" | "hidden";

export type MapUnreadablePerson = MapPerson & {
  groupId: string;
  groupName: string;
  reason: "groupKey" | "point";
};

export type MapHiddenPerson = MapPerson & {
  hiddenGroups: { id: string; name: string }[];
};

export type MapPeople = {
  cantLocate: MapPerson[];
  connectionLost: boolean;
  cantRead: MapUnreadablePerson[];
  finding: MapPerson[];
  hidden: MapHiddenPerson[];
  outOfDate: LiveMapMarker[];
  upToDate: LiveMapMarker[];
  waiting: MapPerson[];
};

export type MapGroupOption = {
  color: string;
  hidden: boolean;
  id: string;
  memberCount: number;
  name: string;
};

export type MapMemberDevice = {
  deviceId: string;
  icon: DeviceIcon;
  name: string;
  platform: "android" | "ios" | null;
  userId: string;
};

export type MapGroup = {
  id: string;
  name: string;
  members: readonly { image: string | null; name: string; userId: string }[];
};
