package expo.modules.openbeacontracking.places

data class PlaceTransitionRow(
  val clientId: String,
  val owner: String,
  val senderDeviceId: String,
  val groupId: String,
  val placeId: String,
  val direction: String,
  val occurredAt: Long,
) {
  companion object {
    const val ARRIVE = "ARRIVE"
    const val LEAVE = "LEAVE"
  }
}
