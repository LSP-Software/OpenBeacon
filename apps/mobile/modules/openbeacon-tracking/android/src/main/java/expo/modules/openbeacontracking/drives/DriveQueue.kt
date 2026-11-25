package expo.modules.openbeacontracking.drives

data class DriveQueueRow(
  val id: Long = 0,
  val owner: String,
  val groupId: String,
  val driveId: String,
  val epochId: String,
  val senderDeviceId: String,
  val startHour: Long,
  val nonce: String,
  val ciphertext: String,
)

interface DriveQueue {
  fun insert(rows: List<DriveQueueRow>)

  fun list(owner: String, limit: Int): List<DriveQueueRow>

  fun deleteByIds(ids: List<Long>)

  fun deleteByOwner(owner: String?)

  fun deleteByGroups(groupIds: List<String>)
}

object DriveQueueLimits {
  const val MAX_ROWS = 500
}
