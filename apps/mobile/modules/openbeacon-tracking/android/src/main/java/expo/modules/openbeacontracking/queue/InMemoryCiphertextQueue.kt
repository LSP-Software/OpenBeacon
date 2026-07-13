package expo.modules.openbeacontracking.queue

class InMemoryCiphertextQueue : CiphertextQueue {
  private val rows = mutableListOf<CiphertextQueueRow>()
  private var nextId = 1L

  @Synchronized
  override fun insertAll(rows: List<CiphertextQueueRow>) {
    for (row in rows) {
      this.rows.add(row.copy(id = nextId++))
    }
  }

  @Synchronized
  override fun listByStatus(
    status: String,
    limit: Int,
  ): List<CiphertextQueueRow> =
    rows
      .asSequence()
      .filter { it.status == status }
      .sortedBy { it.id }
      .take(limit.coerceAtLeast(0))
      .toList()

  @Synchronized
  override fun markInFlight(
    ids: List<Long>,
    attemptedAt: Long,
  ) {
    val idSet = ids.toSet()
    for (index in rows.indices) {
      val row = rows[index]
      if (row.id in idSet && row.status == CiphertextQueueRow.STATUS_PENDING) {
        rows[index] =
          row.copy(
            status = CiphertextQueueRow.STATUS_IN_FLIGHT,
            attemptCount = row.attemptCount + 1,
            lastAttemptAt = attemptedAt,
          )
      }
    }
  }

  @Synchronized
  override fun deleteByIds(ids: List<Long>) {
    val idSet = ids.toSet()
    rows.removeAll { it.id in idSet }
  }

  @Synchronized
  override fun requeue(
    ids: List<Long>,
    attemptedAt: Long,
    error: String?,
  ) {
    val idSet = ids.toSet()
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
