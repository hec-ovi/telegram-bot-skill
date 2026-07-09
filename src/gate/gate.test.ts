import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from './gate.ts'
import type { StoreData, UserState } from '../store/store.ts'
import type { IncomingMessage } from '../telegram/types.ts'

function text(userId: number, body: string): IncomingMessage {
  return { kind: 'text', chatId: userId, userId, messageId: 1, text: body, name: 'u' }
}

function callback(userId: number, data: string): IncomingMessage {
  return { kind: 'callback', chatId: userId, userId, messageId: 2, callbackId: 'cb', callbackData: data }
}

function storeWith(users: Record<string, UserState>, claimCode?: string): StoreData {
  const data: StoreData = { users: {}, sessions: {}, claimCode }
  for (const [id, state] of Object.entries(users)) {
    data.users[id] = { state, chatId: Number(id), addedAt: 'x' }
  }
  return data
}

test('unknown user asking anything lands in request-approval', () => {
  assert.deepEqual(decide(text(9, 'hello'), storeWith({})), { action: 'request-approval' })
})

test('the right claim code claims ownership; a wrong one does not', () => {
  const data = storeWith({}, 'SECRET')
  assert.deepEqual(decide(text(9, '/start SECRET'), data), { action: 'claim-owner' })
  assert.deepEqual(decide(text(9, '/start WRONG'), data), { action: 'request-approval' })
  assert.deepEqual(decide(text(9, '/start'), data), { action: 'request-approval' })
})

test('a claim after the code was consumed is just a stranger knocking', () => {
  const data = storeWith({ 1: 'owner' })
  assert.deepEqual(decide(text(9, '/start SECRET'), data), { action: 'request-approval' })
})

test('tiers map to run decisions; blocked and pending never run', () => {
  const data = storeWith({ 1: 'owner', 2: 'trusted', 3: 'guest', 4: 'blocked', 5: 'pending' })
  assert.deepEqual(decide(text(1, 'do it'), data), { action: 'run', tier: 'owner' })
  assert.deepEqual(decide(text(2, 'do it'), data), { action: 'run', tier: 'trusted' })
  assert.deepEqual(decide(text(3, 'do it'), data), { action: 'run', tier: 'guest' })
  assert.deepEqual(decide(text(4, 'do it'), data), { action: 'ignore' })
  assert.deepEqual(decide(text(5, 'do it'), data), { action: 'still-pending' })
})

test('/start from an approved user greets instead of running', () => {
  const data = storeWith({ 2: 'trusted' })
  assert.deepEqual(decide(text(2, '/start'), data), { action: 'greet', tier: 'trusted' })
})

test('only the owner can approve; forged and malformed callbacks are ignored', () => {
  const data = storeWith({ 1: 'owner', 2: 'trusted', 5: 'pending' })
  assert.deepEqual(decide(callback(1, 'gate:trusted:5'), data), {
    action: 'approve',
    verdict: 'trusted',
    targetUserId: 5,
  })
  assert.deepEqual(decide(callback(2, 'gate:trusted:5'), data), { action: 'ignore' })
  assert.deepEqual(decide(callback(9, 'gate:trusted:5'), data), { action: 'ignore' })
  assert.deepEqual(decide(callback(1, 'gate:root:5'), data), { action: 'ignore' })
  assert.deepEqual(decide(callback(1, 'whatever'), data), { action: 'ignore' })
})
