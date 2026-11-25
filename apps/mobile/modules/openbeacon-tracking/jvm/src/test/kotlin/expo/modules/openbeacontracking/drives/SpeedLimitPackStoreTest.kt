package expo.modules.openbeacontracking.drives

import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

class SpeedLimitPackStoreTest {
  private val vectorPack =
    Base64.getDecoder()
      .decode(
        JSONObject(
          javaClass.classLoader!!
            .getResourceAsStream("speed-limit-pack-v1.json")!!
            .bufferedReader(StandardCharsets.UTF_8)
            .readText(),
        ).getString("packBase64"),
      )
  private val dir = Files.createTempDirectory("packs").toFile()
  private val served = mutableMapOf<String, ByteArray>()
  private val requests = mutableListOf<String>()
  private val server =
    HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
      createContext("/") { exchange ->
        requests += exchange.requestURI.path
        val body = served[exchange.requestURI.path]
        if (body == null) {
          exchange.sendResponseHeaders(404, -1)
        } else {
          exchange.sendResponseHeaders(200, body.size.toLong())
          exchange.responseBody.use { it.write(body) }
        }
        exchange.close()
      }
      start()
    }

  @AfterTest
  fun cleanUp() {
    server.stop(0)
    dir.deleteRecursively()
  }

  private fun pack(regionId: String, build: String = "20261201"): ByteArray {
    require(regionId.length == "test/vectors".length)
    return vectorPack.copyOf().also {
      regionId.toByteArray().copyInto(it, 42)
      ByteBuffer.wrap(it, 8, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(build.toInt())
    }
  }

  private fun sha256(bytes: ByteArray) =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private fun publish(regionId: String, build: String, bytes: ByteArray = pack(regionId, build)): PackRequest {
    val path = "/speed-limits/${regionId.replace('/', '-')}-$build.obsl"
    served[path] = bytes
    return PackRequest(
      regionId = regionId,
      build = build,
      url = "http://127.0.0.1:${server.address.port}$path",
      size = bytes.size.toLong(),
      sha256 = sha256(bytes),
    )
  }

  private fun store(budget: Long = vectorPack.size * 2L) = SpeedLimitPackStore(dir, budget)

  private fun updater(store: SpeedLimitPackStore, allowed: () -> Boolean = { true }) =
    SpeedLimitPackUpdater(store, canDownload = allowed)

  @Test
  fun installsADownloadedPackThatMatchesItsChecks() {
    val store = store()
    val result = updater(store).update(publish("test/vectora", "20261201"))

    assertEquals(PackUpdate.Installed, result)
    assertEquals(listOf("test/vectora"), store.list().map { it.regionId })
    assertEquals(vectorPack.size.toLong(), store.totalBytes())
    store.withPacks { roads -> assertNotNull(roads!!.roadsNear(51.5, -0.05, 2_000.0)) }
  }

  @Test
  fun skipsTheDownloadWhenItIsNotAllowed() {
    val store = store()
    val result = updater(store, allowed = { false }).update(publish("test/vectora", "20261201"))

    assertEquals(PackUpdate.NotAllowed, result)
    assertTrue(requests.isEmpty())
    assertTrue(store.list().isEmpty())
  }

  @Test
  fun stopsADownloadWhenADriveStartsAndKeepsTheOldPack() {
    val store = store()
    updater(store).update(publish("test/vectora", "20261101"))
    var checks = 0
    val result =
      updater(store, allowed = { checks++ < 1 }).update(publish("test/vectora", "20261201"))

    assertEquals(PackUpdate.Failed, result)
    assertEquals(listOf("20261101"), store.list().map { it.build })
    assertEquals(listOf(SpeedLimitPackStore.INDEX_FILE, "test+vectora.obsl"), dir.list()!!.sorted())
  }

  @Test
  fun keepsTheOldPackWhenTheNewOneFailsItsChecks() {
    val store = store()
    updater(store).update(publish("test/vectora", "20261101"))
    val wrongHash = publish("test/vectora", "20261201").copy(sha256 = "0".repeat(64))
    val wrongRegion = publish("test/vectora", "20261202", pack("test/vectorb"))
    val notAPack = publish("test/vectora", "20261203", ByteArray(vectorPack.size))

    assertEquals(PackUpdate.Failed, updater(store).update(wrongHash))
    assertEquals(PackUpdate.Failed, updater(store).update(wrongRegion))
    assertEquals(PackUpdate.Failed, updater(store).update(notAPack))
    assertEquals(listOf("20261101"), store.list().map { it.build })
    store.withPacks { roads -> assertNotNull(roads!!.roadsNear(51.5, -0.05, 2_000.0)) }
  }

  @Test
  fun replacesAPackWithANewerBuild() {
    val store = store()
    updater(store).update(publish("test/vectora", "20261101"))
    val newer = publish("test/vectora", "20261201")

    assertEquals(PackUpdate.Installed, updater(store).update(newer))
    assertEquals(PackUpdate.AlreadyInstalled, updater(store).update(newer))
    assertEquals(listOf("20261201"), store.list().map { it.build })
    assertEquals(2, requests.size)
  }

  @Test
  fun makesRoomByDeletingTheRegionLeftLongestAgo() {
    val store = store()
    store.noteRegion("test/vectora", nowMillis = 1_000)
    updater(store).update(publish("test/vectora", "20261201"))
    store.noteRegion("test/vectorb", nowMillis = 2_000)
    updater(store).update(publish("test/vectorb", "20261201"))
    store.noteRegion("test/vectora", nowMillis = 3_000)
    store.noteRegion("test/vectorc", nowMillis = 4_000)
    updater(store).update(publish("test/vectorc", "20261201"))

    assertEquals(listOf("test/vectora", "test/vectorc"), store.list().map { it.regionId }.sorted())
    assertTrue(store.totalBytes() <= vectorPack.size * 2L)
  }

  @Test
  fun neverDeletesTheCurrentRegionToMakeRoom() {
    val store = store(budget = vectorPack.size.toLong())
    store.noteRegion("test/vectora", nowMillis = 1_000)
    updater(store).update(publish("test/vectora", "20261201"))
    val other = publish("test/vectorb", "20261201")

    assertEquals(PackUpdate.NoRoom, updater(store).update(other))
    assertEquals(listOf("test/vectora"), store.list().map { it.regionId })
  }

  @Test
  fun clearDeletesEveryPack() {
    val store = store()
    updater(store).update(publish("test/vectora", "20261201"))
    updater(store).update(publish("test/vectorb", "20261201"))
    store.clear()

    assertTrue(store.list().isEmpty())
    assertEquals(0, store.totalBytes())
    assertTrue(dir.listFiles().orEmpty().none { it.name.endsWith(".obsl") })
    store.withPacks { roads -> assertNull(roads) }
  }

  @Test
  fun readsWhatAnEarlierStoreSaved() {
    store().noteRegion("test/vectora", nowMillis = 1_000)
    updater(store()).update(publish("test/vectora", "20261201"))
    val again = SpeedLimitPackStore(dir, vectorPack.size * 2L)

    assertEquals("test/vectora", again.currentRegion)
    assertEquals(listOf(InstalledPack("test/vectora", "20261201", sha256(pack("test/vectora")), vectorPack.size.toLong(), 1_000)), again.list())
  }

  @Test
  fun ignoresFilesItDidNotInstall() {
    File(dir, "stray.obsl").writeBytes(pack("test/vectora"))
    File(dir, SpeedLimitPackStore.INDEX_FILE).writeText("not\tan\tindex\n")

    assertFalse(store().list().any())
  }
}
