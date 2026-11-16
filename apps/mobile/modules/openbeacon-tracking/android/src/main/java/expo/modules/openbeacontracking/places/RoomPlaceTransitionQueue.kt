package expo.modules.openbeacontracking.places

class RoomPlaceTransitionQueue(
  database: PlaceTransitionDatabase,
) : PlaceTransitionQueue {
  private val dao = database.placeTransitionDao()

  override fun insert(rows: List<PlaceTransitionRow>) {
    if (rows.isEmpty()) return
    dao.insertBounded(
      rows.map {
        PlaceTransitionEntity(
          clientId = it.clientId,
          owner = it.owner,
          senderDeviceId = it.senderDeviceId,
          groupId = it.groupId,
          placeId = it.placeId,
          direction = it.direction,
          occurredAt = it.occurredAt,
        )
      },
    )
  }

  override fun list(owner: String, limit: Int): List<PlaceTransitionRow> =
    dao.list(owner, limit).map {
      PlaceTransitionRow(
        clientId = it.clientId,
        owner = it.owner,
        senderDeviceId = it.senderDeviceId,
        groupId = it.groupId,
        placeId = it.placeId,
        direction = it.direction,
        occurredAt = it.occurredAt,
      )
    }

  override fun hasAny(owner: String): Boolean = dao.hasAny(owner)

  override fun deleteByClientIds(clientIds: List<String>) {
    clientIds.chunked(500).forEach { dao.deleteByClientIds(it) }
  }

  override fun deleteByOwner(owner: String?) {
    if (owner == null) dao.deleteAll() else dao.deleteByOwner(owner)
  }

  override fun deleteByGroupExcept(groupId: String, keepPlaceIds: List<String>) {
    dao.deleteByGroupExcept(groupId, keepPlaceIds)
  }

  override fun deleteByGroups(groupIds: List<String>) {
    if (groupIds.isNotEmpty()) dao.deleteByGroups(groupIds)
  }
}
