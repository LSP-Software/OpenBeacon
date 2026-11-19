package expo.modules.openbeacontracking.keys

import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class KeystoreSealerTest {
  private val keys = mutableMapOf<String, SecretKey>()
  private val sealer = KeystoreSealer(
    "alias",
    findKey = { keys[it] },
    generateKey = { alias -> KeyGenerator.getInstance("AES").apply { init(256) }.generateKey().also { keys[alias] = it } },
  )

  @Test
  fun sealedTextOpensWithTheSameKey() {
    assertEquals("secret", sealer.open(sealer.seal("secret")))
  }

  @Test
  fun openingAfterTheKeyIsGoneFailsWithoutCreatingANewKey() {
    val sealed = sealer.seal("secret")
    keys.clear()

    assertThrows(IllegalStateException::class.java) { sealer.open(sealed) }
    assertNull(keys["alias"])
  }
}
