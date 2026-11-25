package expo.modules.openbeacontracking.drives

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CrashPlaceLabelTest {
  @Test
  fun namesTheStreetWithTheFirstPartOfThePostcode() {
    assertEquals("Barnet Lane, EN5", CrashPlaceLabel.of(street = "Barnet Lane", postcode = "EN5 2BU", locality = "Barnet"))
    assertEquals("Main Street, 10001", CrashPlaceLabel.of(street = "Main Street", postcode = "10001", locality = "New York"))
  }

  @Test
  fun fallsBackToTheTownWhenThereIsNoPostcodeOrStreet() {
    assertEquals("Barnet Lane, Barnet", CrashPlaceLabel.of(street = "Barnet Lane", postcode = null, locality = "Barnet"))
    assertEquals("Barnet", CrashPlaceLabel.of(street = null, postcode = "EN5 2BU", locality = "Barnet"))
    assertEquals("Barnet Lane", CrashPlaceLabel.of(street = "Barnet Lane", postcode = " ", locality = null))
  }

  @Test
  fun givesNothingWhenTheLookupNamedNeitherAStreetNorATown() {
    assertNull(CrashPlaceLabel.of(street = null, postcode = "EN5 2BU", locality = null))
    assertNull(CrashPlaceLabel.of(street = " ", postcode = null, locality = ""))
  }
}
