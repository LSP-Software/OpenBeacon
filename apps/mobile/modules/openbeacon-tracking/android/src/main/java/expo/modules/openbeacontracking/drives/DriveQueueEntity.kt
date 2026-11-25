package expo.modules.openbeacontracking.drives

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
  tableName = "drive_queue",
  indices = [
    Index(value = ["groupId", "driveId"], unique = true),
    Index(value = ["owner", "id"]),
  ],
)
data class DriveQueueEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val owner: String,
  val groupId: String,
  val driveId: String,
  val epochId: String,
  val senderDeviceId: String,
  val startHour: Long,
  val nonce: String,
  val ciphertext: String,
)
