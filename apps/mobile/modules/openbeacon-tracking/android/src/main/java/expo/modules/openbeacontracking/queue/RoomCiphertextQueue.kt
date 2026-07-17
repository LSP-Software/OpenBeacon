package expo.modules.openbeacontracking.queue

class RoomCiphertextQueue(
  private val dao: CiphertextQueueDao,
) : CiphertextQueue {
  override fun insertAll(rows: List<CiphertextQueueRow>) {
    dao.insertAll(rows.map { it.toEntity() })
  }

  override fun listByStatus(
    status: String,
    limit: Int,
  ): List<CiphertextQueueRow> =
    dao.listByStatus(status, limit.coerceAtLeast(0)).map { it.toRow() }

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
