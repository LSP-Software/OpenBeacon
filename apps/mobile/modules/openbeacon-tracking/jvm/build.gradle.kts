plugins {
  kotlin("jvm") version "2.1.20"
}

repositories {
  mavenCentral()
}

dependencies {
  implementation("com.google.crypto.tink:tink:1.18.0")
  testImplementation(kotlin("test"))
  testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.1.20")
  testImplementation("org.json:json:20250517")
}

kotlin {
  jvmToolchain(17)
}

sourceSets {
  main {
    java {
      srcDir("../android/src/main/java")
      exclude("**/OpenBeaconTrackingModule.kt")
      exclude("**/TrackingRuntime.kt")
      exclude("**/TrackingCaptureService.kt")
      exclude("**/TrackingUploadService.kt")
      exclude("**/UploadTasks.kt")
      exclude("**/OpenBeaconTrackingPackage.kt")
      exclude("**/PushRuntime.kt")
      exclude("**/PushWakeService.kt")
      exclude("**/SecurePushTokenStore.kt")
      exclude("**/TrackingBootReceiver.kt")
      exclude("**/SharingResumeWorker.kt")
      exclude("**/BatteryReader.kt")
      exclude("**/Notices.kt")
      exclude("**/DriveRecordedNotice.kt")
      exclude("**/PlaceSearch.kt")
      exclude("**/SecureEpochKeyStore.kt")
      exclude("**/Base64Codec.kt")
      exclude("**/CiphertextQueueEntity.kt")
      exclude("**/CiphertextQueueDao.kt")
      exclude("**/CiphertextQueueEvictionEntity.kt")
      exclude("**/CiphertextQueueDatabase.kt")
      exclude("**/RoomCiphertextQueue.kt")
      exclude("**/KeystoreSealer.kt")
      exclude("**/SecurePlaceStore.kt")
      exclude("**/PlaceTransitionEntity.kt")
      exclude("**/PlaceTransitionDao.kt")
      exclude("**/PlaceTransitionDatabase.kt")
      exclude("**/RoomPlaceTransitionQueue.kt")
      exclude("**/DriveQueueEntity.kt")
      exclude("**/DriveQueueDao.kt")
      exclude("**/DriveQueueDatabase.kt")
      exclude("**/RoomDriveQueue.kt")
      exclude("**/SecureDriveLog.kt")
      exclude("**/SecureDriveRecordStore.kt")
      exclude("**/SpeedLimitPackWorker.kt")
      exclude("**/DriveSensors.kt")
      exclude("**/crash/**")
    }
  }
  test {
    resources {
      srcDir("../../../../../packages/encryption/src/testVectors")
      include("group-payload-interop-v1.json")
      include("tracking-point-v2.json")
      include("drive-record-v1.json")
      include("crash-alert-v1.json")
    }
    resources {
      srcDir("../test-cases")
      include("drive-detection-v1.json")
      include("speeding-v1.json")
      include("driving-events-v1.json")
      include("crash-detection-v1.json")
    }
    resources {
      srcDir("../../../../speed-limit-packs/testVectors")
      include("speed-limit-pack-v1.json")
    }
  }
}

tasks.test {
  useJUnit()
}
