package net.openbeacon.speedlimits

import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.time.Duration
import kotlin.system.exitProcess
import org.json.JSONArray
import org.json.JSONObject

private const val GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1-nogeom.json"
private const val USER_AGENT = "openbeacon-speed-limit-packs/1 (+https://openbeacon.net)"

private val usage =
  """
  Usage:
    build --pbf <file> --region <id> --name <name> --country <code> --build <yyyymmdd> --out <dir>
    build-continent --continent <id> --build <yyyymmdd> --out <dir> --work <dir>
    plan --continent <id>

  build writes one pack from a local Geofabrik extract. build-continent downloads every
  country in a Geofabrik continent, builds its pack, splits any pack over 200 MiB into
  Geofabrik's next level down, and writes regions.json listing every pack it wrote.
  """
    .trimIndent()

private val http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(30)).build()

fun main(args: Array<String>) {
  val command = args.firstOrNull()
  val options =
    args.drop(1).chunked(2).associate { pair ->
      require(pair.size == 2 && pair[0].startsWith("--")) { usage }
      pair[0].removePrefix("--") to pair[1]
    }
  val option = { name: String -> options[name] ?: error("Missing --$name\n\n$usage") }

  when (command) {
    "build" -> {
      val entry =
        buildPack(
          pbf = File(option("pbf")),
          planned =
            PlannedRegion(
              GeofabrikRegion(option("region"), option("name"), null, emptyList(), emptyList(), ""),
              option("country"),
            ),
          build = option("build").toInt(),
          out = File(option("out")),
        )
      println(entry.toString(2))
    }
    "build-continent" ->
      buildContinent(
        continent = option("continent"),
        build = option("build").toInt(),
        out = File(option("out")),
        work = File(option("work")),
      )
    "plan" ->
      countriesIn(parseGeofabrikIndex(fetchText(GEOFABRIK_INDEX_URL)), option("continent")).forEach {
        println("${it.region.id} (${it.countryCode})")
      }
    else -> {
      System.err.println(usage)
      exitProcess(1)
    }
  }
}

fun buildPack(pbf: File, planned: PlannedRegion, build: Int, out: File): JSONObject {
  val writer = PackWriter(planned.region.id, build)
  readRoads(pbf, planned.countryCode, DefaultSpeeds.load()) { writer.add(it) }
  val file = File(out, "${planned.region.id}.obsl")
  file.parentFile.mkdirs()
  file.outputStream().buffered(1 shl 20).use { writer.writeTo(it) }
  return packEntry(planned, file, out)
}

private fun packEntry(planned: PlannedRegion, file: File, out: File): JSONObject {
  val digest = MessageDigest.getInstance("SHA-256")
  file.inputStream().use { input ->
    val buffer = ByteArray(1 shl 20)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      digest.update(buffer, 0, read)
    }
  }
  val header = file.inputStream().use { it.readNBytes(40) }
  val bound = { offset: Int ->
    (header[offset].toInt() and 0xFF or
      (header[offset + 1].toInt() and 0xFF shl 8) or
      (header[offset + 2].toInt() and 0xFF shl 16) or
      (header[offset + 3].toInt() shl 24)) / 1e5
  }
  return JSONObject()
    .put("id", planned.region.id)
    .put("name", planned.region.name)
    .put("countryCode", planned.countryCode)
    .put("file", file.relativeTo(out).invariantSeparatorsPath)
    .put("size", file.length())
    .put("sha256", digest.digest().joinToString("") { "%02x".format(it) })
    .put("bounds", JSONArray(listOf(bound(24), bound(28), bound(32), bound(36))))
}

private fun buildContinent(continent: String, build: Int, out: File, work: File) {
  val index = parseGeofabrikIndex(fetchText(GEOFABRIK_INDEX_URL))
  val entries = JSONArray()
  val queue = ArrayDeque(countriesIn(index, continent))
  work.mkdirs()

  while (queue.isNotEmpty()) {
    val planned = queue.removeFirst()
    val extractBytes = contentLength(planned.region.pbfUrl)

    if (shouldSplitBeforeBuilding(index, planned, extractBytes)) {
      println("${planned.region.id} has a ${extractBytes / 1_048_576} MiB extract; building its subregions instead")
      splitRegion(index, planned).reversed().forEach { queue.addFirst(it) }
      continue
    }

    val pbf = File(work, "${planned.region.id.replace('/', '_')}.osm.pbf")
    println("Downloading ${planned.region.id} from ${planned.region.pbfUrl}")
    download(planned.region.pbfUrl, pbf)
    println("Building ${planned.region.id} (${pbf.length() / 1_048_576} MiB extract, defaults for ${planned.countryCode})")
    val entry = buildPack(pbf, planned, build, out)
    pbf.delete()
    val size = entry.getLong("size")

    if (shouldSplit(index, planned, size)) {
      println("${planned.region.id} is ${size / 1_048_576} MiB, over the split size; building its subregions instead")
      File(out, entry.getString("file")).delete()
      splitRegion(index, planned).reversed().forEach { queue.addFirst(it) }
    } else {
      println("Built ${planned.region.id}: ${size / 1_048_576} MiB")
      entries.put(entry)
    }
  }

  File(out, "regions.json").writeText(JSONObject().put("continent", continent).put("build", build).put("regions", entries).toString(2))
}

private fun contentLength(url: String): Long {
  val head = HttpRequest.newBuilder(URI(url)).header("User-Agent", USER_AGENT).method("HEAD", HttpRequest.BodyPublishers.noBody()).timeout(Duration.ofMinutes(1)).build()
  val response = http.send(head, HttpResponse.BodyHandlers.discarding())
  check(response.statusCode() == 200) { "HEAD $url failed: HTTP ${response.statusCode()}" }
  return response.headers().firstValueAsLong("content-length").orElseThrow()
}

private fun fetchText(url: String): String {
  val response = http.send(request(url), HttpResponse.BodyHandlers.ofString())
  check(response.statusCode() == 200) { "GET $url failed: HTTP ${response.statusCode()}" }
  return response.body()
}

private fun download(url: String, target: File) {
  val partial = File(target.path + ".part")
  val response = http.send(request(url), HttpResponse.BodyHandlers.ofFile(partial.toPath()))
  check(response.statusCode() == 200) { "GET $url failed: HTTP ${response.statusCode()}" }
  check(partial.renameTo(target)) { "Could not move ${partial.path} into place" }
}

private fun request(url: String) =
  HttpRequest.newBuilder(URI(url)).header("User-Agent", USER_AGENT).timeout(Duration.ofHours(2)).build()
