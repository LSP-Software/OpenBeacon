package expo.modules.openbeacontracking.queue

interface CiphertextQueue {
  fun insertAll(rows: List<CiphertextQueueRow>): Int

  fun listByStatus(
    status: String,
    limit: Int,
    owner: String? = null,
    afterId: Long = 0,
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
