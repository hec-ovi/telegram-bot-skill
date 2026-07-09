// The deterministic, non-agentic access gate. Pure decision logic: a
// normalized message plus the store snapshot in, exactly one decision out.
// No message text reaches any model unless this returns 'run'.

import type { StoreData, Tier } from '../store/store.ts'
import type { IncomingMessage } from '../telegram/types.ts'

export type GateDecision =
  | { action: 'run'; tier: Tier }
  | { action: 'greet'; tier: Tier }
  | { action: 'claim-owner' }
  | { action: 'request-approval' }
  | { action: 'still-pending' }
  | { action: 'approve'; targetUserId: number; verdict: 'trusted' | 'guest' | 'blocked' }
  | { action: 'ignore' }

const CALLBACK_PATTERN = /^gate:(trusted|guest|blocked):(\d+)$/

export function decide(message: IncomingMessage, data: StoreData): GateDecision {
  const state = data.users[String(message.userId)]?.state

  if (message.kind === 'callback') {
    // Only the owner's buttons mean anything; anyone can press a button
    // in a forwarded screenshot, so the sender is what gets checked.
    if (state !== 'owner') return { action: 'ignore' }
    const match = CALLBACK_PATTERN.exec(message.callbackData ?? '')
    if (match === null) return { action: 'ignore' }
    return {
      action: 'approve',
      verdict: match[1] as 'trusted' | 'guest' | 'blocked',
      targetUserId: Number(match[2]),
    }
  }

  const start = /^\/start(?:\s+(\S+))?$/.exec(message.text)
  if (start !== null) {
    const code = start[1]
    // The claim code only exists while the bot has no owner; first valid
    // claim wins and the code dies with it.
    if (data.claimCode !== undefined && code === data.claimCode) {
      return { action: 'claim-owner' }
    }
    if (state === 'owner' || state === 'trusted' || state === 'guest') {
      return { action: 'greet', tier: state }
    }
    if (state === 'pending') return { action: 'still-pending' }
    if (state === 'blocked') return { action: 'ignore' }
    return { action: 'request-approval' }
  }

  if (state === 'owner' || state === 'trusted' || state === 'guest') {
    return { action: 'run', tier: state }
  }
  if (state === 'pending') return { action: 'still-pending' }
  if (state === 'blocked') return { action: 'ignore' }
  return { action: 'request-approval' }
}
