package expo.modules.openbeacontracking.places

class InMemoryPlaceStore : PlaceStore {
  private val placesByGroupId = linkedMapOf<String, List<PlaceGeofence>>()

  @Synchronized
  override fun replaceGroup(groupId: String, places: List<PlaceGeofence>) {
    if (places.isEmpty()) placesByGroupId.remove(groupId) else placesByGroupId[groupId] = places
  }

  @Synchronized
  override fun removeGroups(groupIds: List<String>?) {
    if (groupIds == null) placesByGroupId.clear() else groupIds.forEach { placesByGroupId.remove(it) }
  }

  @Synchronized
  override fun list(): List<PlaceGeofence> = placesByGroupId.values.flatten()
}
