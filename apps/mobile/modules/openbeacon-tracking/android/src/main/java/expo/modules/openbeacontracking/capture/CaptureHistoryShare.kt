package expo.modules.openbeacontracking.capture

data class CaptureHistoryShare(
  val account: String = MAXIMUM,
  val groups: Map<String, String> = emptyMap(),
) {
  fun isLiveOnly(groupId: String): Boolean = (groups[groupId] ?: account) == LAST_LOCATION

  companion object {
    const val LAST_LOCATION = "LAST_LOCATION"
    const val MAXIMUM = "MAXIMUM"
  }
}
