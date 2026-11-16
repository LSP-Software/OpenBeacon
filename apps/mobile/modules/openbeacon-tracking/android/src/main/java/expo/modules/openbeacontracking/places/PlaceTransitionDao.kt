package expo.modules.openbeacontracking.places

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface PlaceTransitionDao {
  @Insert(onConflict = OnConflictStrategy.IGNORE)
  fun insertAll(entities: List<PlaceTransitionEntity>)

  @Query("DELETE FROM place_transition_queue WHERE id NOT IN (SELECT id FROM place_transition_queue ORDER BY id DESC LIMIT :keep)")
  fun trimTo(keep: Int)

  @Transaction
  fun insertBounded(entities: List<PlaceTransitionEntity>) {
    insertAll(entities)
    trimTo(PlaceTransitionQueueLimits.MAX_ROWS)
  }

  @Query("SELECT * FROM place_transition_queue WHERE owner = :owner ORDER BY id ASC LIMIT :limit")
  fun list(owner: String, limit: Int): List<PlaceTransitionEntity>

  @Query("SELECT EXISTS(SELECT 1 FROM place_transition_queue WHERE owner = :owner)")
  fun hasAny(owner: String): Boolean

  @Query("DELETE FROM place_transition_queue WHERE clientId IN (:clientIds)")
  fun deleteByClientIds(clientIds: List<String>)

  @Query("DELETE FROM place_transition_queue WHERE owner = :owner")
  fun deleteByOwner(owner: String)

  @Query("DELETE FROM place_transition_queue")
  fun deleteAll()

  @Query("DELETE FROM place_transition_queue WHERE groupId = :groupId AND placeId NOT IN (:keepPlaceIds)")
  fun deleteByGroupExcept(groupId: String, keepPlaceIds: List<String>)

  @Query("DELETE FROM place_transition_queue WHERE groupId IN (:groupIds)")
  fun deleteByGroups(groupIds: List<String>)
}
