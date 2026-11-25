package net.openbeacon.speedlimits

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RoadLimitsTest {
  private val defaults = DefaultSpeeds.load()

  private fun resolve(countryCode: String, vararg tags: Pair<String, String>) =
    resolveRoad(tags.toMap(), countryCode, defaults)

  private fun both(limit: Limit) = limit to limit

  private fun limits(road: RoadAttributes?) = road?.let { it.forward to it.backward }

  @Test
  fun aNumericMaxspeedIsPosted() {
    assertEquals(
      both(Limit(LimitSource.Posted, 483)),
      limits(resolve("GB", "highway" to "residential", "maxspeed" to "30 mph")),
    )
    assertEquals(
      both(Limit(LimitSource.Posted, 500)),
      limits(resolve("DE", "highway" to "primary", "maxspeed" to "50")),
    )
  }

  @Test
  fun maxspeedNoneIsAPostedRoadWithNoLimit() {
    assertEquals(
      both(Limit(LimitSource.Posted, NO_LIMIT)),
      limits(resolve("DE", "highway" to "motorway", "maxspeed" to "none")),
    )
  }

  @Test
  fun aNationalSpeedLimitCodeIsSetByTheRoadType() {
    assertEquals(
      both(Limit(LimitSource.RoadType, 966)),
      limits(resolve("GB", "highway" to "secondary", "maxspeed" to "GB:nsl_single")),
    )
    assertEquals(
      both(Limit(LimitSource.RoadType, 1127)),
      limits(resolve("GB", "highway" to "trunk", "maxspeed:type" to "GB:nsl_dual")),
    )
  }

  @Test
  fun anUntaggedMotorwayTakesTheExactRoadTypeLimit() {
    assertEquals(
      both(Limit(LimitSource.RoadType, 1127)),
      limits(resolve("GB", "highway" to "motorway")),
    )
  }

  @Test
  fun builtUpGuessesAndFallbacksAreUnknown() {
    assertEquals(
      both(Limit(LimitSource.Unknown, 0)),
      limits(resolve("GB", "highway" to "residential")),
    )
    assertEquals(
      both(Limit(LimitSource.Unknown, 0)),
      limits(resolve("GB", "highway" to "unclassified")),
    )
  }

  @Test
  fun junkIsUnknownAndNeverReplacedByADefault() {
    assertEquals(
      both(Limit(LimitSource.Unknown, 0)),
      limits(resolve("GB", "highway" to "motorway", "maxspeed" to "30-35 mph")),
    )
  }

  @Test
  fun directionalLimitsAreKeptApart() {
    assertEquals(
      Limit(LimitSource.Posted, 483) to Limit(LimitSource.Posted, 644),
      limits(
        resolve(
          "GB",
          "highway" to "primary",
          "maxspeed:forward" to "30 mph",
          "maxspeed:backward" to "40 mph",
        )
      ),
    )
    assertEquals(
      Limit(LimitSource.Posted, 500) to Limit(LimitSource.Posted, 300),
      limits(resolve("DE", "highway" to "primary", "maxspeed" to "50", "maxspeed:backward" to "30")),
    )
  }

  @Test
  fun onewayDirectionIsRead() {
    assertEquals(Oneway.No, resolve("GB", "highway" to "primary")?.oneway)
    assertEquals(Oneway.Forward, resolve("GB", "highway" to "primary", "oneway" to "yes")?.oneway)
    assertEquals(Oneway.Reverse, resolve("GB", "highway" to "primary", "oneway" to "-1")?.oneway)
    assertEquals(Oneway.Forward, resolve("GB", "highway" to "motorway")?.oneway)
    assertEquals(Oneway.No, resolve("GB", "highway" to "motorway", "oneway" to "no")?.oneway)
    assertEquals(
      Oneway.Forward,
      resolve("GB", "highway" to "primary", "junction" to "roundabout")?.oneway,
    )
  }

  @Test
  fun onlyDrivableRoadsAreKept() {
    assertEquals(RoadClass.Motorway, resolve("GB", "highway" to "motorway")?.roadClass)
    assertEquals(RoadClass.TrunkLink, resolve("GB", "highway" to "trunk_link")?.roadClass)
    assertEquals(RoadClass.Service, resolve("GB", "highway" to "service")?.roadClass)
    listOf("footway", "cycleway", "path", "track", "bridleway", "steps", "pedestrian", "busway", "construction", "proposed")
      .forEach { assertNull(resolve("GB", "highway" to it), it) }
    assertNull(resolve("GB", "highway" to "service", "service" to "parking_aisle"))
    assertNull(resolve("GB", "highway" to "service", "service" to "driveway"))
    assertNull(resolve("GB", "highway" to "residential", "area" to "yes"))
    assertNull(resolve("GB", "building" to "yes"))
  }
}
