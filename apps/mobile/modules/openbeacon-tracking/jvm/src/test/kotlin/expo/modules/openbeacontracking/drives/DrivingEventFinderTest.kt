package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.DrivingEvent
import expo.modules.openbeacontracking.crypto.DrivingEventType
import expo.modules.openbeacontracking.crypto.SpeedLimit
import expo.modules.openbeacontracking.crypto.SpeedLimitSource
import java.nio.charset.StandardCharsets
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import org.json.JSONArray
import org.json.JSONObject

class DrivingEventFinderTest {
  private val cases =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("driving-events-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private class Second(
    val slope: Double,
    val accel: String?,
    val tilt: Boolean,
  )

  private fun vector(array: JSONArray) = DoubleArray(3) { array.getDouble(it) }

  private fun run(case: JSONObject): FoundDrivingEvents {
    val startTime = cases.getLong("startTime")
    val latitude = cases.getJSONObject("origin").getDouble("latitude")
    var longitude = cases.getJSONObject("origin").getDouble("longitude")
    var speed = case.getDouble("from")
    var time = startTime
    val fixes = mutableListOf(DriveFix(time, latitude, longitude, speed, 5.0, false))
    val seconds = mutableListOf<Second>()

    fun add(segments: JSONArray) {
      for (index in 0 until segments.length()) {
        val segment = segments.getJSONObject(index)
        if (segment.has("repeat")) {
          val repeat = segment.getJSONObject("repeat")
          repeat(repeat.getInt("times")) { add(repeat.getJSONArray("segments")) }
          continue
        }
        val every = segment.optInt("every", 1)
        val count = segment.getInt("seconds") / every
        val from = speed
        val to = segment.getDouble("to")
        for (step in 1..count) {
          val next = from + (to - from) * step / count
          repeat(every) { seconds += Second((next - speed) / every, segment.optString("accel").ifEmpty { null }, segment.optBoolean("tilt")) }
          speed = next
          time += every * 1_000L
          longitude += speed * every / (111_320.0 * cos(Math.toRadians(latitude)))
          fixes += DriveFix(time, latitude, longitude, speed, 5.0, segment.optBoolean("batterySaver"))
        }
      }
    }
    add(case.getJSONArray("segments"))

    val finder = DrivingEventFinder()
    val phone = cases.getJSONObject("phone")
    var up = vector(phone.getJSONArray("up"))
    var forward = vector(phone.getJSONArray("forward"))
    val lag = case.optInt("accelLagSeconds", 0)
    val samples = mutableListOf<AccelerometerSample>()
    for ((index, second) in seconds.withIndex()) {
      if (second.accel == "none") continue
      val slope = if (second.accel == null) seconds.getOrNull(index - lag)?.slope ?: 0.0 else 0.0
      val side = doubleArrayOf(up[1] * forward[2] - up[2] * forward[1], up[2] * forward[0] - up[0] * forward[2], up[0] * forward[1] - up[1] * forward[0])
      val angle = Math.toRadians(40.0)
      val gravity = if (second.tilt) DoubleArray(3) { up[it] * cos(angle) + side[it] * sin(angle) } else up
      for (sample in 0 until 10) {
        val at = startTime + index * 1_000L + sample * 100L
        val value =
          when (second.accel) {
            "bump" -> DoubleArray(3) { gravity[it] * (9.81 + if (sample % 2 == 0) 8 else -8) + if (sample == 3) forward[it] * 6 else 0.0 }
            "drop" -> if (sample < 5) DoubleArray(3) { gravity[it] * 0.5 } else DoubleArray(3) { forward[it] * 25 + gravity[it] * 9.81 }
            "turn" -> DoubleArray(3) { gravity[it] * 9.81 + side[it] * 5 }
            "knock" -> DoubleArray(3) { gravity[it] * 9.81 + if (sample < 5) 0.0 else forward[it] * 25 }
            else -> DoubleArray(3) { gravity[it] * 9.81 + forward[it] * slope }
          }
        samples += AccelerometerSample(at, value[0], value[1], value[2])
      }
      if (second.accel == "knock") {
        val dropped = cases.getJSONObject("dropped")
        up = vector(dropped.getJSONArray("up"))
        forward = vector(dropped.getJSONArray("forward"))
      }
    }
    samples.chunked(100).reversed().forEach { finder.onAccelerometer(it) }
    val signals = case.optJSONArray("signals") ?: JSONArray()
    for (index in 0 until signals.length()) {
      val signal = signals.getJSONObject(index)
      finder.onPhoneUse(PhoneUseChange(startTime + signal.getLong("at") * 1_000L, PhoneUseSignal.valueOf(signal.getString("type"))))
    }
    return finder.find(fixes)
  }

  @Test
  fun sharedCases() {
    val list = cases.getJSONArray("cases")
    for (index in 0 until list.length()) {
      val case = list.getJSONObject(index)
      val name = case.getString("name")
      val found = run(case)
      val counts = case.getJSONObject("counts")
      for (type in DrivingEventType.entries) {
        assertEquals(counts.optInt(type.name, 0), found.counts[type], "$name: ${type.name} count")
      }
      case.optJSONArray("events")?.let { events ->
        assertEquals(events.length(), found.events.size, "$name: number of events")
        for (at in 0 until events.length()) {
          val want = events.getJSONObject(at)
          val event = found.events[at]
          assertEquals(want.getString("type"), event.type.name, "$name: event $at type")
          assertEquals(want.getLong("start"), event.timeOffsetSeconds.roundToLong(), "$name: event $at start")
          assertEquals(want.getDouble("duration"), event.durationSeconds, 0.001, "$name: event $at duration")
          assertEquals(want.getDouble("peak"), event.peak, 0.05, "$name: event $at peak")
        }
      }
      case.optJSONArray("leading")?.let { leading ->
        for (at in 0 until leading.length()) {
          val want = leading.getJSONObject(at)
          val event = found.events[at]
          assertEquals(want.getString("type"), event.type.name, "$name: leading $at type")
          if (want.has("peak")) assertEquals(want.getDouble("peak"), event.peak, 0.05, "$name: leading $at peak")
          if (want.has("duration")) assertEquals(want.getDouble("duration"), event.durationSeconds, 0.001, "$name: leading $at duration")
        }
      }
      case.optJSONObject("kept")?.let { kept ->
        val first = found.events.take(48)
        for (type in DrivingEventType.entries) {
          assertEquals(kept.optInt(type.name, 0), first.count { it.type == type }, "$name: ${type.name} kept")
        }
      }
    }
  }

  @Test
  fun speedingIsRankedBesideSensorEventsByItsShareOverTheLimit() {
    fun event(
      type: DrivingEventType,
      offset: Double,
      duration: Double,
      peak: Double,
      limit: Double? = null,
    ) = DrivingEvent(type, offset, duration, 51.5, -0.1, peak, limit?.let { SpeedLimit(it, SpeedLimitSource.POSTED) })
    val combined =
      DrivingEventFinder.mostSevereFirst(
        listOf(
          event(DrivingEventType.HARD_BRAKING, 10.0, 1.0, 4.0),
          event(DrivingEventType.SPEEDING, 20.0, 60.0, 35.0, 31.29),
          event(DrivingEventType.RAPID_ACCELERATION, 30.0, 1.0, 3.5),
          event(DrivingEventType.HARD_BRAKING, 40.0, 2.0, 5.0),
          event(DrivingEventType.SPEEDING, 50.0, 20.0, 20.0, 13.41),
          event(DrivingEventType.PHONE_USE, 60.0, 8.0, 20.0),
        ),
      )
    assertEquals(
      listOf(
        DrivingEventType.PHONE_USE,
        DrivingEventType.SPEEDING,
        DrivingEventType.HARD_BRAKING,
        DrivingEventType.RAPID_ACCELERATION,
        DrivingEventType.SPEEDING,
        DrivingEventType.HARD_BRAKING,
      ),
      combined.map { it.type },
    )
    assertEquals(listOf(50.0, 20.0), combined.filter { it.type == DrivingEventType.SPEEDING }.map { it.timeOffsetSeconds })
    assertEquals(listOf(40.0, 10.0), combined.filter { it.type == DrivingEventType.HARD_BRAKING }.map { it.timeOffsetSeconds })
  }
}
