package expo.modules.openbeacontracking.drives

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface DriveQueueDao {
  @Insert(onConflict = OnConflictStrategy.IGNORE)
  fun insertAll(entities: List<DriveQueueEntity>)

  @Query("DELETE FROM drive_queue WHERE id NOT IN (SELECT id FROM drive_queue ORDER BY id DESC LIMIT :keep)")
  fun trimTo(keep: Int)

  @Transaction
  fun insertBounded(entities: List<DriveQueueEntity>) {
    insertAll(entities)
    trimTo(DriveQueueLimits.MAX_ROWS)
  }

  @Query("SELECT * FROM drive_queue WHERE owner = :owner ORDER BY id ASC LIMIT :limit")
  fun list(owner: String, limit: Int): List<DriveQueueEntity>

  @Query("DELETE FROM drive_queue WHERE id IN (:ids)")
  fun deleteByIds(ids: List<Long>)

  @Query("DELETE FROM drive_queue WHERE owner = :owner")
  fun deleteByOwner(owner: String)

  @Query("DELETE FROM drive_queue")
  fun deleteAll()

  @Query("DELETE FROM drive_queue WHERE groupId IN (:groupIds)")
  fun deleteByGroups(groupIds: List<String>)
}
