package expo.modules.openbeacontracking.queue

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "ciphertext_queue_eviction")
data class CiphertextQueueEvictionEntity(
  @PrimaryKey @ColumnInfo(name = "owner") val owner: String,
  @ColumnInfo(name = "pointCount") val pointCount: Int,
  @ColumnInfo(name = "oldestQueuedAt") val oldestQueuedAt: Long,
  @ColumnInfo(name = "newestQueuedAt") val newestQueuedAt: Long,
  @ColumnInfo(name = "revision") val revision: Long,
)
