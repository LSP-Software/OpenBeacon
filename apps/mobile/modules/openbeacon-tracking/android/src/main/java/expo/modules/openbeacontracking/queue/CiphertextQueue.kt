package expo.modules.openbeacontracking.queue

interface CiphertextQueue {
  fun insertAll(rows: List<CiphertextQueueRow>)

  fun listByStatus(
    status: String,
    limit: Int,
  ): List<CiphertextQueueRow>

  fun markInFlight(
    ids: List<Long>,
    attemptedAt: Long,
  )

  fun deleteByIds(ids: List<Long>)

  fun requeue(
    ids: List<Long>,
    attemptedAt: Long,
    error: String?,
  )
}
