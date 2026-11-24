package expo.modules.openbeacontracking.capture

import expo.modules.openbeacontracking.places.PlaceGeofence
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
    speed: Double? = null,
  ) = onFix(places, north(metersNorth), home.longitude, accuracy, atSeconds * 1_000, speed)

  @Test
  fun firstFixSetsTheStartingStateWithoutATransition() {
    val inside = PlaceDwellDetector()
    val outside = PlaceDwellDetector()
    assertTrue((0L..300L step 30).flatMap { inside.fix(0.0, it) }.isEmpty())
    assertTrue((0L..300L step 30).flatMap { outside.fix(1_000.0, it) }.isEmpty())
  }

  @Test
  fun aClearStillArrivalFiresAfterFortyFiveSeconds() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    assertTrue(detector.fix(0.0, 30, speed = 0.2).isEmpty())
    assertTrue(detector.isConfirming(30_000))
    assertTrue(detector.fix(0.0, 60, speed = 0.2).isEmpty())
    assertEquals(listOf(PlaceCrossing(home, arrived = true, occurredAt = 30_000)), detector.fix(0.0, 75, speed = 0.2))
    assertFalse(detector.isConfirming(75_000))
    assertTrue(detector.fix(0.0, 90).isEmpty())
  }

  @Test
  fun anUnclearArrivalStillWaitsTwoMinutes() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    assertTrue(detector.fix(100.0, 30, accuracy = 80.0).isEmpty())
    assertTrue(detector.fix(100.0, 90, accuracy = 80.0).isEmpty())
    assertTrue(detector.fix(100.0, 149, accuracy = 80.0).isEmpty())
    assertEquals(listOf(PlaceCrossing(home, arrived = true, occurredAt = 30_000)), detector.fix(100.0, 150, accuracy = 80.0))
  }

  @Test
  fun walkingThroughAPlaceIsNotAQuickArrival() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    assertTrue((10L..110L step 10).flatMap { detector.fix(0.0, it, speed = 1.4) }.isEmpty())
    assertTrue(detector.fix(1_000.0, 115, speed = 1.4).isEmpty())
  }

  @Test
  fun stoppingBrieflyAtLightsInsideAPlaceIsNotAnArrival() {
    val detector = PlaceDwellDetector()
    detector.fix(1_000.0, 0)
    assertTrue(detector.fix(0.0, 10, speed = 12.0).isEmpty())
    assertTrue((20L..60L step 10).flatMap { detector.fix(0.0, it, speed = 0.0) }.isEmpty())
    assertTrue(detector.fix(0.0, 70, speed = 8.0).isEmpty())
    assertTrue(detector.fix(1_000.0, 80, speed = 12.0).isEmpty())
  }

  @Test
  fun aClearDepartureFiresAfterThirtySecondsOfMovingAway() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(500.0, 60, speed = 12.0).isEmpty())
    assertTrue(detector.fix(500.0, 80, speed = 12.0).isEmpty())
    assertEquals(listOf(PlaceCrossing(home, arrived = false, occurredAt = 60_000)), detector.fix(800.0, 90, speed = 12.0))
  }

  @Test
  fun aJumpOutsideWithoutSpeedStillWaitsTwoMinutes() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(400.0, 60).isEmpty())
    assertTrue(detector.fix(400.0, 170).isEmpty())
    assertEquals(listOf(PlaceCrossing(home, arrived = false, occurredAt = 60_000)), detector.fix(400.0, 180))
  }

  @Test
  fun anUnclearDepartureStillWaitsTwoMinutes() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(200.0, 60, accuracy = 40.0, speed = 1.0).isEmpty())
    assertTrue(detector.fix(200.0, 170, accuracy = 40.0, speed = 1.0).isEmpty())
    assertEquals(listOf(PlaceCrossing(home, arrived = false, occurredAt = 60_000)), detector.fix(200.0, 180, accuracy = 40.0, speed = 1.0))
  }

  @Test
  fun confirmingStopsAfterTwoMinutesEvenWithoutAnotherClearFix() {
    val detector = PlaceDwellDetector()
    detector.fix(160.0, 0)
    detector.fix(150.0, 10)
    detector.fix(0.0, 20)
    assertTrue(detector.fix(185.0, 30).isEmpty())
    assertTrue((40L..300L step 10).flatMap { detector.fix(165.0, it) }.isEmpty())
    assertTrue(detector.isConfirming(149_000))
    assertFalse(detector.isConfirming(150_000))
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
  fun aStrayFixOutsideThatReturnsIsIgnored() {
    val detector = PlaceDwellDetector()
    detector.fix(0.0, 0)
    assertTrue(detector.fix(400.0, 30, speed = 2.0).isEmpty())
    assertTrue(detector.fix(0.0, 40).isEmpty())
    assertTrue(detector.fix(400.0, 200, speed = 2.0).isEmpty())
    assertTrue(detector.fix(0.0, 210).isEmpty())
    assertTrue(detector.fix(400.0, 240, speed = 2.0).isEmpty())
    assertEquals(1, detector.fix(400.0, 270, speed = 2.0).size)
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
