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
      exclude("**/BatteryReader.kt")
      exclude("**/SecureEpochKeyStore.kt")
      exclude("**/CiphertextQueueEntity.kt")
      exclude("**/CiphertextQueueDao.kt")
      exclude("**/CiphertextQueueDatabase.kt")
      exclude("**/RoomCiphertextQueue.kt")
    }
  }
  test {
    resources {
      srcDir("../../../../../packages/encryption/src/testVectors")
      include("group-payload-interop-v1.json")
    }
  }
}

tasks.test {
  useJUnit()
}
