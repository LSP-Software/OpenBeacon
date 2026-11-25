package expo.modules.openbeacontracking.crypto

import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import org.json.JSONObject

class CrashAlertCodecTest {
  private val vectors =
    JSONObject(
      javaClass.classLoader!!
        .getResourceAsStream("crash-alert-v1.json")!!
        .bufferedReader(StandardCharsets.UTF_8)
        .readText(),
    )

  private fun message(json: JSONObject): CrashAlertMessage {
    val crash = json.getJSONObject("crash")
    return CrashAlertMessage(
      type = CrashAlertType.valueOf(json.getString("type")),
      messageId = json.getString("messageId"),
      alertId = json.getString("alertId"),
      crashTimeMillis = crash.getLong("time"),
      latitude = crash.getDouble("latitude"),
      longitude = crash.getDouble("longitude"),
      speedBefore = crash.getDouble("speedBefore"),
      sharingUntilMillis = json.getLong("sharingUntil"),
      okAtMillis = if (json.isNull("okAt")) null else json.getLong("okAt"),
      placeLabel = if (json.isNull("placeLabel")) null else json.getString("placeLabel"),
    )
  }

  private fun hex(bytes: ByteArray?) = bytes?.joinToString("") { "%02x".format(it) }

  private fun bytes(hex: String) = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  private fun cases(name: String) = vectors.getJSONArray(name).let { array -> (0 until array.length()).map { array.getJSONObject(it) } }

  @Test
  fun lengthsMatchTheVectors() {
    assertEquals(vectors.getInt("version"), CrashAlertCodec.VERSION)
    assertEquals(vectors.getInt("length"), CrashAlertCodec.LENGTH)
    assertEquals(vectors.getInt("encryptedLength"), CrashAlertCodec.ENCRYPTED_LENGTH)
  }

  @Test
  fun encodesAndDecodesTheSharedMessages() {
    for (case in cases("encode")) {
      val name = case.getString("name")
      assertEquals(case.getString("hex"), hex(CrashAlertCodec.encode(message(case.getJSONObject("message")))), name)
      assertEquals(message(case.getJSONObject("decoded")), CrashAlertCodec.decode(bytes(case.getString("hex"))), name)
    }
  }

  @Test
  fun refusesTheSharedRejects() {
    for (case in cases("encodeReject")) {
      assertNull(CrashAlertCodec.encode(message(case.getJSONObject("message"))), case.getString("name"))
    }
    for (case in cases("decodeReject")) {
      assertNull(CrashAlertCodec.decode(bytes(case.getString("hex"))), case.getString("name"))
    }
  }

  @Test
  fun sealsToTheSharedCiphertextAndOpensOnlyWithTheSameMetadata() {
    val sealed = vectors.getJSONObject("sealed")
    val epochKey = bytes(sealed.getString("epochKeyHex"))
    val nonce = bytes(sealed.getString("nonceHex"))
    val encode = cases("encode")
    for (case in sealed.getJSONArray("cases").let { array -> (0 until array.length()).map { array.getJSONObject(it) } }) {
      val name = case.getString("name")
      val metadata = case.getJSONObject("metadata")
      val message = message(encode.first { it.getString("name") == name }.getJSONObject("message"))
      val groupId = metadata.getString("groupId")
      val epochId = metadata.getString("epochId")
      val deviceId = metadata.getString("senderDeviceId")
      val result = CrashAlertCodec.seal(message, epochKey, groupId, epochId, deviceId, nonce)!!
      assertEquals(case.getString("ciphertextBase64"), result.ciphertext, name)
      assertEquals(case.getString("aadJson"), String(CrashAlertCodec.associatedData(groupId, epochId, deviceId, message.messageId), Charsets.UTF_8), name)
      assertEquals(message, CrashAlertCodec.open(result, epochKey, groupId, epochId, deviceId))
      assertFailsWith<Exception> { CrashAlertCodec.open(result, epochKey, "other_group", epochId, deviceId) }
    }
  }
}
