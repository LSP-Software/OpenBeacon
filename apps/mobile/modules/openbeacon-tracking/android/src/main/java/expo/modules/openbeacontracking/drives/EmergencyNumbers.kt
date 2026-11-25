package expo.modules.openbeacontracking.drives

object EmergencyNumbers {
  private val byCountry =
    mapOf(
      "GB" to "999",
      "HK" to "999",
      "MY" to "999",
      "SG" to "995",
      "US" to "911",
      "CA" to "911",
      "MX" to "911",
      "PR" to "911",
      "AR" to "911",
      "PH" to "911",
      "AU" to "000",
      "NZ" to "111",
      "JP" to "119",
      "KR" to "119",
      "CN" to "120",
      "BR" to "192",
      "IL" to "101",
    )

  fun forCountry(countryIso: String?): String = countryIso?.uppercase()?.let { byCountry[it] } ?: "112"
}
