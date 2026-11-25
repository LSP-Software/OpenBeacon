package net.openbeacon.speedlimits

import kotlin.test.Test
import kotlin.test.assertEquals

class MaxSpeedTest {
  @Test
  fun plainNumbersAreKilometresPerHour() {
    assertEquals(MaxSpeed.Speed(500), parseMaxSpeed("50"))
    assertEquals(MaxSpeed.Speed(500), parseMaxSpeed("50 km/h"))
    assertEquals(MaxSpeed.Speed(500), parseMaxSpeed("50 kmh"))
    assertEquals(MaxSpeed.Speed(500), parseMaxSpeed("50 kph"))
    assertEquals(MaxSpeed.Speed(800), parseMaxSpeed(" 80 "))
  }

  @Test
  fun milesPerHourAreConvertedToKilometresPerHour() {
    assertEquals(MaxSpeed.Speed(483), parseMaxSpeed("30 mph"))
    assertEquals(MaxSpeed.Speed(1127), parseMaxSpeed("70mph"))
  }

  @Test
  fun knotsAreConvertedToKilometresPerHour() {
    assertEquals(MaxSpeed.Speed(185), parseMaxSpeed("10 knots"))
  }

  @Test
  fun noneMeansNoLimit() {
    assertEquals(MaxSpeed.NoLimit, parseMaxSpeed("none"))
  }

  @Test
  fun countryCodesAreImplicitLimits() {
    assertEquals(MaxSpeed.Implicit("GB:nsl_single"), parseMaxSpeed("GB:nsl_single"))
    assertEquals(MaxSpeed.Implicit("DE:urban"), parseMaxSpeed("DE:urban"))
    assertEquals(MaxSpeed.Implicit("GB:motorway"), parseMaxSpeed("GB:motorway"))
  }

  @Test
  fun anythingElseIsRejectedRatherThanGuessed() {
    listOf(
      "",
      "walk",
      "signals",
      "variable",
      "30-35 mph",
      "30;50",
      "2330 mph",
      "County Highway 27",
      "50 furlongs",
      "0",
      "-30",
      "30.5.1",
      "mph",
    ).forEach { assertEquals(MaxSpeed.Invalid, parseMaxSpeed(it), "value '$it'") }
  }

  @Test
  fun decimalSpeedsAreKept() {
    assertEquals(MaxSpeed.Speed(75), parseMaxSpeed("7.5"))
  }
}
