package expo.modules.openbeacontracking.crypto

import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import org.json.JSONObject

class DriveRecordCodecTest {
  private val vectors =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("drive-record-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private fun position(json: JSONObject) = DrivePosition(json.getLong("time"), json.getDouble("latitude"), json.getDouble("longitude"))

  private fun record(json: JSONObject): DriveRecord {
    val counts = json.getJSONObject("counts")
    val events = json.getJSONArray("events")
    return DriveRecord(
      driveId = json.getString("driveId"),
      start = position(json.getJSONObject("start")),
      end = position(json.getJSONObject("end")),
      distanceMeters = json.getDouble("distance"),
      checkedDistanceMeters = json.getDouble("checkedDistance"),
      durationSeconds = json.getDouble("duration"),
      topSpeed = json.getDouble("topSpeed"),
      averageSpeed = json.getDouble("averageSpeed"),
      utcOffsetMinutes = json.getInt("utcOffsetMinutes"),
      counts = DrivingEventType.entries.associateWith { counts.getInt(it.name) },
      passenger = json.getBoolean("passenger"),
      speedLimitsChecked = json.getBoolean("speedLimitsChecked"),
      tellGroup = json.getBoolean("tellGroup"),
      events =
        (0 until events.length()).map { index ->
          val event = events.getJSONObject(index)
          val limit = event.optJSONObject("limit")
          DrivingEvent(
            type = DrivingEventType.valueOf(event.getString("type")),
            timeOffsetSeconds = event.getDouble("timeOffset"),
            durationSeconds = event.getDouble("duration"),
            latitude = event.getDouble("latitude"),
            longitude = event.getDouble("longitude"),
            peak = event.getDouble("peak"),
            limit = limit?.let { SpeedLimit(it.getDouble("speed"), SpeedLimitSource.valueOf(it.getString("source"))) },
          )
        },
    )
  }

  private fun hex(bytes: ByteArray?) = bytes?.joinToString("") { "%02x".format(it) }

  private fun bytes(hex: String) = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  private fun cases(name: String) = vectors.getJSONArray(name).let { array -> (0 until array.length()).map { array.getJSONObject(it) } }

  @Test
  fun vectorFileMatchesTheLockedVersionAndLengths() {
    assertEquals(DriveRecordCodec.VERSION, vectors.getInt("version"))
    assertEquals(DriveRecordCodec.LENGTH, vectors.getInt("length"))
    assertEquals(DriveRecordCodec.ENCRYPTED_LENGTH, vectors.getInt("encryptedLength"))
  }

  @Test
  fun encodesEachRecordToTheSharedBytes() {
    for (testCase in cases("encode")) {
      assertEquals(testCase.getString("name") to testCase.getString("hex"), testCase.getString("name") to hex(DriveRecordCodec.encode(record(testCase.getJSONObject("record")))))
    }
  }

  @Test
  fun decodesTheSharedBytesToTheDecodedRecord() {
    for (testCase in cases("encode")) {
      assertEquals(record(testCase.getJSONObject("decoded")), DriveRecordCodec.decode(bytes(testCase.getString("hex"))), testCase.getString("name"))
    }
  }

  @Test
  fun refusesEachRejectedRecordAndPayload() {
    for (testCase in cases("encodeReject")) {
      assertNull(DriveRecordCodec.encode(record(testCase.getJSONObject("record"))), testCase.getString("name"))
    }
    for (testCase in cases("decodeReject")) {
      assertNull(DriveRecordCodec.decode(bytes(testCase.getString("hex"))), testCase.getString("name"))
    }
  }

  @Test
  fun keepsOneSizeWhateverTheNumberOfEvents() {
    val base = record(cases("encode").first { it.getString("name") == "with-events" }.getJSONObject("record"))
    for (count in listOf(0, 1, 48, 200)) {
      val events = List(count) { base.events.first().copy(timeOffsetSeconds = it * 5.0) }
      val sized = base.copy(counts = base.counts + (DrivingEventType.HARD_BRAKING to count) + (DrivingEventType.RAPID_ACCELERATION to 0) + (DrivingEventType.SPEEDING to 0) + (DrivingEventType.PHONE_USE to 0), events = events)
      assertEquals(DriveRecordCodec.LENGTH, DriveRecordCodec.encode(sized)?.size, "$count events")
    }
  }

  @Test
  fun passengerMarkBlanksEventsAndCountsAndKeepsTheSummary() {
    val base = record(cases("encode").first { it.getString("name") == "with-events" }.getJSONObject("record"))
    val passenger = record(cases("encode").first { it.getString("name") == "passenger" }.getJSONObject("record"))
    assertEquals(hex(DriveRecordCodec.encode(passenger)), hex(DriveRecordCodec.encode(DriveRecordCodec.markPassenger(base))))
  }

  @Test
  fun sealsEachRecordToTheSharedCiphertext() {
    val sealed = vectors.getJSONObject("sealed")
    val epochKey = bytes(sealed.getString("epochKeyHex"))
    val nonce = bytes(sealed.getString("nonceHex"))
    val sealedCases = sealed.getJSONArray("cases")
    for (index in 0 until sealedCases.length()) {
      val testCase = sealedCases.getJSONObject(index)
      val metadata = testCase.getJSONObject("metadata")
      val source = record(cases("encode").first { it.getString("name") == testCase.getString("name") }.getJSONObject("record"))
      val result =
        DriveRecordCodec.seal(
          record = source,
          epochKey = epochKey,
          groupId = metadata.getString("groupId"),
          epochId = metadata.getString("epochId"),
          senderDeviceId = metadata.getString("senderDeviceId"),
          nonce = nonce,
        )!!
      assertEquals(testCase.getString("ciphertextBase64"), result.ciphertext)
      assertEquals(testCase.getLong("startHour"), result.startHour)
      assertEquals(metadata.getString("driveId"), result.driveId)
      assertEquals(
        testCase.getString("aadJson"),
        String(DriveRecordCodec.associatedData(metadata.getString("groupId"), metadata.getString("epochId"), metadata.getString("senderDeviceId"), metadata.getString("driveId")), Charsets.UTF_8),
      )
      val opened = DriveRecordCodec.open(result, epochKey, metadata.getString("groupId"), metadata.getString("epochId"), metadata.getString("senderDeviceId"))
      assertEquals(DriveRecordCodec.decode(DriveRecordCodec.encode(source)!!), opened)
      assertFailsWith<Exception> { DriveRecordCodec.open(result, epochKey, "another-group", metadata.getString("epochId"), metadata.getString("senderDeviceId")) }
      assertFailsWith<Exception> { DriveRecordCodec.open(result.copy(startHour = result.startHour + 1), epochKey, metadata.getString("groupId"), metadata.getString("epochId"), metadata.getString("senderDeviceId")) }
    }
  }
}
