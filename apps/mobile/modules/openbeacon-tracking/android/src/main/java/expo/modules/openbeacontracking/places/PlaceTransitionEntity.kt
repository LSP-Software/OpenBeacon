package expo.modules.openbeacontracking.places

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
  tableName = "place_transition_queue",
  indices = [
    Index(value = ["clientId"], unique = true),
    Index(value = ["owner", "id"]),
    Index(value = ["groupId", "placeId"]),
  ],
)
data class PlaceTransitionEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val clientId: String,
  val owner: String,
  val senderDeviceId: String,
  val groupId: String,
  val placeId: String,
  val direction: String,
  val occurredAt: Long,
)
