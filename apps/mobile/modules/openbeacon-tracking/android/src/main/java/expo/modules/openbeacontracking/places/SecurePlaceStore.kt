package expo.modules.openbeacontracking.places

import android.content.Context
import android.util.Log
import expo.modules.openbeacontracking.keys.KeystoreSealer
import org.json.JSONArray
import org.json.JSONObject

class SecurePlaceStore(
  context: Context,
) : PlaceStore {
  private val preferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  private val sealer = KeystoreSealer(KEY_ALIAS)

  @Synchronized
  override fun replaceGroup(groupId: String, places: List<PlaceGeofence>) {
    val stored = read()
    save(
      stored.groups + groupId,
      stored.places.filterNot { it.groupId == groupId } + places.filter { it.groupId == groupId },
    )
  }

  @Synchronized
  override fun removeGroups(groupIds: List<String>?) {
    if (groupIds == null) {
      check(preferences.edit().remove(PLACES_JSON).commit())
      return
    }
    val stored = read()
    save(stored.groups - groupIds.toSet(), stored.places.filterNot { it.groupId in groupIds })
  }

  @Synchronized
  override fun list(): List<PlaceGeofence> = read().places

  @Synchronized
  override fun groups(): Set<String> = read().groups

  private class Stored(val groups: Set<String>, val places: List<PlaceGeofence>)

  private fun read(): Stored {
    val raw = preferences.getString(PLACES_JSON, null) ?: return Stored(emptySet(), emptyList())
    return try {
      val opened = sealer.open(raw)
      val stored = if (opened.trimStart().startsWith("[")) JSONObject().put("places", JSONArray(opened)) else JSONObject(opened)
      val array = stored.getJSONArray("places")
      val places =
        (0 until array.length()).map { index ->
          val item = array.getJSONObject(index)
          PlaceGeofence(
            groupId = item.getString("groupId"),
            placeId = item.getString("placeId"),
            latitude = item.getDouble("latitude"),
            longitude = item.getDouble("longitude"),
            radiusMeters = item.getDouble("radiusMeters"),
            sharesTransitions = item.optBoolean("sharesTransitions", true),
          )
        }
      val groups = stored.optJSONArray("groups")
      Stored(
        groups = groups?.let { ids -> (0 until ids.length()).map { ids.getString(it) }.toSet() } ?: places.map { it.groupId }.toSet(),
        places = places,
      )
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read places.", error)
      Stored(emptySet(), emptyList())
    }
  }

  private fun save(groups: Set<String>, places: List<PlaceGeofence>) {
    val array = JSONArray()
    for (place in places) {
      array.put(
        JSONObject()
          .put("groupId", place.groupId)
          .put("placeId", place.placeId)
          .put("latitude", place.latitude)
          .put("longitude", place.longitude)
          .put("radiusMeters", place.radiusMeters)
          .put("sharesTransitions", place.sharesTransitions),
      )
    }
    val stored = JSONObject().put("groups", JSONArray(groups.toList())).put("places", array)
    check(preferences.edit().putString(PLACES_JSON, sealer.seal(stored.toString())).commit())
  }

  companion object {
    private const val TAG = "SecurePlaceStore"
    private const val KEY_ALIAS = "openbeacon_tracking_places_v1"
    private const val PREFS_NAME = "openbeacon_tracking_places_v1"
    private const val PLACES_JSON = "places"
  }
}
