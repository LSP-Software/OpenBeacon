package expo.modules.openbeacontracking.keys

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CachedEpochKeyStoreTest {
  private class CountingStore : EpochKeyStore {
    val keys = InMemoryEpochKeyStore()
    var reads = 0
    var failWrites = false

    override val revocations get() = keys.revocations

    override fun replaceAll(keys: List<ProvisionedEpochKey>) {
      this.keys.replaceAll(keys)
      check(!failWrites)
    }

    override fun revoke(groupIds: List<String>?) {
      keys.revoke(groupIds)
      check(!failWrites)
    }

    override fun list(): List<ProvisionedEpochKey> {
      reads += 1
      return keys.list()
    }
  }

  private val a = ProvisionedEpochKey("group_a", "epoch_a", ByteArray(32) { 1 }, "device", "trackingPoint")
  private val b = ProvisionedEpochKey("group_b", "epoch_b", ByteArray(32) { 2 }, "device", "trackingPoint")

  @Test
  fun readsTheStoreOnceUntilAWriteChangesIt() {
    val inner = CountingStore()
    val store = CachedEpochKeyStore(inner)
    store.replaceAll(listOf(a, b))
    repeat(3) { assertEquals(listOf(a, b), store.list()) }
    assertEquals(1, inner.reads)

    store.revoke(listOf("group_a"))
    assertEquals(listOf(b), store.list())
    val rotated = a.copy(epochId = "epoch_a2", epochKey = ByteArray(32) { 3 })
    store.replacePreserving(listOf(rotated), listOf("group_b"))
    assertEquals(listOf(b, rotated), store.list())
    store.revoke(null)
    assertTrue(store.list().isEmpty())
    assertEquals(2L, store.revocations)
  }

  @Test
  fun aRevokedKeyIsNeverServedFromTheCacheEvenWhenTheWriteFails() {
    val inner = CountingStore()
    val store = CachedEpochKeyStore(inner)
    store.replaceAll(listOf(a, b))
    store.list()
    inner.failWrites = true
    assertFailsWith<IllegalStateException> { store.revoke(listOf("group_a")) }
    assertEquals(listOf(b), store.list())
  }

  @Test
  fun callersGetTheirOwnCopiesThatOutliveAWrite() {
    val store = CachedEpochKeyStore(CountingStore())
    store.replaceAll(listOf(a))
    val held = store.list().single()
    store.list().single().epochKey.fill(9)
    assertEquals(a, store.list().single())
    store.revoke(null)
    assertEquals(a, held)
  }

  @Test
  fun anEmptyReadIsNotCachedSoAFailedReadIsRetried() {
    val inner = CountingStore()
    val store = CachedEpochKeyStore(inner)
    store.list()
    inner.keys.replaceAll(listOf(a))
    assertEquals(listOf(a), store.list())
    assertEquals(2, inner.reads)
  }
}
