package expo.modules.openbeacontracking.drives

class InMemoryDriveQueue : DriveQueue {
  private val rows = mutableListOf<DriveQueueRow>()
  private var nextId = 1L

  @Synchronized
  override fun insert(rows: List<DriveQueueRow>) {
    for (row in rows) {
      if (this.rows.none { it.groupId == row.groupId && it.driveId == row.driveId }) this.rows.add(row.copy(id = nextId++))
    }
    while (this.rows.size > DriveQueueLimits.MAX_ROWS) this.rows.removeAt(0)
  }

  @Synchronized
  override fun list(owner: String, limit: Int): List<DriveQueueRow> = rows.filter { it.owner == owner }.take(limit)

  @Synchronized
  override fun deleteByIds(ids: List<Long>) {
    rows.removeAll { it.id in ids }
  }

  @Synchronized
  override fun deleteByOwner(owner: String?) {
    rows.removeAll { owner == null || it.owner == owner }
  }

  @Synchronized
  override fun deleteByGroups(groupIds: List<String>) {
    rows.removeAll { it.groupId in groupIds }
  }

  @Synchronized
  override fun deleteByDrives(owner: String, driveIds: List<String>) {
    rows.removeAll { it.owner == owner && it.driveId in driveIds }
  }
}
