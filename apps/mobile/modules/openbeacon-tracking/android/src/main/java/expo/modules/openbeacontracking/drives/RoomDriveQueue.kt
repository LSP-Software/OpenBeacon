package expo.modules.openbeacontracking.drives

class RoomDriveQueue(
  database: DriveQueueDatabase,
) : DriveQueue {
  private val dao = database.driveQueueDao()

  override fun insert(rows: List<DriveQueueRow>) {
    if (rows.isEmpty()) return
    dao.insertBounded(
      rows.map {
        DriveQueueEntity(
          owner = it.owner,
          groupId = it.groupId,
          driveId = it.driveId,
          epochId = it.epochId,
          senderDeviceId = it.senderDeviceId,
          startHour = it.startHour,
          nonce = it.nonce,
          ciphertext = it.ciphertext,
        )
      },
    )
  }

  override fun list(owner: String, limit: Int): List<DriveQueueRow> =
    dao.list(owner, limit).map {
      DriveQueueRow(
        id = it.id,
        owner = it.owner,
        groupId = it.groupId,
        driveId = it.driveId,
        epochId = it.epochId,
        senderDeviceId = it.senderDeviceId,
        startHour = it.startHour,
        nonce = it.nonce,
        ciphertext = it.ciphertext,
      )
    }

  override fun deleteByIds(ids: List<Long>) {
    ids.chunked(500).forEach { dao.deleteByIds(it) }
  }

  override fun deleteByOwner(owner: String?) {
    if (owner == null) dao.deleteAll() else dao.deleteByOwner(owner)
  }

  override fun deleteByGroups(groupIds: List<String>) {
    if (groupIds.isNotEmpty()) dao.deleteByGroups(groupIds)
  }
}
