package expo.modules.openbeacontracking.places

class InMemoryPlaceTransitionQueue : PlaceTransitionQueue {
  private val rows = mutableListOf<PlaceTransitionRow>()

  @Synchronized
  override fun insert(rows: List<PlaceTransitionRow>) {
    this.rows.addAll(rows.filter { row -> this.rows.none { it.clientId == row.clientId } })
    while (this.rows.size > PlaceTransitionQueueLimits.MAX_ROWS) this.rows.removeAt(0)
  }

  @Synchronized
  override fun list(owner: String, limit: Int): List<PlaceTransitionRow> = rows.filter { it.owner == owner }.take(limit)

  @Synchronized
  override fun hasAny(owner: String): Boolean = rows.any { it.owner == owner }

  @Synchronized
  override fun deleteByClientIds(clientIds: List<String>) {
    rows.removeAll { it.clientId in clientIds }
  }

  @Synchronized
  override fun deleteByOwner(owner: String?) {
    rows.removeAll { owner == null || it.owner == owner }
  }

  @Synchronized
  override fun deleteByGroupExcept(groupId: String, keepPlaceIds: List<String>) {
    rows.removeAll { it.groupId == groupId && it.placeId !in keepPlaceIds }
  }

  @Synchronized
  override fun deleteByGroups(groupIds: List<String>) {
    rows.removeAll { it.groupId in groupIds }
  }
}

object PlaceTransitionQueueLimits {
  const val MAX_ROWS = 500
}
