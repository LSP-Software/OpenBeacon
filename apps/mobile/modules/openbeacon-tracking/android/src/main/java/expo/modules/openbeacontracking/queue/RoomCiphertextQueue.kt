package expo.modules.openbeacontracking.queue

class RoomCiphertextQueue(
  private val dao: CiphertextQueueDao,
) : CiphertextQueue {
  override fun insertAll(rows: List<CiphertextQueueRow>): Int =
    dao.insertAll(rows.map { it.toEntity() }).count { it != -1L }

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
  ) {
    if (ids.isEmpty()) {
      return
    }
    dao.markInFlight(ids = ids, attemptedAt = attemptedAt)
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
