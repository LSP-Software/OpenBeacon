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
    save(list().filterNot { it.groupId == groupId } + places.filter { it.groupId == groupId })
  }

  @Synchronized
  override fun removeGroups(groupIds: List<String>?) {
    if (groupIds == null) {
      check(preferences.edit().remove(PLACES_JSON).commit())
      return
    }
    save(list().filterNot { it.groupId in groupIds })
  }

  @Synchronized
  override fun list(): List<PlaceGeofence> {
    val raw = preferences.getString(PLACES_JSON, null) ?: return emptyList()
    return try {
      val array = JSONArray(sealer.open(raw))
      (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        PlaceGeofence(
          groupId = item.getString("groupId"),
          placeId = item.getString("placeId"),
          latitude = item.getDouble("latitude"),
          longitude = item.getDouble("longitude"),
          radiusMeters = item.getDouble("radiusMeters"),
        )
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read places.", error)
      emptyList()
    }
  }

  private fun save(places: List<PlaceGeofence>) {
    val array = JSONArray()
    for (place in places) {
      array.put(
        JSONObject()
          .put("groupId", place.groupId)
          .put("placeId", place.placeId)
          .put("latitude", place.latitude)
          .put("longitude", place.longitude)
          .put("radiusMeters", place.radiusMeters),
      )
    }
    check(preferences.edit().putString(PLACES_JSON, sealer.seal(array.toString())).commit())
  }

  companion object {
    private const val TAG = "SecurePlaceStore"
    private const val KEY_ALIAS = "openbeacon_tracking_places_v1"
    private const val PREFS_NAME = "openbeacon_tracking_places_v1"
    private const val PLACES_JSON = "places"
  }
}
