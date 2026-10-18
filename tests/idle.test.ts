import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

// session.receive hands the hook an idle_notification as bare JSON text
// (measured 2026-10-04, 2.1.289). The SendMessage path, which raises
// session.send with a subagent's agentId, can't be raised from a test and is
// covered by a live probe.

function idle(from: string, result: string, idleReason?: string) {
  const body: Record<string, string> = { type: 'idle_notification', from, timestamp: '2026-10-04T10:42:13.401Z', result }
  if (idleReason !== undefined) body.idleReason = idleReason
  return JSON.stringify(body)
}

function world(on: On) {
  mock.clock(on, { now: 1_000_000 })
  const delivered: string[] = []
  on('session.receive', ($, e) => {
    delivered.push(e.text)
    return { text: e.text }
  })
  on('session.send', () => ({ isDelivered: true }))
  on('agent.list', () => ({ value: [{ id: 'a1', name: 'builder', description: 'build', type: 'general-purpose', status: 'idle' as const }] }))
  return delivered
}

const origin = { kind: 'peer' as const }

test('a second idle notice from an agent that already delivered an idle result is cut to one line', async ($, on) => {
  const delivered = world(on)
  const first = idle('builder', 'All eleven build steps are implemented and committed as abc1234.')
  await $.session.receive({ origin, text: first })
  const long = 'I am not dispatching any research agents, because the task is already finished. '.repeat(20)
  await $.session.receive({ origin, text: idle('builder', long, 'available') })
  expect(delivered[0]).toBe(first)
  const notice = JSON.parse(delivered[1]!) as { from: string; idleReason: string; result: string }
  expect(notice.from).toBe('builder')
  expect(notice.idleReason).toBe('available')
  expect(notice.result).toContain('[idle-dedupe] builder is idle')
  expect(notice.result.length).toBeLessThan(long.length)
})

test('a first idle notice from an agent nobody heard from passes through whole', async ($, on) => {
  const delivered = world(on)
  const text = idle('scout', 'Read the services and found three handlers missing.', 'available')
  await $.session.receive({ origin, text })
  expect(delivered).toEqual([text])
})

test('an idle notice with a non-available reason is never cut', async ($, on) => {
  const delivered = world(on)
  await $.session.receive({ origin, text: idle('fixer', 'Fix done, committed def5678.') })
  const text = idle('fixer', 'cargo check failed in the fix.', 'error')
  await $.session.receive({ origin, text })
  expect(delivered[1]).toBe(text)
})

test('a delivery that is not an idle notice passes through untouched', async ($, on) => {
  const delivered = world(on)
  const text = 'PROBE REPORT: {"type":"idle_notification"} quoted inside prose'
  await $.session.receive({ origin, text })
  expect(delivered).toEqual([text])
})

test('an answer to a follow-up SendMessage from main is left whole', async ($, on) => {
  const delivered = world(on)
  await $.session.receive({ origin, text: idle('builder', 'All eleven steps are implemented and committed as abc1234.') })
  await $.session.send({ to: 'builder', text: 'Which step needed the date fix?', origin: { kind: 'model' } })
  const reply = idle('builder', 'The date fix was needed by the export step, which parses a timestamp the server returns in local time. '.repeat(3), 'available')
  await $.session.receive({ origin, text: reply })
  expect(delivered[1]).toBe(reply)
})

test('a follow-up addressed by agent id also protects the reply', async ($, on) => {
  const delivered = world(on)
  await $.session.receive({ origin, text: idle('builder', 'Done, committed as abc1234.') })
  await $.session.send({ to: 'a1', text: 'One more question.', origin: { kind: 'model' } })
  const reply = idle('builder', 'Here is the answer to the question, in some detail that runs past the cut-off length of one hundred and twenty characters.', 'available')
  await $.session.receive({ origin, text: reply })
  expect(delivered[1]).toBe(reply)
})
