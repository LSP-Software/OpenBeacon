package expo.modules.openbeacontracking.keys

import kotlin.test.Test
import kotlin.test.assertEquals

class EpochKeyStoreTest {
  @Test
  fun preservesOnlyRequestedGroupsAndReplacesUpdatedKeys() {
    val store = InMemoryEpochKeyStore()
    val key = { group: String, epoch: String -> ProvisionedEpochKey(group, epoch, byteArrayOf(1), "device", "trackingPoint") }
    store.replaceAll(listOf(key("unavailable", "old"), key("healthy", "old"), key("removed", "old")))

    store.replacePreserving(listOf(key("healthy", "new")), listOf("unavailable"))
    assertEquals(listOf(key("unavailable", "old"), key("healthy", "new")), store.list())

    store.replacePreserving(listOf(key("unavailable", "new")), listOf("unavailable"))
    assertEquals(listOf(key("unavailable", "new")), store.list())
  }
}
