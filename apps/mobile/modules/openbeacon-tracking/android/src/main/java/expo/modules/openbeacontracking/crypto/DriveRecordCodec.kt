package expo.modules.openbeacontracking.crypto

import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305
import java.nio.ByteBuffer
import java.security.SecureRandom
import kotlin.math.abs
import kotlin.math.floor

enum class DrivingEventType { HARD_BRAKING, RAPID_ACCELERATION, SPEEDING, PHONE_USE }

enum class SpeedLimitSource { POSTED, ROAD_TYPE }

data class SpeedLimit(
  val speed: Double,
  val source: SpeedLimitSource,
)

data class DrivePosition(
  val timeMillis: Long,
  val latitude: Double,
  val longitude: Double,
)

data class DrivingEvent(
  val type: DrivingEventType,
  val timeOffsetSeconds: Double,
  val durationSeconds: Double,
  val latitude: Double,
  val longitude: Double,
  val peak: Double,
  val limit: SpeedLimit?,
)

data class DriveRecord(
  val driveId: String,
  val start: DrivePosition,
  val end: DrivePosition,
  val distanceMeters: Double,
  val checkedDistanceMeters: Double,
  val durationSeconds: Double,
  val topSpeed: Double,
  val averageSpeed: Double,
  val utcOffsetMinutes: Int,
  val counts: Map<DrivingEventType, Int>,
  val passenger: Boolean,
  val speedLimitsChecked: Boolean,
  val tellGroup: Boolean,
  val events: List<DrivingEvent>,
)

data class SealedDriveRecord(
  val driveId: String,
  val startHour: Long,
  val nonce: String,
  val ciphertext: String,
)

object DriveRecordCodec {
  const val KIND = "drive"
  const val VERSION = 1
  const val LENGTH = 1_008
  const val ENCRYPTED_LENGTH = LENGTH + 16
  const val MAX_EVENTS = 48
  private const val HEADER_LENGTH = 73
  private const val EVENT_LENGTH = 16
  private const val PASSENGER_FLAG = 1
  private const val SPEED_LIMITS_CHECKED_FLAG = 2
  private const val TELL_GROUP_FLAG = 4
  private const val HOUR_MS = 3_600_000L
  private const val FULL_TURN_E7 = 3_600_000_000L
  private const val HALF_TURN_E7 = 1_800_000_000L
  private const val INT24_MAX = 0x7F_FFFF
  private const val MAX_TIME_MILLIS = (1L shl 48) - 1
  private val driveIdPattern = Regex("^[0-9a-f]{32}$")
  private val secureRandom = SecureRandom()

  private class InvalidRecord : Exception()

  fun newDriveId(): String = ByteArray(16).also { secureRandom.nextBytes(it) }.joinToString("") { "%02x".format(it) }

  fun markPassenger(record: DriveRecord): DriveRecord =
    record.copy(passenger = true, counts = DrivingEventType.entries.associateWith { 0 }, events = emptyList())

  fun encode(record: DriveRecord): ByteArray? =
    try {
      encodeOrThrow(record)
    } catch (_: InvalidRecord) {
      null
    }

  private fun units(
    value: Double,
    scale: Double,
    max: Long,
  ): Long {
    if (!value.isFinite()) throw InvalidRecord()
    val result = Math.round(value * scale)
    if (result < 0 || result > max) throw InvalidRecord()
    return result
  }

  private fun e7(
    latitude: Double,
    longitude: Double,
  ): Pair<Int, Int> {
    if (!latitude.isFinite() || latitude < -90.0 || latitude > 90.0) throw InvalidRecord()
    if (!longitude.isFinite() || longitude < -180.0 || longitude > 180.0) throw InvalidRecord()
    return Math.round(latitude * 1e7).toInt() to Math.round(longitude * 1e7).toInt()
  }

  private fun wrapLongitude(value: Long): Long =
    when {
      value > HALF_TURN_E7 -> value - FULL_TURN_E7
      value < -HALF_TURN_E7 -> value + FULL_TURN_E7
      else -> value
    }

  private fun delta(
    from: Int,
    to: Int,
  ): Int {
    val result = Math.round(wrapLongitude(to.toLong() - from.toLong()) / 100.0)
    if (abs(result) > INT24_MAX) throw InvalidRecord()
    return result.toInt()
  }

  private fun ByteBuffer.putUint48(value: Long): ByteBuffer {
    if (value < 0 || value > MAX_TIME_MILLIS) throw InvalidRecord()
    return putShort((value ushr 32).toInt().toShort()).putInt(value.toInt())
  }

  private fun ByteBuffer.putInt24(value: Int): ByteBuffer = put((value shr 16).toByte()).putShort((value and 0xFFFF).toShort())

  private fun encodeOrThrow(record: DriveRecord): ByteArray {
    if (!driveIdPattern.matches(record.driveId) || record.end.timeMillis < record.start.timeMillis) throw InvalidRecord()
    if (abs(record.utcOffsetMinutes) > 1_080) throw InvalidRecord()
    val events = record.events.take(MAX_EVENTS)
    val counts =
      DrivingEventType.entries.map { type ->
        val count = record.counts[type] ?: 0
        if (count < events.count { it.type == type } || count > 0xFFFF || (record.passenger && count > 0)) throw InvalidRecord()
        count
      }
    if (record.passenger && events.isNotEmpty()) throw InvalidRecord()
    val start = e7(record.start.latitude, record.start.longitude)
    val end = e7(record.end.latitude, record.end.longitude)
    val flags =
      (if (record.passenger) PASSENGER_FLAG else 0) or
        (if (record.speedLimitsChecked) SPEED_LIMITS_CHECKED_FLAG else 0) or
        (if (record.tellGroup) TELL_GROUP_FLAG else 0)

    val buffer = ByteBuffer.allocate(LENGTH).put(VERSION.toByte())
    for (index in 0 until 16) buffer.put(record.driveId.substring(index * 2, index * 2 + 2).toInt(16).toByte())
    buffer
      .put(flags.toByte())
      .putUint48(record.start.timeMillis)
      .putUint48(record.end.timeMillis)
      .putInt(start.first)
      .putInt(start.second)
      .putInt(end.first)
      .putInt(end.second)
      .putInt(units(record.distanceMeters, 1.0, 0xFFFF_FFFFL).toInt())
      .putInt(units(record.checkedDistanceMeters, 1.0, 0xFFFF_FFFFL).toInt())
      .putInt(units(record.durationSeconds, 1.0, 0xFFFF_FFFFL).toInt())
      .putShort(units(record.topSpeed, 100.0, 0xFFFF).toInt().toShort())
      .putShort(units(record.averageSpeed, 100.0, 0xFFFF).toInt().toShort())
      .putShort(record.utcOffsetMinutes.toShort())
    counts.forEach { buffer.putShort(it.toShort()) }
    buffer.put(events.size.toByte())
    for (event in events) {
      if (event.limit != null && event.type != DrivingEventType.SPEEDING) throw InvalidRecord()
      val position = e7(event.latitude, event.longitude)
      val timeOffset = units(event.timeOffsetSeconds, 1.0, 0xFF_FFFF).toInt()
      buffer
        .put(((event.type.ordinal + 1) or ((event.limit?.source?.ordinal?.plus(1) ?: 0) shl 4)).toByte())
        .putInt24(timeOffset)
        .putShort(units(event.durationSeconds, 1.0, 0xFFFF).toInt().toShort())
        .putInt24(delta(start.first, position.first))
        .putInt24(delta(start.second, position.second))
        .putShort(units(event.peak, 100.0, 0xFFFF).toInt().toShort())
        .putShort((event.limit?.let { units(it.speed, 100.0, 0xFFFF) } ?: 0L).toInt().toShort())
    }
    return buffer.array()
  }

  fun decode(bytes: ByteArray): DriveRecord? {
    if (bytes.size != LENGTH) return null
    val buffer = ByteBuffer.wrap(bytes)
    val uint16 = { offset: Int -> buffer.getShort(offset).toInt() and 0xFFFF }
    val uint24 = { offset: Int -> ((bytes[offset].toInt() and 0xFF) shl 16) or uint16(offset + 1) }
    val int24 = { offset: Int -> uint24(offset).let { if (it > INT24_MAX) it - 0x100_0000 else it } }
    val uint48 = { offset: Int -> (uint16(offset).toLong() shl 32) or (buffer.getInt(offset + 2).toLong() and 0xFFFF_FFFFL) }
    val uint32 = { offset: Int -> buffer.getInt(offset).toLong() and 0xFFFF_FFFFL }
    val flags = bytes[17].toInt() and 0xFF
    val eventCount = bytes[72].toInt() and 0xFF
    val passenger = flags and PASSENGER_FLAG != 0
    val counts = (0 until 4).map { uint16(64 + it * 2) }
    val startTime = uint48(18)
    val endTime = uint48(24)
    val offset = buffer.getShort(62).toInt()
    val startLatitude = buffer.getInt(30)
    val startLongitude = buffer.getInt(34)
    if (bytes[0].toInt() != VERSION ||
      flags and (PASSENGER_FLAG or SPEED_LIMITS_CHECKED_FLAG or TELL_GROUP_FLAG).inv() != 0 ||
      eventCount > MAX_EVENTS ||
      endTime < startTime ||
      abs(offset) > 1_080 ||
      (passenger && (eventCount > 0 || counts.any { it > 0 })) ||
      (HEADER_LENGTH + eventCount * EVENT_LENGTH until LENGTH).any { bytes[it].toInt() != 0 }
    ) {
      return null
    }
    val validPosition = { latitude: Long, longitude: Long -> abs(latitude) <= 900_000_000L && abs(longitude) <= HALF_TURN_E7 }
    if (!validPosition(startLatitude.toLong(), startLongitude.toLong()) || !validPosition(buffer.getInt(38).toLong(), buffer.getInt(42).toLong())) return null

    val events =
      (0 until eventCount).map { index ->
        val at = HEADER_LENGTH + index * EVENT_LENGTH
        val typeByte = bytes[at].toInt() and 0xFF
        val type = DrivingEventType.entries.getOrNull((typeByte and 0x0F) - 1) ?: return null
        val source = typeByte ushr 4
        val limit = uint16(at + 14)
        if (source > SpeedLimitSource.entries.size || (source == 0) != (limit == 0) || (source != 0 && type != DrivingEventType.SPEEDING)) return null
        val latitude = startLatitude.toLong() + int24(at + 6) * 100L
        val longitude = wrapLongitude(startLongitude.toLong() + int24(at + 9) * 100L)
        if (!validPosition(latitude, longitude)) return null
        DrivingEvent(
          type = type,
          timeOffsetSeconds = uint24(at + 1).toDouble(),
          durationSeconds = uint16(at + 4).toDouble(),
          latitude = latitude / 1e7,
          longitude = longitude / 1e7,
          peak = uint16(at + 12) / 100.0,
          limit = if (source == 0) null else SpeedLimit(limit / 100.0, SpeedLimitSource.entries[source - 1]),
        )
      }
    if (DrivingEventType.entries.any { type -> counts[type.ordinal] < events.count { it.type == type } }) return null

    return DriveRecord(
      driveId = bytes.copyOfRange(1, 17).joinToString("") { "%02x".format(it) },
      start = DrivePosition(startTime, startLatitude / 1e7, startLongitude / 1e7),
      end = DrivePosition(endTime, buffer.getInt(38) / 1e7, buffer.getInt(42) / 1e7),
      distanceMeters = uint32(46).toDouble(),
      checkedDistanceMeters = uint32(50).toDouble(),
      durationSeconds = uint32(54).toDouble(),
      topSpeed = uint16(58) / 100.0,
      averageSpeed = uint16(60) / 100.0,
      utcOffsetMinutes = offset,
      counts = DrivingEventType.entries.associateWith { counts[it.ordinal] },
      passenger = passenger,
      speedLimitsChecked = flags and SPEED_LIMITS_CHECKED_FLAG != 0,
      tellGroup = flags and TELL_GROUP_FLAG != 0,
      events = events,
    )
  }

  fun associatedData(
    groupId: String,
    epochId: String,
    senderDeviceId: String,
    driveId: String,
  ): ByteArray =
    GroupPayloadEncrypt.buildAssociatedData(groupId, epochId, KIND, senderDeviceId, driveId)

  fun seal(
    record: DriveRecord,
    epochKey: ByteArray,
    groupId: String,
    epochId: String,
    senderDeviceId: String,
    nonce: ByteArray? = null,
  ): SealedDriveRecord? {
    val plaintext = encode(record) ?: return null
    require(epochKey.size == GroupPayloadEncrypt.EPOCH_KEY_LENGTH) { "Invalid epoch key length." }
    val resolvedNonce = nonce ?: ByteArray(GroupPayloadEncrypt.NONCE_LENGTH).also { secureRandom.nextBytes(it) }
    require(resolvedNonce.size == GroupPayloadEncrypt.NONCE_LENGTH) { "Invalid nonce length." }
    val ciphertext = InsecureNonceXChaCha20Poly1305(epochKey).encrypt(resolvedNonce, plaintext, associatedData(groupId, epochId, senderDeviceId, record.driveId))
    return SealedDriveRecord(
      driveId = record.driveId,
      startHour = floor(record.start.timeMillis.toDouble() / HOUR_MS).toLong(),
      nonce = GroupPayloadEncrypt.encodeBase64(resolvedNonce),
      ciphertext = GroupPayloadEncrypt.encodeBase64(ciphertext),
    )
  }

  fun open(
    sealed: SealedDriveRecord,
    epochKey: ByteArray,
    groupId: String,
    epochId: String,
    senderDeviceId: String,
  ): DriveRecord {
    val plaintext =
      InsecureNonceXChaCha20Poly1305(epochKey).decrypt(
        GroupPayloadEncrypt.decodeBase64(sealed.nonce),
        GroupPayloadEncrypt.decodeBase64(sealed.ciphertext),
        associatedData(groupId, epochId, senderDeviceId, sealed.driveId),
      )
    val record = decode(plaintext) ?: throw IllegalArgumentException("Unreadable drive record.")
    require(record.driveId == sealed.driveId && record.start.timeMillis / HOUR_MS == sealed.startHour) { "Unreadable drive record." }
    return record
  }
}
