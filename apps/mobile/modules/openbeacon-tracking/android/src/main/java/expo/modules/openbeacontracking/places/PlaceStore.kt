package expo.modules.openbeacontracking.places

interface PlaceStore {
  fun replaceGroup(groupId: String, places: List<PlaceGeofence>)

  fun removeGroups(groupIds: List<String>?)

  fun list(): List<PlaceGeofence>
}
