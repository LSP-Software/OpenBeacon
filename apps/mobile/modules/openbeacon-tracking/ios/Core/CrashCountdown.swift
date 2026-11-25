import Foundation

enum CrashCountdownPhase: String {
  case counting = "COUNTING"
  case sent = "SENT"
  case cancelled = "CANCELLED"
  case saidOk = "SAID_OK"
  case testFinished = "TEST_FINISHED"
}

struct CrashCountdown: Equatable {
  static let realMillis: Int64 = 60_000
  static let testMillis: Int64 = 10_000

  var suspicion: CrashSuspicion
  var test: Bool
  var startedMillis: Int64
  var phase: CrashCountdownPhase

  static func start(suspicion: CrashSuspicion, test: Bool, nowMillis: Int64) -> CrashCountdown {
    CrashCountdown(suspicion: suspicion, test: test, startedMillis: nowMillis, phase: .counting)
  }

  var endsAtMillis: Int64 { startedMillis + (test ? Self.testMillis : Self.realMillis) }

  func secondsLeft(nowMillis: Int64) -> Int {
    Int(max((endsAtMillis - nowMillis + 999) / 1_000, 0))
  }

  func tick(nowMillis: Int64) -> CrashCountdown {
    phase == .counting && nowMillis >= endsAtMillis ? finish() : self
  }

  func sendNow() -> CrashCountdown {
    phase == .counting ? finish() : self
  }

  func imOk() -> CrashCountdown {
    var next = self
    switch phase {
    case .counting: next.phase = .cancelled
    case .sent: next.phase = .saidOk
    default: break
    }
    return next
  }

  private func finish() -> CrashCountdown {
    var next = self
    next.phase = test ? .testFinished : .sent
    return next
  }
}
