package expo.modules.openbeacontracking.crypto

import android.os.Build
import java.util.Base64

object Base64Codec {
  fun encode(bytes: ByteArray): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Base64.getEncoder().encodeToString(bytes)
    } else {
      android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }

  fun decode(value: String): ByteArray =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Base64.getDecoder().decode(value)
    } else {
      android.util.Base64.decode(value, android.util.Base64.NO_WRAP)
    }
}
