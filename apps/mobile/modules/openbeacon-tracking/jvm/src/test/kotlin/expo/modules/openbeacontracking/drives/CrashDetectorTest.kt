package expo.modules.openbeacontracking.drives

import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONObject

class CrashDetectorTest {
  private val cases =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("crash-detection-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private fun run(case: JSONObject): List<CrashSuspicion> {
    val startTime = cases.getLong("startTime")
    val origin = cases.getJSONObject("origin")
    val latitude = origin.getDouble("latitude")
    var longitude = origin.getDouble("longitude")
    var time = startTime
    var alertOpen = false
    val detector = CrashDetector { alertOpen }
    val suspicions = mutableListOf<CrashSuspicion>()
    val steps = case.getJSONArray("steps")
    for (index in 0 until steps.length()) {
      val step = steps.getJSONObject(index)
      if (step.has("alert")) {
        alertOpen = step.getBoolean("alert")
      } else if (step.has("move")) {
        val move = step.getJSONObject("move")
        val speed = move.getDouble("speed")
        val every = move.getInt("every")
        repeat(move.getInt("count")) {
          time += every * 1_000L
          longitude += speed * every / (111_320.0 * cos(Math.toRadians(latitude)))
          val fix =
            DriveFix(
              timeMillis = time,
              latitude = latitude,
              longitude = longitude,
              speed = speed,
              accuracy = 5.0,
              batterySaver = move.optBoolean("batterySaver", false),
            )
          detector.onFix(fix, inDrive = move.optBoolean("drive", true))?.let { suspicions += it }
        }
      } else {
        val jolt = step.getJSONObject("jolt")
        val at =
          if (jolt.has("at")) {
            startTime + (jolt.getDouble("at") * 1_000).roundToLong()
          } else {
            time + (jolt.getDouble("after") * 1_000).roundToLong()
          }
        detector.onMotion(at, jolt.getDouble("g") * 9.80665)?.let { suspicions += it }
      }
    }
    return suspicions
  }

  @Test
  fun sharedCases() {
    val all = cases.getJSONArray("cases")
    val startTime = cases.getLong("startTime")
    for (index in 0 until all.length()) {
      val case = all.getJSONObject(index)
      val name = case.getString("name")
      val expected = case.getJSONArray("suspicions")
      val actual = run(case)
      assertEquals(expected.length(), actual.size, name)
      for (at in 0 until expected.length()) {
        val want = expected.getJSONObject(at)
        val got = actual[at]
        assertEquals(startTime + (want.getDouble("time") * 1_000).roundToLong(), got.timeMillis, name)
        assertTrue(abs(want.getDouble("speedBefore") - got.speedBefore) < 0.05, name)
        assertTrue(abs(got.latitude - cases.getJSONObject("origin").getDouble("latitude")) < 0.01, name)
      }
    }
  }
}
