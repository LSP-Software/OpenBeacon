package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.places.PlaceGeofence
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlaceDwellDetectorTest {
  private val home = PlaceGeofence("group-1", "home", 51.5, -0.1, 150.0)
  private val metersPerDegreeLatitude = 111_195.0

  private fun north(meters: Double) = home.latitude + meters / metersPerDegreeLatitude

  private fun PlaceDwellDetector.fix(
    metersNorth: Double,
    atSeconds: Long,
    places: List<PlaceGeofence> = listOf(home),
    accuracy: Double? = 10.0,
  ) = onFix(places, north(metersNorth), home.longitude, accuracy, atSeconds * 1_000)

  @Test
  fun firstFixSetsTheStartingStateWithoutATransition() {
    val inside = PlaceDwellDetector()
    val outside = PlaceDwellDetector()
    assertTrue((0L..300L step 30).flatMap { inside.fix(0.0, it) }.isEmpty())
    assertTrue((0L..300L step 30).flatMap { outside.fix(1_000.0, it) }.isEmpty())
  }

  @Test
  fun arriveFiresOnlyAfterTwoMinutesInside() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    assertTrue(detector.fix(0.0, 30).isEmpty())
    assertTrue(detector.fix(0.0, 90).isEmpty())
    assertTrue(detector.fix(0.0, 149).isEmpty())
    val crossings = detector.fix(0.0, 150)
    assertEquals(listOf(PlaceCrossing(home, arrived = true, occurredAt = 30_000)), crossings)
    assertTrue(detector.fix(0.0, 180).isEmpty())
  }

  @Test
  fun leaveFiresOnlyAfterTwoMinutesOutside() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(500.0, 60).isEmpty())
    assertTrue(detector.fix(500.0, 170).isEmpty())
    assertEquals(listOf(PlaceCrossing(home, arrived = false, occurredAt = 60_000)), detector.fix(500.0, 180))
  }

  @Test
  fun jitterAtTheBoundaryIsAbsorbed() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    val boundary = listOf(140.0, 170.0, 145.0, 190.0, 130.0, 175.0, 149.0, 160.0, 120.0, 200.0, 140.0)
    val crossings = boundary.flatMapIndexed { index, meters -> detector.fix(meters, 30L * (index + 1)) }
    assertTrue(crossings.isEmpty())
  }

  @Test
  fun aBriefTripOutsideThatReturnsWithinTwoMinutesIsIgnored() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(400.0, 30).isEmpty())
    assertTrue(detector.fix(400.0, 120).isEmpty())
    assertTrue(detector.fix(0.0, 140).isEmpty())
    assertTrue(detector.fix(400.0, 200).isEmpty())
    assertTrue(detector.fix(400.0, 300).isEmpty())
    assertEquals(1, detector.fix(400.0, 320).size)
  }

  @Test
  fun inaccurateFixesAreIgnored() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(2_000.0, 30, accuracy = 500.0).isEmpty())
    assertTrue(detector.fix(2_000.0, 300, accuracy = 500.0).isEmpty())
    assertTrue(detector.fix(0.0, 330).isEmpty())
  }

  @Test
  fun aNewPlaceStartsSilently() {
    val detector = PlaceDwellDetector()
    val school = PlaceGeofence("group-1", "school", north(0.0), home.longitude, 100.0)
    detector.fix(0.0, 0)
    assertTrue((30L..600L step 30).flatMap { detector.fix(0.0, it, listOf(home, school)) }.isEmpty())
  }

  @Test
  fun aMovedOrResizedPlaceStartsSilently() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    detector.fix(1_000.0, 30)
    val moved = home.copy(latitude = north(1_000.0))
    assertTrue((60L..600L step 30).flatMap { detector.fix(1_000.0, it, listOf(moved)) }.isEmpty())
    val resized = moved.copy(radiusMeters = 2_000.0)
    assertTrue((630L..900L step 30).flatMap { detector.fix(0.0, it, listOf(resized)) }.isEmpty())
  }

  @Test
  fun aPendingArrivalIsDroppedWhenThePlaceMoves() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    detector.fix(0.0, 30)
    val moved = home.copy(radiusMeters = 120.0)
    assertTrue((60L..600L step 30).flatMap { detector.fix(0.0, it, listOf(moved)) }.isEmpty())
  }

  @Test
  fun resetMakesTheNextFixAStartingStateAgain() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    detector.fix(0.0, 30)
    detector.reset()
    assertTrue((60L..600L step 30).flatMap { detector.fix(0.0, it) }.isEmpty())
  }

  @Test
  fun outOfOrderFixesAreIgnored() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 300)
    assertTrue(detector.fix(0.0, 100).isEmpty())
    assertTrue(detector.fix(0.0, 330).isEmpty())
    assertEquals(1, detector.fix(0.0, 450).size)
  }

  @Test
  fun distanceMatchesAKnownValue() {
    val meters = PlaceDwellDetector.distanceMeters(51.5007, -0.1246, 48.8584, 2.2945)
    assertTrue(meters in 340_000.0..342_000.0)
  }
}
