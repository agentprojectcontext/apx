package dev.apx.voice

import org.junit.Assert.*
import org.junit.Test

class VoiceStartGateTest {
  @Test fun lateWakeResponseCannotScheduleCallAfterWakeOff() {
    val gate = VoiceStartGate()
    val wake = gate.ticket(wake = true)
    var requests = 0
    val response = { gate.run(wake) { requests++ } }
    gate.cancelWake()
    assertFalse(response())
    assertEquals(0, requests)
  }

  @Test fun delayedMicrophoneHandoffCannotStartAfterHangup() {
    val gate = VoiceStartGate()
    val pending = gate.ticket()
    val actions = mutableListOf<String>()
    val handoff = { gate.run(pending) { actions.add("calls.start"); actions.add("audio") } }
    gate.cancel()
    assertFalse(handoff())
    assertTrue(actions.isEmpty())
  }

  @Test fun wakeOffPreservesExplicitManualStart() {
    val gate = VoiceStartGate()
    val manual = gate.ticket()
    val wake = gate.ticket(wake = true)
    val actions = mutableListOf<String>()
    gate.cancelWake()
    assertTrue(gate.run(manual) { actions.add("manual") })
    assertFalse(gate.run(wake) { actions.add("wake") })
    assertEquals(listOf("manual"), actions)
  }

  @Test fun reenableDoesNotReviveOldWakeResponse() {
    val gate = VoiceStartGate()
    val old = gate.ticket(wake = true)
    gate.cancelWake()
    val fresh = gate.ticket(wake = true)
    var requests = 0
    assertFalse(gate.run(old) { requests++ })
    assertTrue(gate.run(fresh) { requests++ })
    assertEquals(1, requests)
  }

  @Test fun destroyOrUnpairPermanentlyRejectsQueuedAndNewStarts() {
    val gate = VoiceStartGate()
    val old = gate.ticket()
    gate.close()
    var audio = 0
    assertFalse(gate.run(old) { audio++ })
    assertFalse(gate.run(gate.ticket()) { audio++ })
    assertEquals(0, audio)
  }

  @Test fun cancelledAuthorizationResultCannotPlayGreetingOrOpenSocket() {
    val gate = VoiceStartGate()
    val ticket = gate.ticket()
    val actions = mutableListOf<String>()
    assertTrue(gate.run(ticket) { actions.add("request") })
    gate.close()
    assertFalse(gate.run(ticket) { actions.add("greeting"); actions.add("socket") })
    assertEquals(listOf("request"), actions)
  }

  @Test fun lateSocketAndRecorderRetryCannotSendOrOpenAudio() {
    val gate = VoiceStartGate()
    val ticket = gate.ticket()
    val actions = mutableListOf<String>()
    val socketOpen = { gate.run(ticket) { actions.add("send buffered audio"); actions.add("start audio") } }
    val recorderRetry = { gate.run(ticket) { actions.add("create recorder") } }
    gate.close()
    assertFalse(socketOpen())
    assertFalse(recorderRetry())
    assertTrue(actions.isEmpty())
  }

  @Test fun validAuthorizationCanPlayGreetingAndStartAudio() {
    val gate = VoiceStartGate()
    val ticket = gate.ticket()
    val actions = mutableListOf<String>()
    assertTrue(gate.run(ticket) {
      actions.add("authorized")
      gate.run(ticket) { actions.add("audio") }
    })
    assertEquals(listOf("authorized", "audio"), actions)
  }
}
