package expo.modules.openbeacontracking.drives

import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONObject

class DriveDetectorTest {
  private val cases =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("drive-detection-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private fun run(case: JSONObject, replayAt: Int? = null): List<DetectedDrive> {
    val startTime = cases.getLong("startTime")
    val origin = cases.getJSONObject("origin")
    val latitude = origin.getDouble("latitude")
    var longitude = origin.getDouble("longitude")
    var time = startTime
    var detector = DriveDetector()
    val drives = mutableListOf<DetectedDrive>()
    val steps = case.getJSONArray("steps")
    for (index in 0 until steps.length()) {
      if (index == replayAt) {
        val retained = detector.retainedFixes
        detector = DriveDetector()
        retained.forEach { fix -> detector.onFix(fix).finished?.let { drives += it } }
      }
      val step = steps.getJSONObject(index)
      val name = case.getString("name")
      when {
        step.has("move") -> {
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
                speed = if (move.optBoolean("reportSpeed", true)) speed else null,
                accuracy = 5.0,
                batterySaver = move.optBoolean("batterySaver", false),
              )
            detector.onFix(fix).finished?.let { drives += it }
          }
        }
        step.has("jitter") -> {
          val jitter = step.getJSONObject("jitter")
          val every = jitter.getInt("every")
          val offset = jitter.getDouble("metres") / (111_320.0 * cos(Math.toRadians(latitude)))
          for (count in 1..jitter.getInt("count")) {
            time += every * 1_000L
            val fix =
              DriveFix(
                timeMillis = time,
                latitude = latitude,
                longitude = if (count % 2 == 1) longitude + offset else longitude,
                speed = if (jitter.has("speed")) jitter.getDouble("speed") else null,
                accuracy = 5.0,
                batterySaver = false,
              )
            detector.onFix(fix).finished?.let { drives += it }
          }
        }
        step.has("arrive") -> detector.onPlaceArrive()?.let { drives += it }
        step.has("interrupt") -> detector.interrupt()?.let { drives += it }
        step.has("discard") -> detector.discard()
        step.has("expect") -> {
          val expect = step.getJSONObject("expect")
          assertEquals(expect.getBoolean("fast"), detector.wantsFastFixes, "$name: fast fixes at step $index")
          assertEquals(expect.getBoolean("recording"), detector.recording, "$name: recording at step $index")
        }
      }
    }
    return drives
  }

  private fun check(case: JSONObject, drives: List<DetectedDrive>) {
    val name = case.getString("name")
    val startTime = cases.getLong("startTime")
    val expected = case.getJSONArray("drives")
    assertEquals(expected.length(), drives.size, "$name: number of drives")
    for (index in 0 until expected.length()) {
      val want = expected.getJSONObject(index)
      val drive = drives[index]
      assertEquals(startTime + want.getLong("start") * 1_000L, drive.start.timeMillis, "$name: start")
      assertEquals(startTime + want.getLong("end") * 1_000L, drive.end.timeMillis, "$name: end")
      assertEquals((drive.end.timeMillis - drive.start.timeMillis) / 1_000.0, drive.durationSeconds, "$name: duration")
      for (field in listOf("distance", "checkedDistance")) {
        val value = if (field == "distance") drive.distanceMeters else drive.checkedDistanceMeters
        assertTrue(abs(value - want.getDouble(field)) <= want.getDouble(field) * 0.005 + 0.5, "$name: $field $value")
      }
      assertEquals(want.getDouble("topSpeed"), drive.topSpeed, 0.05, "$name: top speed")
      assertEquals(drive.distanceMeters / drive.durationSeconds, drive.averageSpeed, 0.01, "$name: average speed")
    }
  }

  @Test
  fun sharedCases() {
    val list = cases.getJSONArray("cases")
    for (index in 0 until list.length()) {
      val case = list.getJSONObject(index)
      check(case, run(case))
    }
  }

  @Test
  fun replayingRetainedFixesRestoresTheDriveInProgress() {
    val list = cases.getJSONArray("cases")
    for (index in 0 until list.length()) {
      val case = list.getJSONObject(index)
      val steps = case.getJSONArray("steps")
      for (at in 1 until steps.length()) {
        if (steps.getJSONObject(at).has("expect")) continue
        check(case, run(case, replayAt = at))
      }
    }
  }
}
