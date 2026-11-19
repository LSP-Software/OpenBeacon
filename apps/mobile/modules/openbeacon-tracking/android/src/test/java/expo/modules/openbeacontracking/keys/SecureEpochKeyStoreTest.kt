package expo.modules.openbeacontracking.keys

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import javax.crypto.KeyGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SecureEpochKeyStoreTest {
  private val stored = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("epoch-keys-test", Context.MODE_PRIVATE)
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
  private val sealer = KeystoreSealer("alias", findKey = { key }, generateKey = { key })
  private val provisioned = listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32) { 7 }, "device", "trackingPoint"))

  @Test
  fun savedKeysAreWrittenToDiskBeforeReplaceAllReturns() {
    val disk = object : SharedPreferences by stored {
      override fun edit(): SharedPreferences.Editor {
        val editor = stored.edit()
        return object : SharedPreferences.Editor by editor {
          override fun putString(name: String?, value: String?): SharedPreferences.Editor = apply { editor.putString(name, value) }

          override fun apply() {}
        }
      }
    }
    SecureEpochKeyStore(disk, sealer).replaceAll(provisioned)

    assertEquals(provisioned, SecureEpochKeyStore(stored, sealer).list())
  }

  @Test
  fun savingKeysFailsWhenTheWriteIsNotStored() {
    val failingDisk = object : SharedPreferences by stored {
      override fun edit(): SharedPreferences.Editor {
        val editor = stored.edit()
        return object : SharedPreferences.Editor by editor {
          override fun putString(name: String?, value: String?): SharedPreferences.Editor = apply { editor.putString(name, value) }

          override fun commit(): Boolean = false

          override fun apply() {}
        }
      }
    }

    assertThrows(IllegalStateException::class.java) { SecureEpochKeyStore(failingDisk, sealer).replaceAll(provisioned) }
  }
}
