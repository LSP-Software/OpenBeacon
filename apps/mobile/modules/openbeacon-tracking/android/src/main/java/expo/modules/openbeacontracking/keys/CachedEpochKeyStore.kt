package expo.modules.openbeacontracking.keys

class CachedEpochKeyStore(
  private val store: EpochKeyStore,
) : EpochKeyStore {
  private var cached: List<ProvisionedEpochKey>? = null

  override val revocations: Long
    @Synchronized get() = store.revocations

  @Synchronized
  override fun replaceAll(keys: List<ProvisionedEpochKey>) {
    try {
      store.replaceAll(keys)
    } finally {
      forget()
    }
  }

  @Synchronized
  override fun revoke(groupIds: List<String>?) {
    try {
      store.revoke(groupIds)
    } finally {
      forget()
    }
  }

  @Synchronized
  override fun list(): List<ProvisionedEpochKey> {
    val keys = cached ?: store.list().map { it.copy(epochKey = it.epochKey.copyOf()) }.also { if (it.isNotEmpty()) cached = it }
    return keys.map { it.copy(epochKey = it.epochKey.copyOf()) }
  }

  private fun forget() {
    cached?.forEach { it.epochKey.fill(0) }
    cached = null
  }
}
