package expo.modules.openbeacontracking.places

class InMemoryPlaceStore : PlaceStore {
  private val placesByGroupId = linkedMapOf<String, List<PlaceGeofence>>()

  @Synchronized
  override fun replaceGroup(groupId: String, places: List<PlaceGeofence>) {
    placesByGroupId[groupId] = places.filter { it.groupId == groupId }
  }

  @Synchronized
  override fun removeGroups(groupIds: List<String>?) {
    if (groupIds == null) placesByGroupId.clear() else groupIds.forEach { placesByGroupId.remove(it) }
  }

  @Synchronized
  override fun list(): List<PlaceGeofence> = placesByGroupId.values.flatten()

  @Synchronized
  override fun groups(): Set<String> = placesByGroupId.keys.toSet()
}
