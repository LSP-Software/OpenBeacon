package expo.modules.openbeacontracking.capture

data class SeatHoldNotice(
  val sharing: List<String> = emptyList(),
  val held: List<String> = emptyList(),
) {
  val sharesNowhere: Boolean get() = held.isNotEmpty() && sharing.isEmpty()

  val sharesSomewhere: Boolean get() = held.isNotEmpty() && sharing.isNotEmpty()

  companion object {
    fun parse(stored: String): SeatHoldNotice =
      try {
        val notice = org.json.JSONObject(stored)
        val names = { key: String -> notice.getJSONArray(key).let { list -> (0 until list.length()).map(list::getString) } }
        SeatHoldNotice(sharing = names("sharing"), held = names("held"))
      } catch (error: org.json.JSONException) {
        SeatHoldNotice()
      }

    fun join(names: List<String>): String =
      if (names.size < 2) names.firstOrNull() ?: "" else "${names.dropLast(1).joinToString(", ")} and ${names.last()}"
  }
}
