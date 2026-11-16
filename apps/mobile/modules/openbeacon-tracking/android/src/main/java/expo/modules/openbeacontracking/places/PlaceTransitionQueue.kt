package expo.modules.openbeacontracking.places

interface PlaceTransitionQueue {
  fun insert(rows: List<PlaceTransitionRow>)

  fun list(owner: String, limit: Int): List<PlaceTransitionRow>

  fun hasAny(owner: String): Boolean

  fun deleteByClientIds(clientIds: List<String>)

  fun deleteByOwner(owner: String?)

  fun deleteByGroupExcept(groupId: String, keepPlaceIds: List<String>)

  fun deleteByGroups(groupIds: List<String>)
}
