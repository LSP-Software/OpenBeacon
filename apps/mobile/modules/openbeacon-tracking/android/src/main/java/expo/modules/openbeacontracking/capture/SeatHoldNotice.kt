package expo.modules.openbeacontracking.capture

data class SeatHoldNotice(
  val sharing: List<String> = emptyList(),
  val held: List<String> = emptyList(),
) {
  val sharesNowhere: Boolean get() = held.isNotEmpty() && sharing.isEmpty()

  val sharesSomewhere: Boolean get() = held.isNotEmpty() && sharing.isNotEmpty()

  companion object {
    fun join(names: List<String>): String =
      if (names.size < 2) names.firstOrNull() ?: "" else "${names.dropLast(1).joinToString(", ")} and ${names.last()}"
  }
}
