package expo.modules.openbeacontracking.queue

class InMemoryCiphertextQueue : CiphertextQueue {
  private val rows = mutableListOf<CiphertextQueueRow>()
  private var nextId = 1L

  @Synchronized
  override fun insertAll(rows: List<CiphertextQueueRow>): Int {
    var inserted = 0
    for (row in rows) {
      val pending = this.rows.filter { it.status == CiphertextQueueRow.STATUS_PENDING }
      when (row.role) {
        CiphertextQueueRow.ROLE_STAY -> this.rows.removeAll(pending.filter { it.clientPointId == row.clientPointId })
        CiphertextQueueRow.ROLE_LIVE -> this.rows.removeAll(pending.filter { it.role == CiphertextQueueRow.ROLE_LIVE && it.owner == row.owner && it.groupId == row.groupId && it.epochId == row.epochId && it.senderDeviceId == row.senderDeviceId && it.kind == row.kind })
        else -> if (this.rows.any { it.clientPointId == row.clientPointId }) continue
      }
      this.rows.add(row.copy(id = nextId++))
      inserted += 1
    }
    return inserted
  }

  @Synchronized
  override fun listByStatus(
    status: String,
    limit: Int,
    owner: String?,
    afterId: Long,
  ): List<CiphertextQueueRow> =
    rows
      .asSequence()
      .filter { it.status == status && it.id > afterId && (owner == null || it.owner == owner) }
      .sortedBy { it.id }
      .take(limit.coerceAtLeast(0))
      .toList()

  @Synchronized
  override fun markInFlight(
    ids: List<Long>,
    attemptedAt: Long,
  ): List<Long> {
    val idSet = ids.toSet()
    val claimed = mutableListOf<Long>()
    for (index in rows.indices) {
      val row = rows[index]
      if (row.id in idSet && row.status == CiphertextQueueRow.STATUS_PENDING) {
        rows[index] =
          row.copy(
            status = CiphertextQueueRow.STATUS_IN_FLIGHT,
            attemptCount = row.attemptCount + 1,
            lastAttemptAt = attemptedAt,
          )
        claimed.add(row.id)
      }
    }
    return claimed
  }

  @Synchronized
  override fun deleteByIds(ids: List<Long>) {
    val idSet = ids.toSet()
    rows.removeAll { it.id in idSet }
  }

  @Synchronized
  override fun deleteByOwner(owner: String) {
    rows.removeAll { it.owner == owner }
  }

  @Synchronized
  override fun deleteByGroup(
    owner: String,
    groupId: String,
  ) {
    rows.removeAll { it.owner == owner && it.groupId == groupId }
  }

  @Synchronized
  override fun requeue(
    ids: List<Long>,
    attemptedAt: Long,
    error: String?,
  ) {
    val idSet = ids.toSet()
    val superseded = rows.filter { row -> row.id in idSet && rows.any { newer -> newer.id > row.id && newer.supersedes(row) } }.map { it.id }.toSet()
    rows.removeAll { it.id in superseded }
    for (index in rows.indices) {
      val row = rows[index]
      if (row.id in idSet) {
        rows[index] =
          row.copy(
            status = CiphertextQueueRow.STATUS_PENDING,
            lastAttemptAt = attemptedAt,
            lastError = error,
          )
      }
    }
  }
}

private fun CiphertextQueueRow.supersedes(older: CiphertextQueueRow) =
  owner == older.owner &&
    when (older.role) {
      CiphertextQueueRow.ROLE_STAY -> clientPointId == older.clientPointId
      CiphertextQueueRow.ROLE_LIVE ->
        role == CiphertextQueueRow.ROLE_LIVE && groupId == older.groupId && epochId == older.epochId &&
          senderDeviceId == older.senderDeviceId && kind == older.kind
      else -> false
    }
