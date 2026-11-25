package expo.modules.openbeacontracking.drives

import kotlin.test.Test
import kotlin.test.assertEquals

class EmergencyNumbersTest {
  @Test
  fun picksTheLocalNumberForTheNetworkOrSimCountry() {
    assertEquals("999", EmergencyNumbers.forCountry("gb"))
    assertEquals("911", EmergencyNumbers.forCountry("US"))
    assertEquals("000", EmergencyNumbers.forCountry("au"))
    assertEquals("112", EmergencyNumbers.forCountry("fr"))
  }

  @Test
  fun fallsBackTo112WhenTheCountryIsUnknown() {
    assertEquals("112", EmergencyNumbers.forCountry(null))
    assertEquals("112", EmergencyNumbers.forCountry(""))
    assertEquals("112", EmergencyNumbers.forCountry("zz"))
  }
}
