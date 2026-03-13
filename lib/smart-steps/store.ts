'use client'
// ─── Smart Steps Zustand Store — Global state that actually slaps ─────────────
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActiveSessionState, Trial, BehaviorEvent, SyncQueueItem } from './types'

interface SmartStepsState {
  // Active session
  activeSession: ActiveSessionState | null
  setActiveSession: (s: ActiveSessionState | null) => void
  updateActiveSession: (updates: Partial<ActiveSessionState>) => void

  // Offline sync queue
  syncQueue: SyncQueueItem[]
  addToSyncQueue: (item: SyncQueueItem) => void
  removeFromSyncQueue: (id: string) => void
  clearSyncQueue: () => void
  pendingSyncCount: number

  // Online/offline status
  isOnline: boolean
  setOnline: (v: boolean) => void

  // UI state
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  selectedClientId: string | null
  setSelectedClientId: (id: string | null) => void

  // Session entry helpers
  addTrial: (trial: Trial) => void
  undoLastTrial: () => void
  addBehaviorEvent: (event: BehaviorEvent) => void

  // Confetti / celebrations
  showConfetti: boolean
  triggerConfetti: () => void
  dismissConfetti: () => void

  // Notifications/badges
  unreadBadgeCount: number
  incrementBadge: () => void
  clearBadges: () => void
}

export const useSmartStepsStore = create<SmartStepsState>()(
  persist(
    (set, get) => ({
      // ── Active session ──────────────────────────────────────────────────────
      activeSession: null,
      setActiveSession: (s) => set({ activeSession: s }),
      updateActiveSession: (updates) =>
        set((state) => ({
          activeSession: state.activeSession
            ? { ...state.activeSession, ...updates }
            : null,
        })),

      // ── Sync queue ──────────────────────────────────────────────────────────
      syncQueue: [],
      pendingSyncCount: 0,
      addToSyncQueue: (item) =>
        set((state) => ({
          syncQueue: [...state.syncQueue, item],
          pendingSyncCount: state.syncQueue.length + 1,
        })),
      removeFromSyncQueue: (id) =>
        set((state) => {
          const q = state.syncQueue.filter((i) => i.id !== id)
          return { syncQueue: q, pendingSyncCount: q.length }
        }),
      clearSyncQueue: () => set({ syncQueue: [], pendingSyncCount: 0 }),

      // ── Online status ────────────────────────────────────────────────────────
      isOnline: true,
      setOnline: (v) => set({ isOnline: v }),

      // ── UI ───────────────────────────────────────────────────────────────────
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectedClientId: null,
      setSelectedClientId: (id) => set({ selectedClientId: id }),

      // ── Session helpers ──────────────────────────────────────────────────────
      addTrial: (trial) =>
        set((state) => {
          if (!state.activeSession) return {}
          const pending = [...state.activeSession.pendingTrials, trial]
          const undo = [
            { type: 'trial' as const, id: trial.id },
            ...state.activeSession.undoStack,
          ].slice(0, 10)
          return {
            activeSession: {
              ...state.activeSession,
              pendingTrials: pending,
              undoStack: undo,
            },
            syncQueue: [
              ...state.syncQueue,
              {
                id: trial.id,
                type: 'trial' as const,
                operation: 'create' as const,
                payload: trial,
                timestamp: new Date().toISOString(),
                retries: 0,
              },
            ],
            pendingSyncCount: state.syncQueue.length + 1,
          }
        }),

      undoLastTrial: () =>
        set((state) => {
          if (!state.activeSession?.undoStack.length) return {}
          const [last, ...rest] = state.activeSession.undoStack
          const pending = state.activeSession.pendingTrials.filter(
            (t) => t.id !== last.id
          )
          const queue = state.syncQueue.filter((q) => q.id !== last.id)
          return {
            activeSession: { ...state.activeSession, pendingTrials: pending, undoStack: rest },
            syncQueue: queue,
            pendingSyncCount: queue.length,
          }
        }),

      addBehaviorEvent: (event) =>
        set((state) => {
          if (!state.activeSession) return {}
          return {
            activeSession: {
              ...state.activeSession,
              pendingBehaviors: [...state.activeSession.pendingBehaviors, event],
            },
            syncQueue: [
              ...state.syncQueue,
              {
                id: event.id,
                type: 'behavior' as const,
                operation: 'create' as const,
                payload: event,
                timestamp: new Date().toISOString(),
                retries: 0,
              },
            ],
            pendingSyncCount: state.syncQueue.length + 1,
          }
        }),

      // ── Confetti ─────────────────────────────────────────────────────────────
      showConfetti: false,
      triggerConfetti: () => set({ showConfetti: true }),
      dismissConfetti: () => set({ showConfetti: false }),

      // ── Badges ───────────────────────────────────────────────────────────────
      unreadBadgeCount: 0,
      incrementBadge: () => set((s) => ({ unreadBadgeCount: s.unreadBadgeCount + 1 })),
      clearBadges: () => set({ unreadBadgeCount: 0 }),
    }),
    {
      name: 'smart-steps-store',
      // Only persist sync queue + sidebar state, not active session (too volatile)
      partialize: (state) => ({
        syncQueue: state.syncQueue,
        pendingSyncCount: state.pendingSyncCount,
        sidebarCollapsed: state.sidebarCollapsed,
        selectedClientId: state.selectedClientId,
        unreadBadgeCount: state.unreadBadgeCount,
      }),
    }
  )
)
