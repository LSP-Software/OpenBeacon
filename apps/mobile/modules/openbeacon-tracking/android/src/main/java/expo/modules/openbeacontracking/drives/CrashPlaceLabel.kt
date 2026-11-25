package expo.modules.openbeacontracking.drives

object CrashPlaceLabel {
  fun of(
    street: String?,
    postcode: String?,
    locality: String?,
  ): String? {
    val road = street?.trim()?.takeIf { it.isNotEmpty() }
    val town = locality?.trim()?.takeIf { it.isNotEmpty() }
    val area = postcode?.trim()?.split(" ")?.firstOrNull()?.takeIf { it.isNotEmpty() }
    return when {
      road != null -> listOfNotNull(road, area ?: town).joinToString(", ")
      else -> town
    }
  }
}
