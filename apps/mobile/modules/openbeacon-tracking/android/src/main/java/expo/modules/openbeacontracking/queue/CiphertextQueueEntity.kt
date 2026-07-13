package expo.modules.openbeacontracking.queue

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
  tableName = "ciphertext_queue",
  indices = [
    Index(value = ["clientPointId"], unique = true),
    Index(value = ["status", "id"]),
    Index(value = ["groupId", "id"]),
  ],
)
data class CiphertextQueueEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  @ColumnInfo(name = "clientPointId") val clientPointId: String,
  @ColumnInfo(name = "captureId") val captureId: String,
  @ColumnInfo(name = "groupId") val groupId: String,
  @ColumnInfo(name = "epochId") val epochId: String,
  @ColumnInfo(name = "senderDeviceId") val senderDeviceId: String,
  @ColumnInfo(name = "kind") val kind: String,
  @ColumnInfo(name = "algorithm") val algorithm: String,
  @ColumnInfo(name = "nonce") val nonce: String,
  @ColumnInfo(name = "ciphertext") val ciphertext: String,
  @ColumnInfo(name = "queuedAt") val queuedAt: Long,
  @ColumnInfo(name = "attemptCount") val attemptCount: Int = 0,
  @ColumnInfo(name = "lastAttemptAt") val lastAttemptAt: Long? = null,
  @ColumnInfo(name = "lastError") val lastError: String? = null,
  @ColumnInfo(name = "status") val status: String,
)
