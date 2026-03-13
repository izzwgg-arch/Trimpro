'use client'
// ─── Dexie.js IndexedDB — Offline-first data layer that never lets you down ──
import Dexie, { type Table } from 'dexie'
import type { ABAClient, Program, Target, Session, Trial, BehaviorEvent, Note, SyncQueueItem } from './types'

export class SmartStepsDB extends Dexie {
  clients!: Table<ABAClient>
  programs!: Table<Program>
  targets!: Table<Target>
  sessions!: Table<Session>
  trials!: Table<Trial>
  behaviorEvents!: Table<BehaviorEvent>
  notes!: Table<Note>
  syncQueue!: Table<SyncQueueItem>

  constructor() {
    super('SmartStepsABA')

    this.version(1).stores({
      clients:       'id, firstName, lastName, updatedAt',
      programs:      'id, clientId, domain, isActive, updatedAt',
      targets:       'id, programId, clientId, phase, isActive, updatedAt',
      sessions:      'id, clientId, therapistId, status, startTime, syncStatus',
      trials:        'id, sessionId, targetId, clientId, timestamp, syncStatus',
      behaviorEvents:'id, sessionId, clientId, behaviorName, timestamp, syncStatus',
      notes:         'id, clientId, sessionId, type, createdAt',
      syncQueue:     'id, type, operation, timestamp, retries',
    })
  }
}

let _db: SmartStepsDB | null = null

export function getDB(): SmartStepsDB {
  if (typeof window === 'undefined') throw new Error('Dexie only runs in browser')
  if (!_db) _db = new SmartStepsDB()
  return _db
}

// ─── Sync helpers ─────────────────────────────────────────────────────────────

export async function upsertToLocal<T extends { id: string; updatedAt: string }>(
  table: Table<T>,
  items: T[]
): Promise<void> {
  for (const item of items) {
    const existing = await table.get(item.id)
    if (!existing || existing.updatedAt <= item.updatedAt) {
      await table.put(item)
    }
  }
}

export async function getPendingSyncItems(db: SmartStepsDB): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('timestamp').toArray()
}

export async function markSynced(db: SmartStepsDB, id: string): Promise<void> {
  await db.syncQueue.delete(id)
}

export async function getSessionWithTrials(
  db: SmartStepsDB,
  sessionId: string
): Promise<{ session: Session | undefined; trials: Trial[]; behaviors: BehaviorEvent[] }> {
  const [session, trials, behaviors] = await Promise.all([
    db.sessions.get(sessionId),
    db.trials.where('sessionId').equals(sessionId).toArray(),
    db.behaviorEvents.where('sessionId').equals(sessionId).toArray(),
  ])
  return { session, trials, behaviors }
}

export async function getClientTrialHistory(
  db: SmartStepsDB,
  clientId: string,
  targetId: string,
  limitDays = 60
): Promise<Trial[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - limitDays)
  return db.trials
    .where('clientId').equals(clientId)
    .and((t) => t.targetId === targetId && t.timestamp >= cutoff.toISOString())
    .sortBy('timestamp')
}
