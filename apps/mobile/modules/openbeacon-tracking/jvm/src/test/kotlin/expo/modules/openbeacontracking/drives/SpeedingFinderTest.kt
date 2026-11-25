package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.DrivingEventType
import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONArray
import org.json.JSONObject

class SpeedingFinderTest {
  private val cases =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("speeding-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )
  private val origin = cases.getJSONObject("origin")
  private val originLatitude = origin.getDouble("latitude")
  private val originLongitude = origin.getDouble("longitude")
  private val metersPerLongitude = 111_320.0 * cos(Math.toRadians(originLatitude))

  private fun latitudeAt(y: Double) = originLatitude + y / 111_320.0

  private fun longitudeAt(x: Double) = originLongitude + x / metersPerLongitude

  private fun limit(json: JSONArray) =
    RoadLimit(RoadLimitSource.entries.first { it.code == json.getInt(0) }, json.getInt(1))

  private fun roads(case: JSONObject): SpeedLimitRoads? {
    if (case.optBoolean("noPack", false)) return null
    val list = case.getJSONArray("roads")
    val pieces =
      (0 until list.length()).map { index ->
        val road = list.getJSONObject(index)
        val points = road.getJSONArray("points")
        PackRoadPiece(
          roadId = index,
          roadClass = 1,
          oneway = road.getBoolean("oneway"),
          forward = limit(road.getJSONArray("forward")),
          backward = limit(road.getJSONArray("backward")),
          lonE5 = IntArray(points.length()) { (longitudeAt(points.getJSONArray(it).getDouble(0)) * 1e5).roundToInt() },
          latE5 = IntArray(points.length()) { (latitudeAt(points.getJSONArray(it).getDouble(1)) * 1e5).roundToInt() },
        )
      }
    return SpeedLimitRoads { _, _, _ -> pieces }
  }

  private fun fixes(case: JSONObject): List<DriveFix> {
    val start = case.getJSONArray("start")
    var x = start.getDouble(0)
    var y = start.getDouble(1)
    var time = cases.getLong("startTime")
    val fixes = mutableListOf<DriveFix>()
    val steps = case.getJSONArray("steps")
    for (index in 0 until steps.length()) {
      val step = steps.getJSONObject(index)
      if (step.has("pause")) {
        time += step.getInt("pause") * 1_000L
        continue
      }
      val move = step.getJSONObject("move")
      val speed = move.getDouble("speed")
      val every = move.optInt("every", 1)
      val heading = Math.toRadians(move.optDouble("heading", 90.0))
      repeat(move.getInt("count")) {
        time += every * 1_000L
        x += speed * every * sin(heading)
        y += speed * every * cos(heading)
        fixes +=
          DriveFix(
            timeMillis = time,
            latitude = latitudeAt(y),
            longitude = longitudeAt(x),
            speed = speed,
            accuracy = 5.0,
            batterySaver = move.optBoolean("batterySaver", false),
          )
      }
    }
    return fixes
  }

  @Test
  fun findsSpeedingInTheSharedCases() {
    val list = cases.getJSONArray("cases")
    for (index in 0 until list.length()) {
      val case = list.getJSONObject(index)
      val name = case.getString("name")
      val result = SpeedingFinder.find(fixes(case), roads(case))
      assertEquals(case.getBoolean("checked"), result.checked, "$name: checked")
      val expected = case.getJSONArray("events")
      assertEquals(expected.length(), result.events.size, "$name: event count")
      for (eventIndex in 0 until expected.length()) {
        val want = expected.getJSONObject(eventIndex)
        val got = result.events[eventIndex]
        assertEquals(DrivingEventType.SPEEDING, got.type, name)
        assertEquals(want.getDouble("offset"), got.timeOffsetSeconds, 0.001, "$name: offset")
        assertEquals(want.getDouble("duration"), got.durationSeconds, 0.001, "$name: duration")
        assertEquals(want.getDouble("peak"), got.peak, 0.01, "$name: peak")
        val limit = got.limit!!
        assertEquals(want.getInt("limit") / 36.0, limit.speed, 0.001, "$name: limit")
        assertEquals(want.getString("source"), limit.source.name, "$name: source")
        assertTrue(abs(got.latitude - originLatitude) < 0.01, "$name: position")
      }
    }
  }
}
