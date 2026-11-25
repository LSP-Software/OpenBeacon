package expo.modules.openbeacontracking.drives

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class InstalledPack(
  val regionId: String,
  val build: String,
  val sha256: String,
  val size: Long,
  val lastInMillis: Long,
)

data class PackRequest(
  val regionId: String,
  val build: String,
  val url: String,
  val size: Long,
  val sha256: String,
)

enum class PackUpdate { Installed, AlreadyInstalled, NotAllowed, NoRoom, Failed }

class SpeedLimitPackStore(private val dir: File, private val budgetBytes: Long = BUDGET_BYTES) {
  private data class Index(
    val packs: List<InstalledPack>,
    val seen: Map<String, Long>,
    val current: String?,
  )

  val currentRegion: String?
    @Synchronized get() = read().current

  @Synchronized
  fun list(): List<InstalledPack> = read().packs

  @Synchronized
  fun totalBytes(): Long = read().packs.sumOf { it.size }

  @Synchronized
  fun noteRegion(regionId: String, nowMillis: Long) {
    val index = read()
    write(index.copy(seen = index.seen + (regionId to nowMillis), current = regionId))
  }

  @Synchronized
  fun clear() {
    dir.listFiles()?.forEach { it.deleteRecursively() }
  }

  @Synchronized
  fun install(request: PackRequest, download: File): PackUpdate {
    val opened =
      runCatching { FilePackSource(download).use { SpeedLimitPack.open(it).regionId } }.getOrNull()
    if (opened != request.regionId || download.length() != request.size) {
      download.delete()
      return PackUpdate.Failed
    }
    val index = read()
    val kept = index.packs.filter { it.regionId != request.regionId }.toMutableList()
    while (kept.sumOf { it.size } + request.size > budgetBytes) {
      val oldest =
        kept.filter { it.regionId != index.current }.minByOrNull { it.lastInMillis }
          ?: run {
            download.delete()
            return PackUpdate.NoRoom
          }
      kept.remove(oldest)
      fileFor(oldest.regionId).delete()
    }
    if (!download.renameTo(fileFor(request.regionId))) {
      download.delete()
      write(index.copy(packs = kept))
      return PackUpdate.Failed
    }
    kept +=
      InstalledPack(request.regionId, request.build, request.sha256, request.size, index.seen[request.regionId] ?: 0)
    write(index.copy(packs = kept))
    return PackUpdate.Installed
  }

  fun partFile(): File = File(dir.apply { mkdirs() }, PART_FILE)

  fun <T> withPacks(use: (SpeedLimitRoads?) -> T): T {
    val sources = list().mapNotNull { pack -> runCatching { FilePackSource(fileFor(pack.regionId)) }.getOrNull() }
    try {
      val packs = sources.mapNotNull { runCatching { SpeedLimitPack.open(it) }.getOrNull() }
      return use(if (packs.isEmpty()) null else SpeedLimitPackSet(packs))
    } finally {
      sources.forEach { it.close() }
    }
  }

  private fun fileFor(regionId: String) = File(dir, "${regionId.replace('/', '+')}.obsl")

  private fun read(): Index {
    val lines = runCatching { File(dir, INDEX_FILE).readLines() }.getOrDefault(emptyList()).map { it.split('\t') }
    val seen = lines.filter { it.size == 3 && it[0] == "seen" }.mapNotNull { line -> line[2].toLongOrNull()?.let { line[1] to it } }.toMap()
    val packs =
      lines
        .filter { it.size == 5 && it[0] == "pack" }
        .mapNotNull { line ->
          val size = line[4].toLongOrNull() ?: return@mapNotNull null
          val file = fileFor(line[1])
          if (!file.isFile || file.length() != size) return@mapNotNull null
          InstalledPack(line[1], line[2], line[3], size, seen[line[1]] ?: 0)
        }
    val current = lines.firstOrNull { it.size == 2 && it[0] == "current" }?.get(1)
    return Index(packs, seen, current)
  }

  private fun write(index: Index) {
    dir.mkdirs()
    val keep = index.packs.map { it.regionId }.toSet() + listOfNotNull(index.current)
    val text =
      buildString {
        index.current?.let { append("current\t$it\n") }
        index.seen.filterKeys { it in keep }.forEach { (region, millis) -> append("seen\t$region\t$millis\n") }
        index.packs.forEach { append("pack\t${it.regionId}\t${it.build}\t${it.sha256}\t${it.size}\n") }
      }
    val temp = File(dir, "$INDEX_FILE.tmp")
    temp.writeText(text)
    temp.renameTo(File(dir, INDEX_FILE))
  }

  companion object {
    const val BUDGET_BYTES = 500_000_000L
    const val INDEX_FILE = "index.tsv"
    private const val PART_FILE = "download.part"
  }
}

class SpeedLimitPackUpdater(
  private val store: SpeedLimitPackStore,
  private val canDownload: () -> Boolean,
) {
  fun update(request: PackRequest): PackUpdate {
    if (store.list().any { it.regionId == request.regionId && it.sha256 == request.sha256 }) {
      return PackUpdate.AlreadyInstalled
    }
    if (!canDownload()) return PackUpdate.NotAllowed
    val part = store.partFile()
    if (!download(request, part) || !canDownload()) {
      part.delete()
      return PackUpdate.Failed
    }
    return store.install(request, part)
  }

  private fun download(request: PackRequest, destination: File): Boolean {
    val connection = runCatching { URL(request.url).openConnection() as HttpURLConnection }.getOrNull() ?: return false
    return try {
      connection.connectTimeout = TIMEOUT_MILLIS
      connection.readTimeout = TIMEOUT_MILLIS
      if (connection.responseCode != HttpURLConnection.HTTP_OK) return false
      val digest = MessageDigest.getInstance("SHA-256")
      var total = 0L
      connection.inputStream.use { input ->
        destination.outputStream().use { output ->
          val buffer = ByteArray(BUFFER_BYTES)
          while (true) {
            if (!canDownload()) return false
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > request.size) return false
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
          }
        }
      }
      total == request.size && digest.digest().joinToString("") { "%02x".format(it) } == request.sha256
    } catch (_: Exception) {
      false
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    private const val TIMEOUT_MILLIS = 30_000
    private const val BUFFER_BYTES = 64 * 1024
  }
}
