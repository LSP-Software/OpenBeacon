import Foundation
import Security

struct ProvisionedEpochKey {
  let groupId: String
  let epochId: String
  let epochKey: Data
  let senderDeviceId: String
  let kind: String
}

final class KeychainItem {
  private static let service = "net.openbeacon.tracking"
  private static let installedKey = "openbeacon_tracking_keychain_installed"

  private let account: String

  init(account: String) {
    self.account = account
  }

  static func removeLeftoversFromPreviousInstall() {
    if UserDefaults.standard.bool(forKey: installedKey) { return }
    SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
    UserDefaults.standard.set(true, forKey: installedKey)
  }

  func read() throws -> Data? {
    var result: AnyObject?
    let status = SecItemCopyMatching(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: Self.service,
        kSecAttrAccount: account,
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
      ] as CFDictionary,
      &result
    )
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw KeychainError(status: status) }
    return result as? Data
  }

  func write(_ data: Data) throws {
    let query = [kSecClass: kSecClassGenericPassword, kSecAttrService: Self.service, kSecAttrAccount: account] as [CFString: Any]
    let updated = SecItemUpdate(
      query as CFDictionary,
      [kSecValueData: data, kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary
    )
    if updated == errSecSuccess { return }
    guard updated == errSecItemNotFound else { throw KeychainError(status: updated) }
    var attributes = query
    attributes[kSecValueData] = data
    attributes[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let added = SecItemAdd(attributes as CFDictionary, nil)
    guard added == errSecSuccess else { throw KeychainError(status: added) }
  }

  func delete() throws {
    let status = SecItemDelete(
      [kSecClass: kSecClassGenericPassword, kSecAttrService: Self.service, kSecAttrAccount: account] as CFDictionary
    )
    guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
  }
}

struct KeychainError: Error {
  let status: OSStatus
}

final class EpochKeyStore {
  private let item = KeychainItem(account: "epochKeys.v1")
  private let lock = NSRecursiveLock()

  func list() -> [ProvisionedEpochKey] {
    lock.lock()
    defer { lock.unlock() }
    do {
      guard let data = try item.read(), let array = try JSONSerialization.jsonObject(with: data) as? [[String: String]] else {
        return []
      }
      return array.compactMap { entry in
        guard
          let groupId = entry["groupId"],
          let epochId = entry["epochId"],
          let epochKey = entry["epochKeyBase64"].flatMap({ Data(base64Encoded: $0) }),
          let senderDeviceId = entry["senderDeviceId"],
          let kind = entry["kind"]
        else { return nil }
        return ProvisionedEpochKey(groupId: groupId, epochId: epochId, epochKey: epochKey, senderDeviceId: senderDeviceId, kind: kind)
      }
    } catch {
      NSLog("OpenBeaconTracking: failed to read provisioned epoch keys: \(error)")
      return []
    }
  }

  func replaceAll(_ keys: [ProvisionedEpochKey]) throws {
    lock.lock()
    defer { lock.unlock() }
    let array = keys.map { key in
      [
        "groupId": key.groupId,
        "epochId": key.epochId,
        "epochKeyBase64": key.epochKey.base64EncodedString(),
        "senderDeviceId": key.senderDeviceId,
        "kind": key.kind,
      ]
    }
    try item.write(JSONSerialization.data(withJSONObject: array))
  }

  func replacePreserving(_ keys: [ProvisionedEpochKey], groupIds: [String]) throws {
    lock.lock()
    defer { lock.unlock() }
    let replacedGroupIds = Set(keys.map(\.groupId))
    let preserved = list().filter { groupIds.contains($0.groupId) && !replacedGroupIds.contains($0.groupId) }
    try replaceAll(preserved + keys)
  }

  func revoke(_ groupIds: [String]?) throws {
    lock.lock()
    defer { lock.unlock() }
    guard let groupIds, !groupIds.isEmpty else {
      try item.delete()
      return
    }
    try replaceAll(list().filter { !groupIds.contains($0.groupId) })
  }
}

final class PlaceStore {
  private let item = KeychainItem(account: "places.v1")
  private let lock = NSRecursiveLock()

  private func read() -> (groups: Set<String>, places: [PlaceGeofence]) {
    do {
      guard
        let data = try item.read(),
        let stored = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let array = stored["places"] as? [[String: Any]]
      else { return ([], []) }
      let places = array.compactMap { entry -> PlaceGeofence? in
        guard
          let groupId = entry["groupId"] as? String,
          let placeId = entry["placeId"] as? String,
          let latitude = (entry["latitude"] as? NSNumber)?.doubleValue,
          let longitude = (entry["longitude"] as? NSNumber)?.doubleValue,
          let radiusMeters = (entry["radiusMeters"] as? NSNumber)?.doubleValue
        else { return nil }
        return PlaceGeofence(groupId: groupId, placeId: placeId, latitude: latitude, longitude: longitude, radiusMeters: radiusMeters)
      }
      return (Set(stored["groups"] as? [String] ?? places.map(\.groupId)), places)
    } catch {
      NSLog("OpenBeaconTracking: failed to read places: \(error)")
      return ([], [])
    }
  }

  private func save(groups: Set<String>, places: [PlaceGeofence]) throws {
    let stored: [String: Any] = [
      "groups": Array(groups),
      "places": places.map { place in
        [
          "groupId": place.groupId,
          "placeId": place.placeId,
          "latitude": place.latitude,
          "longitude": place.longitude,
          "radiusMeters": place.radiusMeters,
        ] as [String: Any]
      },
    ]
    try item.write(JSONSerialization.data(withJSONObject: stored))
  }

  func replaceGroup(_ groupId: String, places: [PlaceGeofence]) throws {
    lock.lock()
    defer { lock.unlock() }
    let stored = read()
    try save(
      groups: stored.groups.union([groupId]),
      places: stored.places.filter { $0.groupId != groupId } + places.filter { $0.groupId == groupId }
    )
  }

  func removeGroups(_ groupIds: [String]?) throws {
    lock.lock()
    defer { lock.unlock() }
    guard let groupIds else {
      try item.delete()
      return
    }
    let stored = read()
    try save(groups: stored.groups.subtracting(groupIds), places: stored.places.filter { !groupIds.contains($0.groupId) })
  }

  func list() -> [PlaceGeofence] {
    lock.lock()
    defer { lock.unlock() }
    return read().places
  }

  func groups() -> Set<String> {
    lock.lock()
    defer { lock.unlock() }
    return read().groups
  }
}
