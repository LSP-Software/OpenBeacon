package expo.modules.openbeacontracking.queue

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface CiphertextQueueDao {
  @Insert
  fun insertAll(entities: List<CiphertextQueueEntity>)

  @Query(
    """
    SELECT * FROM ciphertext_queue
    WHERE status = :status
    ORDER BY id ASC
    LIMIT :limit
    """,
  )
  fun listByStatus(
    status: String,
    limit: Int,
  ): List<CiphertextQueueEntity>

  @Query(
    """
    UPDATE ciphertext_queue
    SET status = :inFlightStatus,
        attemptCount = attemptCount + 1,
        lastAttemptAt = :attemptedAt
    WHERE id IN (:ids) AND status = :pendingStatus
    """,
  )
  fun markInFlight(
    ids: List<Long>,
    attemptedAt: Long,
    pendingStatus: String = CiphertextQueueRow.STATUS_PENDING,
    inFlightStatus: String = CiphertextQueueRow.STATUS_IN_FLIGHT,
  )

  @Query("DELETE FROM ciphertext_queue WHERE id IN (:ids)")
  fun deleteByIds(ids: List<Long>)

  @Query(
    """
    UPDATE ciphertext_queue
    SET status = :pendingStatus,
        lastAttemptAt = :attemptedAt,
        lastError = :error
    WHERE id IN (:ids)
    """,
  )
  fun requeue(
    ids: List<Long>,
    attemptedAt: Long,
    error: String?,
    pendingStatus: String = CiphertextQueueRow.STATUS_PENDING,
  )
}
