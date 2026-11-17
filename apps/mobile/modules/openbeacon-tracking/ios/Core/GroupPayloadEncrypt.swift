import CryptoKit
import Foundation

struct EncryptedGroupPayload: Equatable {
  let algorithm: String
  let ciphertext: String
  let epochId: String
  let groupId: String
  let kind: String
  let nonce: String
  let senderDeviceId: String
}

enum GroupPayloadError: Error {
  case invalidKeyLength
  case invalidNonceLength
  case unsupportedAlgorithm
  case invalidBase64
  case ciphertextTooShort
}

enum GroupPayloadEncrypt {
  static let algorithm = "XChaCha20-Poly1305"
  static let domainContext = "openbeacon.group-epoch.v1"
  static let purpose = "payload"
  static let epochKeyLength = 32
  static let nonceLength = 24
  private static let tagLength = 16

  static func encrypt(
    epochKey: Data,
    plaintext: Data,
    groupId: String,
    epochId: String,
    kind: String,
    senderDeviceId: String,
    nonce: Data? = nil
  ) throws -> EncryptedGroupPayload {
    guard epochKey.count == epochKeyLength else { throw GroupPayloadError.invalidKeyLength }
    let resolvedNonce = nonce ?? randomBytes(nonceLength)
    guard resolvedNonce.count == nonceLength else { throw GroupPayloadError.invalidNonceLength }

    let (key, innerNonce) = try xChaChaSubkey(epochKey: epochKey, nonce: resolvedNonce)
    let sealed = try ChaChaPoly.seal(
      plaintext,
      using: key,
      nonce: innerNonce,
      authenticating: associatedData(groupId: groupId, epochId: epochId, kind: kind, senderDeviceId: senderDeviceId)
    )

    return EncryptedGroupPayload(
      algorithm: algorithm,
      ciphertext: (sealed.ciphertext + sealed.tag).base64EncodedString(),
      epochId: epochId,
      groupId: groupId,
      kind: kind,
      nonce: resolvedNonce.base64EncodedString(),
      senderDeviceId: senderDeviceId
    )
  }

  static func decrypt(epochKey: Data, payload: EncryptedGroupPayload) throws -> Data {
    guard epochKey.count == epochKeyLength else { throw GroupPayloadError.invalidKeyLength }
    guard payload.algorithm == algorithm else { throw GroupPayloadError.unsupportedAlgorithm }
    guard let nonce = Data(base64Encoded: payload.nonce), let combined = Data(base64Encoded: payload.ciphertext) else {
      throw GroupPayloadError.invalidBase64
    }
    guard nonce.count == nonceLength else { throw GroupPayloadError.invalidNonceLength }
    guard combined.count >= tagLength else { throw GroupPayloadError.ciphertextTooShort }

    let (key, innerNonce) = try xChaChaSubkey(epochKey: epochKey, nonce: nonce)
    let box = try ChaChaPoly.SealedBox(
      nonce: innerNonce,
      ciphertext: combined.prefix(combined.count - tagLength),
      tag: combined.suffix(tagLength)
    )
    return try ChaChaPoly.open(
      box,
      using: key,
      authenticating: associatedData(
        groupId: payload.groupId,
        epochId: payload.epochId,
        kind: payload.kind,
        senderDeviceId: payload.senderDeviceId
      )
    )
  }

  static func associatedData(groupId: String, epochId: String, kind: String, senderDeviceId: String) -> Data {
    Data(
      "{\"context\":\(jsonString(domainContext)),\"epochId\":\(jsonString(epochId)),\"groupId\":\(jsonString(groupId)),\"kind\":\(jsonString(kind)),\"purpose\":\(jsonString(purpose)),\"senderDeviceId\":\(jsonString(senderDeviceId))}".utf8
    )
  }

  static func clientPointId(epochKey: Data, parts: [String], byteCount: Int) -> String {
    let context = parts.map { Data($0.utf8).base64EncodedString() }.joined(separator: ":")
    let mac = HMAC<SHA256>.authenticationCode(for: Data(context.utf8), using: SymmetricKey(data: epochKey))
    return Data(mac).prefix(byteCount).base64EncodedString()
  }

  static func randomBytes(_ count: Int) -> Data {
    var generator = SystemRandomNumberGenerator()
    return Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
  }

  private static func xChaChaSubkey(epochKey: Data, nonce: Data) throws -> (SymmetricKey, ChaChaPoly.Nonce) {
    let subkey = hChaCha20(key: [UInt8](epochKey), nonce: [UInt8](nonce.prefix(16)))
    let innerNonce = try ChaChaPoly.Nonce(data: Data(repeating: 0, count: 4) + nonce.suffix(8))
    return (SymmetricKey(data: subkey), innerNonce)
  }

  static func hChaCha20(key: [UInt8], nonce: [UInt8]) -> Data {
    let readWord = { (bytes: [UInt8], offset: Int) -> UInt32 in
      UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8 | UInt32(bytes[offset + 2]) << 16 | UInt32(bytes[offset + 3]) << 24
    }
    var state: [UInt32] = [0x6170_7865, 0x3320_646E, 0x7962_2D32, 0x6B20_6574]
    state += (0..<8).map { readWord(key, $0 * 4) }
    state += (0..<4).map { readWord(nonce, $0 * 4) }

    let quarterRound = { (state: inout [UInt32], a: Int, b: Int, c: Int, d: Int) in
      state[a] &+= state[b]; state[d] ^= state[a]; state[d] = state[d] << 16 | state[d] >> 16
      state[c] &+= state[d]; state[b] ^= state[c]; state[b] = state[b] << 12 | state[b] >> 20
      state[a] &+= state[b]; state[d] ^= state[a]; state[d] = state[d] << 8 | state[d] >> 24
      state[c] &+= state[d]; state[b] ^= state[c]; state[b] = state[b] << 7 | state[b] >> 25
    }
    for _ in 0..<10 {
      quarterRound(&state, 0, 4, 8, 12)
      quarterRound(&state, 1, 5, 9, 13)
      quarterRound(&state, 2, 6, 10, 14)
      quarterRound(&state, 3, 7, 11, 15)
      quarterRound(&state, 0, 5, 10, 15)
      quarterRound(&state, 1, 6, 11, 12)
      quarterRound(&state, 2, 7, 8, 13)
      quarterRound(&state, 3, 4, 9, 14)
    }

    var output = Data(capacity: 32)
    for word in [state[0], state[1], state[2], state[3], state[12], state[13], state[14], state[15]] {
      output.append(contentsOf: [UInt8(word & 0xFF), UInt8(word >> 8 & 0xFF), UInt8(word >> 16 & 0xFF), UInt8(word >> 24 & 0xFF)])
    }
    return output
  }

  private static func jsonString(_ value: String) -> String {
    var escaped = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\\": escaped += "\\\\"
      case "\"": escaped += "\\\""
      case "\u{08}": escaped += "\\b"
      case "\u{0C}": escaped += "\\f"
      case "\n": escaped += "\\n"
      case "\r": escaped += "\\r"
      case "\t": escaped += "\\t"
      default:
        if scalar.value < 0x20 {
          escaped += String(format: "\\u%04x", scalar.value)
        } else {
          escaped.unicodeScalars.append(scalar)
        }
      }
    }
    return escaped + "\""
  }
}

