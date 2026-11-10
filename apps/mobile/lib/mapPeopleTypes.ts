import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

export type MapPerson = {
  groupNames: string[];
  image: string | null;
  initials: string;
  name: string;
  userId: string;
};

export type MapUnreadablePerson = MapPerson & {
  groupId: string;
  groupName: string;
  reason: "groupKey" | "point";
};

export type MapPeople = {
  cantLocate: MapPerson[];
  cantRead: MapUnreadablePerson[];
  finding: MapPerson[];
  outOfDate: LiveMapMarker[];
  upToDate: LiveMapMarker[];
  waiting: MapPerson[];
};
