package expo.modules.openbeacontracking.keys

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class EpochKeyStoreTest {
  private val key = { group: String, epoch: String -> ProvisionedEpochKey(group, epoch, ByteArray(32) { epoch.length.toByte() }, "device", "trackingPoint") }

  @Test
  fun preservesOnlyRequestedGroupsAndReplacesUpdatedKeys() {
    val store = InMemoryEpochKeyStore()
    store.replaceAll(listOf(key("unavailable", "old"), key("healthy", "old"), key("removed", "old")))

    store.replacePreserving(listOf(key("healthy", "new")), listOf("unavailable"))
    assertEquals(listOf(key("unavailable", "old"), key("healthy", "new")), store.list())

    store.replacePreserving(listOf(key("unavailable", "new")), listOf("unavailable"))
    assertEquals(listOf(key("unavailable", "new")), store.list())
  }

  @Test
  fun aKeyOfTheWrongLengthIsRejectedAndTheStoredKeysAreKept() {
    val store = InMemoryEpochKeyStore()
    store.replaceAll(listOf(key("healthy", "old")))

    assertFailsWith<IllegalArgumentException> {
      store.replacePreserving(listOf(key("healthy", "new"), ProvisionedEpochKey("short", "new", ByteArray(16), "device", "trackingPoint")), emptyList())
    }
    assertEquals(listOf(key("healthy", "old")), store.list())
  }
}
