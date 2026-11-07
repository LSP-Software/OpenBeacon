package expo.modules.openbeacontracking.queue

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface CiphertextQueueDao {
  @Query("SELECT COUNT(*) FROM ciphertext_queue WHERE owner IS NULL AND senderDeviceId = :senderDeviceId")
  fun countUnassigned(senderDeviceId: String): Int

  @Query("UPDATE ciphertext_queue SET owner = :owner WHERE owner IS NULL AND senderDeviceId = :senderDeviceId")
  fun assignUnassigned(senderDeviceId: String, owner: String)

  @Query("UPDATE ciphertext_queue SET status = 'PENDING' WHERE status = 'IN_FLIGHT' AND lastAttemptAt < :before")
  fun recoverInterrupted(before: Long)

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  fun insertAll(entities: List<CiphertextQueueEntity>): List<Long>

  @Query(
    """
    SELECT * FROM ciphertext_queue
    WHERE status = :status AND id > :afterId AND (:owner IS NULL OR owner = :owner)
    ORDER BY id ASC
    LIMIT :limit
    """,
  )
  fun listByStatus(
    status: String,
    limit: Int,
    owner: String?,
    afterId: Long,
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

  @Query("SELECT id FROM ciphertext_queue WHERE id IN (:ids) AND status = :pendingStatus")
  fun listPendingIds(
    ids: List<Long>,
    pendingStatus: String = CiphertextQueueRow.STATUS_PENDING,
  ): List<Long>

  @Query("DELETE FROM ciphertext_queue WHERE id IN (:ids)")
  fun deleteByIds(ids: List<Long>)

  @Query("SELECT COUNT(*) FROM ciphertext_queue")
  fun count(): Int

  @Query("SELECT * FROM ciphertext_queue WHERE status = :pendingStatus ORDER BY id ASC LIMIT :limit")
  fun listOldestPending(
    limit: Int,
    pendingStatus: String = CiphertextQueueRow.STATUS_PENDING,
  ): List<CiphertextQueueEntity>

  @Query("SELECT * FROM ciphertext_queue_eviction WHERE owner = :owner")
  fun getEviction(owner: String): CiphertextQueueEvictionEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun saveEviction(eviction: CiphertextQueueEvictionEntity)

  @Query("DELETE FROM ciphertext_queue_eviction WHERE owner = :owner AND revision = :revision")
  fun acknowledgeEviction(
    owner: String,
    revision: Long,
  )

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
