package expo.modules.openbeacontracking.capture

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HistoryFilterTest {
  private val start = 1_783_965_600_000L

  @Test
  fun aStraightWalkKeepsOnlyThePointsTheMaximumGapNeeds() {
    val fixes = track(0 until 60) { step -> Triple(step * 14.0, 0.0, 1.4) }
    val kept = run(HistoryFilter(), fixes)
    assertEquals(start, kept.first().fix.timestampMillis)
    assertTrue(kept.size <= 7, "kept ${kept.size}")
    assertTrue(kept.zipWithNext().all { (a, b) -> b.fix.timestampMillis - a.fix.timestampMillis <= 120_000L })
  }

  @Test
  fun fasterTravelShortensTheMaximumGap() {
    val fixes = track(0 until 60) { step -> Triple(step * 310.0, 0.0, 31.0) }
    val kept = run(HistoryFilter(), fixes)
    assertTrue(kept.zipWithNext().all { (a, b) -> b.fix.timestampMillis - a.fix.timestampMillis in 30_000L..40_000L })
  }

  @Test
  fun everyFixStaysWithinToleranceOfTheKeptRoute() {
    val routes =
      mapOf(
        "walking loop" to track(0 until 120) { step -> circle(step, radius = 80.0, speed = 1.4) },
        "town driving" to track(0 until 120) { step -> circle(step, radius = 300.0, speed = 12.0) },
        "stop and go" to track(0 until 120) { step ->
          val moving = step % 30 < 20
          Triple((step / 30) * 200.0 + if (moving) (step % 30) * 10.0 else 200.0, 0.0, if (moving) 1.0 else 0.0)
        },
      )
    for ((name, fixes) in routes) {
      val kept = run(HistoryFilter(), fixes).map { it.fix }
      assertTrue(kept.size < fixes.size, "$name kept every fix")
      for (fix in fixes.filter { it.timestampMillis <= kept.last().timestampMillis }) {
        val tolerance = max(15.0, 1.5 * (fix.speedMetersPerSecond ?: 0.0))
        val error = errorAgainst(kept, fix)
        assertTrue(error <= tolerance + 0.5, "$name: ${"%.1f".format(error)} m off at ${fix.timestampMillis - start} ms")
      }
    }
  }

  @Test
  fun aBrokenLineKeepsThePreviousFixOneFixLate() {
    val filter = HistoryFilter()
    val fixes = track(0 until 4) { step -> if (step < 3) Triple(step * 14.0, 0.0, 1.4) else Triple(28.0, 40.0, 1.4) }
    assertEquals(listOf(fixes[0]), filter.onFix(fixes[0]) { true }.map { it.fix })
    assertTrue(filter.onFix(fixes[1]) { true }.isEmpty())
    assertTrue(filter.onFix(fixes[2]) { true }.isEmpty())
    assertEquals(listOf(fixes[2]), filter.onFix(fixes[3]) { true }.map { it.fix })
  }

  @Test
  fun aStaySavesOneArrivalThenUpdatesItsUntilTimeAndClosesOnLeaving() {
    val walkIn = track(0 until 6) { step -> Triple(step * 14.0, 0.0, 1.4) }
    val still = track(6 until 66) { step -> Triple(70.0 + jitter(step), jitter(step + 7), 0.0) }.map { it.copy(timestampMillis = start + 60_000L + (it.timestampMillis - start - 60_000L) * 2) }
    val leftAt = still.last().timestampMillis
    val walkOut = (1..12).map { step -> fix(leftAt + step * 10_000L, 70.0 + step * 20.0, 0.0, 2.0) }
    val records = run(HistoryFilter(), walkIn + still + walkOut)
    val stays = records.filter { it.stayUntil != null }

    assertTrue(stays.size >= 4)
    assertEquals(1, stays.map { it.fix.timestampMillis }.toSet().size)
    assertTrue(stays.first().fix.timestampMillis in walkIn[2].timestampMillis..still.first().timestampMillis)
    assertTrue(stays.zipWithNext().all { (a, b) -> b.stayUntil!! > a.stayUntil!! })
    assertTrue(stays.zipWithNext().dropLast(1).all { (a, b) -> b.stayUntil!! - a.stayUntil!! >= 300_000L })
    assertEquals(walkOut[1].timestampMillis, stays.last().stayUntil)
    val during = records.filter { it.stayUntil == null && it.fix.timestampMillis in stays.first().stayUntil!!..walkOut[1].timestampMillis }
    assertTrue(during.isEmpty(), "kept route points during a stay")
    assertTrue(records.last().stayUntil == null && records.last().fix.timestampMillis > walkOut[1].timestampMillis)
    val centre = stays.last().fix
    assertTrue(PlaceDwellDetector.distanceMeters(centre.latitude, centre.longitude, latitude(0.0), longitude(70.0)) < 5.0)
  }

  @Test
  fun aStayIsSplitAtEachUtcHourSoEveryHourOfItIsFiledInThatHour() {
    val hour = 3_600_000L
    val still = (0 until 30).map { step -> fix(start + 40 * 60_000L + step * 5 * 60_000L, jitter(step), jitter(step + 3), 0.0) }
    val records = run(HistoryFilter(), still)
    val parts = records.filter { it.stayUntil != null }.groupBy { it.fix.timestampMillis }.map { (_, copies) -> copies.last() }

    assertEquals(listOf(start + 40 * 60_000L, start + hour, start + 2 * hour, start + 3 * hour), parts.map { it.fix.timestampMillis })
    assertEquals(listOf(start + hour, start + 2 * hour, start + 3 * hour), parts.dropLast(1).map { it.stayUntil })
    assertEquals(still.last().timestampMillis, parts.last().stayUntil)
    assertTrue(parts.all { it.fix.fixId == null || it == parts.first() })
    val centre = parts.first().fix
    assertTrue(parts.all { PlaceDwellDetector.distanceMeters(centre.latitude, centre.longitude, it.fix.latitude, it.fix.longitude) < 10.0 })
  }

  @Test
  fun aLongSilenceEndsTheStaySoHistoryShowsAGap() {
    val still = track(0 until 20) { step -> Triple(jitter(step), jitter(step + 3), 0.0) }.map { it.copy(timestampMillis = start + (it.timestampMillis - start) * 3) }
    val afterGap = fix(still.last().timestampMillis + 3_600_000L, 0.0, 0.0, 0.0)
    val filter = HistoryFilter()
    assertTrue(run(filter, still).any { it.stayUntil != null })
    val resumed = filter.onFix(afterGap) { true }
    assertEquals(still.last().timestampMillis, resumed.first().stayUntil)
    assertEquals(afterGap, resumed.last().fix)
    assertNull(resumed.last().stayUntil)
  }

  @Test
  fun inaccurateAndOutOfOrderFixesAreIgnored() {
    val filter = HistoryFilter()
    val first = fix(start, 0.0, 0.0, 1.0)
    assertEquals(1, filter.onFix(first) { true }.size)
    assertTrue(filter.onFix(first.copy(timestampMillis = start + 500_000L, accuracyMeters = 500.0, latitude = 10.0)) { true }.isEmpty())
    assertTrue(filter.onFix(first.copy(timestampMillis = start - 1)) { true }.isEmpty())
  }

  @Test
  fun anEmptyAllowanceDropsTheUnkeptRouteAndTheNextTokenStartsAtTheCurrentFix() {
    val filter = HistoryFilter()
    val fixes = track(0 until 40) { second -> Triple(second * 14.0, if (second % 2 == 0) 0.0 else 30.0, 1.4) }
    var tokens = 1
    val kept = fixes.flatMap { fix -> filter.onFix(fix) { if (tokens > 0) { tokens -= 1; true } else false } }
    assertEquals(listOf(fixes[0]), kept.map { it.fix })
    tokens = 1
    val next = fix(fixes.last().timestampMillis + 10_000L, 40 * 14.0, 0.0, 1.4)
    assertEquals(listOf(next), filter.onFix(next) { if (tokens > 0) { tokens -= 1; true } else false }.map { it.fix })
  }

  @Test
  fun aPhoneSittingStillIndoorsWithPoorAccuracyStartsOneStay() {
    val fixes = (0..110).map { step ->
      val angle = step * 2.5
      fix(start + step * 30_000L, 30.0 * cos(angle), 30.0 * sin(angle), 0.0).copy(accuracyMeters = 35.0)
    }
    val records = run(HistoryFilter(), fixes)
    val stays = records.filter { it.stayUntil != null }
    assertEquals(1, stays.map { it.fix.timestampMillis }.toSet().size)
    assertTrue(stays.first().fix.timestampMillis <= start + 30_000L)
    assertTrue(stays.last().stayUntil!! >= fixes.last().timestampMillis - 300_000L)
    val points = records.filter { it.stayUntil == null }
    assertTrue(points.size <= 8, "kept ${points.size} route points")
  }

  @Test
  fun oneOutlierDuringAStayIsDroppedAndTheStayCarriesOn() {
    val still = track(0 until 180) { step -> Triple(jitter(step), jitter(step + 5), 0.0) }
    val outlier = still[90].copy(latitude = latitude(300.0), timestampMillis = still[90].timestampMillis + 5_000L, fixId = null)
    val records = run(HistoryFilter(), still.take(91) + outlier + still.drop(91))
    val stays = records.filter { it.stayUntil != null }
    assertEquals(1, stays.map { it.fix.timestampMillis }.toSet().size)
    assertTrue(still.last().timestampMillis - stays.last().stayUntil!! < 300_000L)
    val points = records.filter { it.stayUntil == null }
    assertTrue(points.none { it.fix.timestampMillis >= stays.first().fix.timestampMillis + 180_000L }, "kept route points during the stay")
    assertTrue(records.none { it.fix == outlier })
  }

  @Test
  fun leavingClosesTheStayAtTheLastFixInsideAndTheRouteStartsAtTheFirstFixOutside() {
    val still = track(0 until 60) { step -> Triple(jitter(step), jitter(step + 5), 0.0) }
    val leftAt = still.last().timestampMillis
    val walkOut = (1..6).map { step -> fix(leftAt + step * 10_000L, step * 25.0, 0.0, 2.5) }
    val filter = HistoryFilter()
    run(filter, still + walkOut.take(3))
    val departure = filter.onFix(walkOut[3]) { true }
    assertEquals(walkOut[1].timestampMillis, departure.first().stayUntil)
    assertEquals(walkOut[2], departure[1].fix)
    assertNull(departure[1].stayUntil)
  }

  @Test
  fun aFixLongBeforeAWrongFutureFixRestartsHistoryInsteadOfFreezingIt() {
    val filter = HistoryFilter()
    val first = fix(start, 0.0, 0.0, 1.0)
    assertEquals(1, filter.onFix(first) { true }.size)
    assertEquals(1, filter.onFix(fix(start + 86_400_000L, 0.0, 0.0, 1.0)) { true }.size)
    assertTrue(filter.onFix(fix(start + 86_400_000L - 60_000L, 0.0, 0.0, 1.0)) { true }.isEmpty())
    val corrected = fix(start + 10_000L, 14.0, 0.0, 1.0)
    assertEquals(listOf(corrected), filter.onFix(corrected) { true }.map { it.fix })
    assertTrue(filter.onFix(fix(start + 20_000L, 28.0, 0.0, 1.0)) { true }.isEmpty())
  }

  @Test
  fun aFutureAllowanceTimeIsRebasedSoTheBucketStillRefills() {
    val settings = HistoryFilterSettings()
    val future = HistoryAllowance(0.0, start + 86_400_000L)
    assertNull(future.take(start, settings))
    val rebased = future.refill(start, settings)
    assertEquals(HistoryAllowance(0.0, start), rebased)
    assertNull(rebased.take(start + 29_000L, settings))
    assertEquals(0.0, rebased.take(start + 30_000L, settings)!!.tokens, 1e-9)
  }

  @Test
  fun theAllowanceRefillsOnePointEveryThirtySeconds() {
    val settings = HistoryFilterSettings()
    var allowance = HistoryAllowance.full(start, settings)
    repeat(2_880) { allowance = allowance.take(start, settings)!! }
    assertNull(allowance.take(start, settings))
    assertNull(allowance.take(start + 29_000L, settings))
    allowance = allowance.take(start + 30_000L, settings)!!
    assertNull(allowance.take(start + 30_000L, settings))
    assertEquals(2_880.0, allowance.take(start + 200_000_000L, settings)!!.tokens + 1.0)
  }

  @Test
  fun handingOverMidRouteKeepsTheRouteTheFilterWouldHaveKept() {
    val fixes = track(0 until 60) { step -> Triple(step * 14.0, 0.0, 1.4) }
    val before = HistoryFilter()
    val kept = run(before, fixes.take(25))
    val (after, closing) = before.handOver { true }
    assertTrue(closing.isEmpty())
    assertEquals(run(HistoryFilter(), fixes), kept + run(after, fixes.drop(25)))
  }

  @Test
  fun handingOverMidStayClosesTheOldStayAndStartsANewOneAtTheNextFix() {
    val still = track(0 until 80) { step -> Triple(jitter(step), jitter(step + 5), 0.0) }
    val walkOut = (1..6).map { step -> fix(still.last().timestampMillis + step * 10_000L, step * 25.0, 0.0, 2.5) }
    val before = HistoryFilter()
    val arrival = run(before, still.take(40)).single { it.stayUntil != null }
    val (after, closing) = before.handOver { true }
    assertEquals(listOf(arrival.fix.timestampMillis to still[39].timestampMillis), closing.map { it.fix.timestampMillis to it.stayUntil })
    val records = run(after, still.drop(40) + walkOut)
    val stays = records.filter { it.stayUntil != null }
    assertEquals(still[40].timestampMillis to still[40].timestampMillis, stays.first().fix.timestampMillis to stays.first().stayUntil)
    assertEquals(setOf(still[40].timestampMillis), stays.map { it.fix.timestampMillis }.toSet())
    assertEquals(walkOut[1].timestampMillis, stays.last().stayUntil)
    assertTrue(records.none { it.fix.timestampMillis < still[40].timestampMillis })
  }

  @Test
  fun aStayAlreadySentUpToItsLastFixHandsOverWithoutAnotherRecord() {
    val still = track(0 until 19) { step -> Triple(jitter(step), jitter(step + 5), 0.0) }
    val before = HistoryFilter()
    assertEquals(still.last().timestampMillis, run(before, still).last().stayUntil)
    assertTrue(before.handOver { true }.second.isEmpty())
  }

  @Test
  fun leavingStraightAfterAHandOverSendsNoStayInTheNewStream() {
    val still = track(0 until 40) { step -> Triple(jitter(step), jitter(step + 5), 0.0) }
    val walkOut = (1..6).map { step -> fix(still.last().timestampMillis + step * 10_000L, 100.0 + step * 25.0, 0.0, 2.5) }
    val before = HistoryFilter()
    run(before, still)
    val (after, closing) = before.handOver { true }
    assertEquals(still.last().timestampMillis, closing.single().stayUntil)
    val records = run(after, walkOut)
    assertTrue(records.none { it.stayUntil != null })
    assertEquals(walkOut[0], records.first().fix)
  }

  private fun run(
    filter: HistoryFilter,
    fixes: List<HistoryFix>,
  ) = fixes.flatMap { filter.onFix(it) { true } }

  private fun track(
    steps: IntRange,
    position: (Int) -> Triple<Double, Double, Double>,
  ) = steps.map { step ->
    val (east, north, speed) = position(step)
    fix(start + step * 10_000L, east, north, speed)
  }

  private fun circle(
    step: Int,
    radius: Double,
    speed: Double,
  ): Triple<Double, Double, Double> {
    val angle = step * 10.0 * speed / radius
    return Triple(radius * sin(angle), radius - radius * cos(angle), speed)
  }

  private fun jitter(seed: Int) = ((seed * 7_919) % 13 - 6).toDouble()

  private fun fix(
    timestampMillis: Long,
    east: Double,
    north: Double,
    speed: Double,
  ) = HistoryFix(latitude(north), longitude(east), timestampMillis, 8.0, speed, 80, false, timestampMillis)

  private fun latitude(north: Double) = 51.5 + north / 111_195.0

  private fun longitude(east: Double) = -0.1 + east / (111_195.0 * cos(51.5 * PI / 180))

  private fun errorAgainst(
    kept: List<HistoryFix>,
    fix: HistoryFix,
  ): Double {
    val after = kept.indexOfFirst { it.timestampMillis >= fix.timestampMillis }
    val to = kept[after]
    if (to.timestampMillis == fix.timestampMillis) return PlaceDwellDetector.distanceMeters(to.latitude, to.longitude, fix.latitude, fix.longitude)
    val from = kept[after - 1]
    val fraction = (fix.timestampMillis - from.timestampMillis).toDouble() / (to.timestampMillis - from.timestampMillis)
    return PlaceDwellDetector.distanceMeters(
      from.latitude + (to.latitude - from.latitude) * fraction,
      from.longitude + (to.longitude - from.longitude) * fraction,
      fix.latitude,
      fix.longitude,
    )
  }
}
