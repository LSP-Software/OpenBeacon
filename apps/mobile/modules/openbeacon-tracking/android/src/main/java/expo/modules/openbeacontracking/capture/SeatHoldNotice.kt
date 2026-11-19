package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.places.PlaceDetection
import expo.modules.openbeacontracking.queue.CiphertextQueue

data class SeatHoldNotice(
  val groupNames: Map<String, String> = emptyMap(),
  val heldGroupIds: List<String> = emptyList(),
) {
  sealed interface Text {
    data object Paused : Text

    data object Sharing : Text

    data object OnHoldEverywhere : Text

    data class SomeOnHold(val sharing: List<String>, val held: List<String>) : Text
  }

  fun text(
    paused: Boolean,
    keyGroupIds: Collection<String>,
  ): Text {
    if (paused) return Text.Paused
    if (heldGroupIds.isEmpty()) return Text.Sharing
    val sendingTo = keyGroupIds.toSet() - heldGroupIds.toSet()
    if (sendingTo.isEmpty()) return Text.OnHoldEverywhere
    val sharing = sendingTo.map { groupNames[it] ?: return Text.Sharing }.sorted()
    val held = heldGroupIds.mapNotNull { groupNames[it] }.sorted()
    return if (held.isEmpty()) Text.Sharing else Text.SomeOnHold(sharing, held)
  }

  fun dropHeldRecords(
    owner: String,
    queue: CiphertextQueue,
    places: PlaceDetection,
  ) {
    heldGroupIds.forEach { queue.deleteByGroup(owner, it) }
    if (heldGroupIds.isNotEmpty()) places.dropQueued(heldGroupIds)
  }

  fun toJson(): String =
    org.json.JSONObject()
      .put("groupNames", org.json.JSONObject(groupNames))
      .put("heldGroupIds", org.json.JSONArray(heldGroupIds))
      .toString()

  companion object {
    fun parse(stored: String): SeatHoldNotice =
      try {
        val notice = org.json.JSONObject(stored)
        val names = notice.getJSONObject("groupNames")
        val held = notice.getJSONArray("heldGroupIds")
        SeatHoldNotice(
          groupNames = names.keys().asSequence().associateWith { names.getString(it) },
          heldGroupIds = (0 until held.length()).map(held::getString),
        )
      } catch (error: org.json.JSONException) {
        SeatHoldNotice()
      }

    fun join(names: List<String>): String =
      if (names.size < 2) names.firstOrNull() ?: "" else "${names.dropLast(1).joinToString(", ")} and ${names.last()}"
  }
}
