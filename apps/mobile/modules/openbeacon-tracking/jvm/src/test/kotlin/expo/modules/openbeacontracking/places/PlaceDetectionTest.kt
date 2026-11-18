package expo.modules.openbeacontracking.places

import expo.modules.openbeacontracking.capture.SharingCaptureState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlaceDetectionTest {
  private val home = PlaceGeofence("group-1", "home", 51.5, -0.1, 150.0)
  private val school = PlaceGeofence("group-2", "school", 52.5, -1.1, 300.0)
  private val sharing = SharingCaptureState()
  private val owner = "owner-1"
  private var nextId = 0

  private fun detection(
    store: PlaceStore = InMemoryPlaceStore(),
    queue: PlaceTransitionQueue = InMemoryPlaceTransitionQueue(),
  ) = PlaceDetection(store, queue, newId = { "id-${nextId++}" })

  private fun PlaceDetection.fix(
    place: PlaceGeofence,
    metersNorth: Double,
    atSeconds: Long,
    state: SharingCaptureState = sharing,
  ) = onFix(
    owner = owner,
    deviceId = "device-1",
    sharing = state,
    nowMillis = (atSeconds + 1) * 1_000,
    latitude = place.latitude + metersNorth / 111_195.0,
    longitude = place.longitude,
    accuracyMeters = 10.0,
    timestampMillis = (atSeconds + 1) * 1_000,
  )

  private fun PlaceDetection.arriveAtHome(fromSeconds: Long): Int {
    fix(home, 1_000.0, fromSeconds)
    return (fromSeconds + 30..fromSeconds + 300 step 30).sumOf { fix(home, 0.0, it) }
  }

  @Test
  fun aCrossingQueuesExactlyOneTransitionForThisDevice() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    assertEquals(1, detection.arriveAtHome(0))
    val queued = detection.queued(owner, 10)
    assertEquals(1, queued.size)
    assertEquals(
      PlaceTransitionRow("id-0", owner, "device-1", "group-1", "home", PlaceTransitionRow.ARRIVE, 31_000),
      queued.single(),
    )
    assertTrue(detection.hasQueued(owner))
    detection.acknowledge(listOf("id-0"))
    assertFalse(detection.hasQueued(owner))
  }

  @Test
  fun nothingIsRecordedWhileSharingIsPaused() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    val paused = SharingCaptureState(revisionPrefix = "s1.1:", paused = true)
    detection.fix(home, 1_000.0, 0, paused)
    assertEquals(0, (30L..600L step 30).sumOf { detection.fix(home, 0.0, it, paused) })
    assertFalse(detection.hasQueued(owner))
  }

  @Test
  fun aPauseClearsStateAndQueuedTransitions() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    detection.arriveAtHome(0)
    detection.fix(home, 1_000.0, 400)
    val paused = SharingCaptureState(revisionPrefix = "s1.1:", paused = true)
    detection.onSharingChanged(owner, paused, 450_000)
    assertFalse(detection.hasQueued(owner))
    val resumed = SharingCaptureState(revisionPrefix = "s1.2:", paused = false, resumeAfter = 500_000)
    detection.onSharingChanged(owner, resumed, 500_000)
    assertEquals(0, (510L..900L step 30).sumOf { detection.fix(home, 1_000.0, it, resumed) })
    assertFalse(detection.hasQueued(owner))
  }

  @Test
  fun fixesFromBeforeAResumeAreNotUsed() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    val resumed = SharingCaptureState(resumeAfter = 1_000_000)
    detection.fix(home, 1_000.0, 0, resumed)
    assertEquals(0, (30L..300L step 30).sumOf { detection.fix(home, 0.0, it, resumed) })
  }

  @Test
  fun turningTheSwitchOffForAGroupStopsDetectionAndClearsItsQueue() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    detection.setGroupPlaces("group-2", listOf(school))
    detection.arriveAtHome(0)
    detection.setGroupPlaces("group-1", emptyList())
    assertFalse(detection.hasQueued(owner))
    assertEquals(0, detection.arriveAtHome(1_000))
  }

  @Test
  fun aHeldGroupDetectsNothingAndDropsItsQueueUntilTheHoldLifts() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    detection.setGroupPlaces("group-2", listOf(school))
    detection.arriveAtHome(0)
    detection.fix(school, 1_000.0, 400)
    (430L..700L step 30).forEach { detection.fix(school, 0.0, it) }
    detection.dropQueued(listOf("group-1"))
    assertEquals(listOf("group-2"), detection.queued(owner, 10).map { it.groupId })
    detection.acknowledge(detection.queued(owner, 10).map { it.clientId })

    val held = setOf("group-1")
    fun heldFix(metersNorth: Double, atSeconds: Long) =
      detection.onFix(owner, "device-1", sharing, (atSeconds + 1) * 1_000, home.latitude + metersNorth / 111_195.0, home.longitude, 10.0, (atSeconds + 1) * 1_000, held)
    heldFix(1_000.0, 800)
    (830L..1_100L step 30).forEach { heldFix(0.0, it) }
    assertEquals(listOf("group-2" to PlaceTransitionRow.LEAVE), detection.queued(owner, 10).map { it.groupId to it.direction })
    detection.acknowledge(detection.queued(owner, 10).map { it.clientId })

    detection.fix(home, 0.0, 1_130)
    assertEquals(0, (1_160L..1_400L step 30).sumOf { detection.fix(home, 0.0, it) })
    assertEquals(1, (1_430L..1_700L step 30).sumOf { detection.fix(home, 1_000.0, it) })
  }

  @Test
  fun deletingAPlaceClearsOnlyThatPlacesTransitions() {
    val queue = InMemoryPlaceTransitionQueue()
    val detection = detection(queue = queue)
    val gym = home.copy(placeId = "gym")
    detection.setGroupPlaces("group-1", listOf(home, gym))
    assertEquals(2, detection.arriveAtHome(0))
    detection.setGroupPlaces("group-1", listOf(gym))
    assertEquals(listOf("gym"), detection.queued(owner, 10).map { it.placeId })
  }

  @Test
  fun leavingAGroupOrSigningOutRemovesItsPlaces() {
    val store = InMemoryPlaceStore()
    val detection = detection(store = store)
    detection.setGroupPlaces("group-1", listOf(home))
    detection.setGroupPlaces("group-2", listOf(school))
    detection.arriveAtHome(0)
    detection.removeGroups(listOf("group-1"))
    assertEquals(listOf(school), store.list())
    assertFalse(detection.hasQueued(owner))
    detection.removeGroups(null)
    assertTrue(store.list().isEmpty())
  }

  @Test
  fun aFixFromFarInTheFutureDoesNotStopDetection() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    detection.fix(home, 1_000.0, 0)
    detection.onFix(
      owner = owner,
      deviceId = "device-1",
      sharing = sharing,
      nowMillis = 2_000,
      latitude = home.latitude,
      longitude = home.longitude,
      accuracyMeters = 10.0,
      timestampMillis = 86_400_000,
    )
    assertEquals(1, (30L..300L step 30).sumOf { detection.fix(home, 0.0, it) })
  }

  @Test
  fun groupsAreRememberedUntilRemovedEvenWithNoPlaces() {
    val detection = detection()
    detection.setGroupPlaces("group-1", listOf(home))
    detection.setGroupPlaces("group-2", emptyList())
    assertEquals(setOf("group-1", "group-2"), detection.groups())
    detection.removeGroups(listOf("group-2"))
    assertEquals(setOf("group-1"), detection.groups())
    detection.removeGroups(null)
    assertEquals(emptySet(), detection.groups())
  }
}
