import Foundation

struct SealedDriveRecord: Equatable {
  let driveId: String
  let startHour: Int64
  let nonce: String
  let ciphertext: String
}

enum DriveRecordSeal {
  static func seal(
    record: DriveRecord,
    epochKey: Data,
    groupId: String,
    epochId: String,
    senderDeviceId: String,
    nonce: Data? = nil
  ) throws -> SealedDriveRecord? {
    guard let plaintext = DriveRecordCodec.encode(record) else { return nil }
    let encrypted = try GroupPayloadEncrypt.encrypt(
      epochKey: epochKey,
      plaintext: plaintext,
      groupId: groupId,
      epochId: epochId,
      kind: DriveRecordCodec.kind,
      senderDeviceId: senderDeviceId,
      driveId: record.driveId,
      nonce: nonce
    )
    return SealedDriveRecord(
      driveId: record.driveId,
      startHour: Int64((Double(record.start.timeMillis) / 3_600_000).rounded(.down)),
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext
    )
  }

  static func open(_ sealed: SealedDriveRecord, epochKey: Data, groupId: String, epochId: String, senderDeviceId: String) -> DriveRecord? {
    let payload = EncryptedGroupPayload(
      algorithm: GroupPayloadEncrypt.algorithm,
      ciphertext: sealed.ciphertext,
      epochId: epochId,
      groupId: groupId,
      kind: DriveRecordCodec.kind,
      nonce: sealed.nonce,
      senderDeviceId: senderDeviceId
    )
    guard
      let plaintext = try? GroupPayloadEncrypt.decrypt(epochKey: epochKey, payload: payload, driveId: sealed.driveId),
      let record = DriveRecordCodec.decode(plaintext),
      record.driveId == sealed.driveId,
      record.start.timeMillis / 3_600_000 == sealed.startHour
    else { return nil }
    return record
  }
}
