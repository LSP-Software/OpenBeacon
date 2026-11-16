package expo.modules.openbeacontracking.crypto

import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.json.JSONObject

class TrackingPointCodecTest {
  private val vectors =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("tracking-point-v2.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private fun encode(point: JSONObject): ByteArray? {
    val battery = point.getJSONObject("battery")
    return TrackingPointCodec.encode(
      latitude = point.getDouble("latitude"),
      longitude = point.getDouble("longitude"),
      timestampMillis = point.getLong("time"),
      stayUntilMillis = if (point.isNull("stayUntil")) null else point.getLong("stayUntil"),
      accuracyMeters = if (point.isNull("accuracy")) null else point.getDouble("accuracy"),
      speedMetersPerSecond = if (point.isNull("speed")) null else point.getDouble("speed"),
      batteryLevel = if (battery.isNull("level")) null else battery.getInt("level"),
      batteryCharging = battery.getBoolean("charging"),
    )
  }

  private fun hex(bytes: ByteArray?) = bytes?.joinToString("") { "%02x".format(it) }

  @Test
  fun vectorFileMatchesTheLockedVersionAndLength() {
    assertEquals(TrackingPointCodec.VERSION, vectors.getInt("version"))
    assertEquals(TrackingPointCodec.LENGTH, vectors.getInt("length"))
  }

  @Test
  fun encodesEachPointToTheCommittedBytes() {
    val cases = vectors.getJSONArray("encode")
    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      assertEquals(testCase.getString("name") to testCase.getString("hex"), testCase.getString("name") to hex(encode(testCase.getJSONObject("point"))))
    }
  }

  @Test
  fun refusesEachRejectedPoint() {
    val cases = vectors.getJSONArray("encodeReject")
    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      assertNull(encode(testCase.getJSONObject("point")), testCase.getString("name"))
    }
  }

  @Test
  fun refusesCoordinatesThatArentFinite() {
    for ((latitude, longitude) in listOf(Double.NaN to -0.1278, 51.5074 to Double.POSITIVE_INFINITY)) {
      assertNull(TrackingPointCodec.encode(latitude, longitude, 0L, null, null, null, null, false))
    }
  }

  @Test
  fun writesAccuracyAndSpeedThatArentFiniteAsUnknown() {
    assertEquals(
      hex(TrackingPointCodec.encode(51.5074, -0.1278, 1_783_968_300_000L, null, null, null, 72, false)),
      hex(TrackingPointCodec.encode(51.5074, -0.1278, 1_783_968_300_000L, null, Double.NaN, Double.POSITIVE_INFINITY, 72, false)),
    )
  }
}
