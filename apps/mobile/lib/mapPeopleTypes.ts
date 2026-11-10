import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

export type MapPerson = {
  groupNames: string[];
  image: string | null;
  initials: string;
  isSelf: boolean;
  name: string;
  userId: string;
};

export type MapPersonStatus = "cantLocate" | "cantRead";

export type MapUnreadablePerson = MapPerson & {
  groupId: string;
  groupName: string;
  reason: "groupKey" | "point";
};

export type MapPeople = {
  cantLocate: MapPerson[];
  connectionLost: boolean;
  cantRead: MapUnreadablePerson[];
  finding: MapPerson[];
  outOfDate: LiveMapMarker[];
  upToDate: LiveMapMarker[];
  waiting: MapPerson[];
};
