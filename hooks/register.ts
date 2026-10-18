import type { Register } from 'claude-code'

// A subagent's completion reaches the main conversation twice: once as the
// report it sent by SendMessage, and again as the engine's idle_notification
// carrying its final text, which restates the same report. A late inbox
// message can also wake a finished agent for one more turn, which ends in a
// second idle_notification. This hook keeps the name and idleReason of such a
// repeat and cuts its result to one line.
//
// Measured 2026-10-04 on 2.1.289: a subagent's SendMessage to main raises
// session.send with the sender's agentId and never reaches session.receive;
// the idle_notification reaches session.receive as bare JSON text, the
// <teammate-message> wrapper being added afterwards.

const WINDOW_MS = 15 * 60 * 1000

const reported = new Map<string, number>()   // agent name -> time it sent a report to main
const idled = new Map<string, number>()      // agent name -> time its last idle result arrived
const asked = new Map<string, number>()      // agent name -> time main last messaged it

const isRecent = (at: number | undefined, now: number) => at !== undefined && now - at <= WINDOW_MS

// A notice repeats an earlier delivery only when nothing was asked of the
// agent since then; a reply to a follow-up SendMessage is a new answer.
function isRepeat(from: string, now: number): boolean {
  const last = Math.max(reported.get(from) ?? 0, idled.get(from) ?? 0)
  if (!isRecent(last, now)) return false
  const askedAt = asked.get(from)
  return askedAt === undefined || askedAt < last
}

function parseIdle(text: string): Record<string, unknown> | undefined {
  const body = text.trim()
  if (!body.startsWith('{')) return undefined
  try {
    const value = JSON.parse(body)
    return value && value.type === 'idle_notification' && typeof value.from === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  on('session.send', async ($, e, next) => {
    if (e.agentId !== undefined && e.to === 'main') {
      const sender = (await $.agent.list()).find(a => a.id === e.agentId)
      if (sender?.name !== undefined) reported.set(sender.name, await $.clock.now())
    } else if (e.agentId === undefined) {
      const now = await $.clock.now()
      asked.set(e.to, now)
      const target = (await $.agent.list()).find(a => a.id === e.to || a.teammateId === e.to)
      if (target?.name !== undefined) asked.set(target.name, now)
    }
    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    const notice = parseIdle(e.text)
    if (notice === undefined) return next(e)

    const now = await $.clock.now()
    const from = notice.from as string
    const result = typeof notice.result === 'string' ? notice.result : undefined
    const reason = notice.idleReason
    const cut = (reason === undefined || reason === 'available') && isRepeat(from, now) && result !== undefined
    idled.set(from, now)
    if (!cut || result === undefined) return next(e)

    const head = result.replace(/\s+/g, ' ').slice(0, 120)
    notice.result = `[idle-dedupe] ${from} is idle; its report was already delivered above. Final text began: ${head}`
    return next({ ...e, text: JSON.stringify(notice) })
  })
}
