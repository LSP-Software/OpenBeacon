package expo.modules.openbeacontracking.queue

class RoomCiphertextQueue(
  private val database: CiphertextQueueDatabase,
  private val maxDatabaseBytes: Long = CiphertextQueueDatabase.MAX_DATABASE_BYTES,
) : CiphertextQueue {
  private val dao = database.ciphertextQueueDao()

  override fun insertAll(rows: List<CiphertextQueueRow>): Int =
    database.runInTransaction<Int> {
      val inserted = dao.insertAll(rows.map { it.toEntity() }).count { it != -1L }
      if (inserted > 0) evictOldestPendingOverLimit()
      inserted
    }

  private fun evictOldestPendingOverLimit() {
    while (true) {
      val usedBytes = database.usedBytes()
      if (usedBytes <= maxDatabaseBytes) return
      val rowCount = dao.count()
      if (rowCount == 0) return
      val estimatedOverflowRows = ((usedBytes - maxDatabaseBytes) * rowCount / usedBytes).toInt() + 1
      val evicted = dao.listOldestPending(estimatedOverflowRows.coerceAtMost(500))
      if (evicted.isEmpty()) return
      dao.deleteByIds(evicted.map { it.id })
      for ((owner, ownerRows) in evicted.groupBy { it.owner }) {
        if (owner == null) continue
        val existing = dao.getEviction(owner)
        dao.saveEviction(
          CiphertextQueueEvictionEntity(
            owner = owner,
            pointCount = (existing?.pointCount ?: 0) + ownerRows.size,
            oldestQueuedAt = minOf(existing?.oldestQueuedAt ?: Long.MAX_VALUE, ownerRows.minOf { it.queuedAt }),
            newestQueuedAt = maxOf(existing?.newestQueuedAt ?: Long.MIN_VALUE, ownerRows.maxOf { it.queuedAt }),
            revision = maxOf((existing?.revision ?: 0) + 1, System.currentTimeMillis()),
          ),
        )
      }
    }
  }

  fun getEviction(owner: String): CiphertextQueueEvictionEntity? = dao.getEviction(owner)

  fun acknowledgeEviction(
    owner: String,
    revision: Long,
  ) = dao.acknowledgeEviction(owner, revision)

  override fun listByStatus(
    status: String,
    limit: Int,
    owner: String?,
    afterId: Long,
  ): List<CiphertextQueueRow> {
    dao.recoverInterrupted(System.currentTimeMillis() - 120_000L)
    return dao.listByStatus(status, limit.coerceAtLeast(0), owner, afterId).map { it.toRow() }
  }

  override fun markInFlight(
    ids: List<Long>,
    attemptedAt: Long,
  ): List<Long> {
    if (ids.isEmpty()) {
      return emptyList()
    }
    return database.runInTransaction<List<Long>> {
      val claimed = dao.listPendingIds(ids)
      if (claimed.isNotEmpty()) dao.markInFlight(ids = claimed, attemptedAt = attemptedAt)
      claimed
    }
  }

  override fun deleteByIds(ids: List<Long>) {
    if (ids.isEmpty()) {
      return
    }
    dao.deleteByIds(ids)
  }

  override fun requeue(
    ids: List<Long>,
    attemptedAt: Long,
    error: String?,
  ) {
    if (ids.isEmpty()) {
      return
    }
    dao.requeue(ids = ids, attemptedAt = attemptedAt, error = error)
  }
}

private fun CiphertextQueueRow.toEntity(): CiphertextQueueEntity =
  CiphertextQueueEntity(
    id = id,
    owner = owner,
    clientPointId = clientPointId,
    captureId = captureId,
    groupId = groupId,
    epochId = epochId,
    senderDeviceId = senderDeviceId,
    kind = kind,
    algorithm = algorithm,
    nonce = nonce,
    ciphertext = ciphertext,
    queuedAt = queuedAt,
    attemptCount = attemptCount,
    lastAttemptAt = lastAttemptAt,
    lastError = lastError,
    status = status,
  )

private fun CiphertextQueueEntity.toRow(): CiphertextQueueRow =
  CiphertextQueueRow(
    id = id,
    owner = owner,
    clientPointId = clientPointId,
    captureId = captureId,
    groupId = groupId,
    epochId = epochId,
    senderDeviceId = senderDeviceId,
    kind = kind,
    algorithm = algorithm,
    nonce = nonce,
    ciphertext = ciphertext,
    queuedAt = queuedAt,
    attemptCount = attemptCount,
    lastAttemptAt = lastAttemptAt,
    lastError = lastError,
    status = status,
  )
