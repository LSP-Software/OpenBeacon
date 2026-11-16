package expo.modules.openbeacontracking.places

data class PlaceGeofence(
  val groupId: String,
  val placeId: String,
  val latitude: Double,
  val longitude: Double,
  val radiusMeters: Double,
)
