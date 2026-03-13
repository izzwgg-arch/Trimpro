'use client'
// ─── Session Entry Screen — The screen RBTs dream about using ────────────────
import { useState, use, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { nanoid } from 'nanoid'
import {
  Play, Pause, Square, ChevronLeft, ChevronRight, RotateCcw,
  Plus, Minus, Clock, Mic, MicOff, Check, X, AlertCircle,
  SkipForward, ChevronDown, Timer, Zap, Brain,
} from 'lucide-react'
import { MOCK_CLIENTS, MOCK_TARGETS, MOCK_PROGRAMS } from '@/lib/smart-steps/mock-data'
import { DEFAULT_PROMPT_LEVELS } from '@/lib/smart-steps/types'
import type { Trial, BehaviorEvent, ActiveSessionState } from '@/lib/smart-steps/types'
import { useSmartStepsStore } from '@/lib/smart-steps/store'
import ReactConfetti from 'react-confetti'

function nanoidShort() {
  // simple unique ID without nanoid dep issue
  return Math.random().toString(36).slice(2, 11)
}

// ─── Trial Button — the button therapists tap 10,000 times a day ─────────────
function TrialBtn({
  label, color, icon, onClick, count, className = '',
}: {
  label: string
  color: string
  icon?: React.ReactNode
  onClick: () => void
  count?: number
  className?: string
}) {
  const [pressed, setPressed] = useState(false)

  const handleClick = () => {
    setPressed(true)
    setTimeout(() => setPressed(false), 150)
    // Haptic on mobile PWA
    if ('vibrate' in navigator) navigator.vibrate(30)
    onClick()
  }

  return (
    <motion.button
      animate={{ scale: pressed ? 0.92 : 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 20 }}
      whileHover={{ scale: 1.04 }}
      onClick={handleClick}
      className={`relative flex flex-col items-center justify-center rounded-2xl font-bold text-white min-h-[80px] min-w-[80px] select-none active:scale-95 shadow-lg transition-shadow ${color} ${className}`}
    >
      {count !== undefined && (
        <div className="absolute top-2 right-2 bg-black/30 rounded-full text-xs font-bold px-1.5 py-0.5 min-w-[20px] text-center">
          {count}
        </div>
      )}
      {icon && <div className="mb-1">{icon}</div>}
      <span className="text-sm leading-tight px-2 text-center">{label}</span>
    </motion.button>
  )
}

// ─── Frequency counter — tap tap tap ─────────────────────────────────────────
function FrequencyCounter({ name, count, onIncrement, onDecrement }: {
  name: string; count: number; onIncrement: () => void; onDecrement: () => void
}) {
  return (
    <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
      <div className="font-medium text-white text-sm">{name}</div>
      <div className="flex items-center gap-3">
        <button onClick={onDecrement} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
          <Minus className="w-4 h-4 text-white" />
        </button>
        <motion.span
          key={count}
          initial={{ scale: 1.4 }}
          animate={{ scale: 1 }}
          className="text-2xl font-bold text-white w-10 text-center"
        >
          {count}
        </motion.span>
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={onIncrement}
          className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 transition-all"
        >
          <Plus className="w-5 h-5 text-white" />
        </motion.button>
      </div>
    </div>
  )
}

export default function SessionStartPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const router = useRouter()
  const client = MOCK_CLIENTS.find((c) => c.id === clientId) ?? MOCK_CLIENTS[0]
  const allTargets = MOCK_TARGETS.filter((t) => t.clientId === clientId && t.isActive)
  const {
    activeSession, setActiveSession, updateActiveSession,
    addTrial, undoLastTrial, addBehaviorEvent,
    triggerConfetti, showConfetti, dismissConfetti,
  } = useSmartStepsStore()

  const [sessionStarted, setSessionStarted] = useState(false)
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>(allTargets.slice(0, 3).map((t) => t.id))
  const [currentTargetIdx, setCurrentTargetIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0) // seconds
  const [isPaused, setIsPaused] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [sessionNotes, setSessionNotes] = useState('')
  const [voiceActive, setVoiceActive] = useState(false)
  const [justLogged, setJustLogged] = useState<string | null>(null)

  // Behavior tracking
  const [behaviorCounts, setBehaviorCounts] = useState<Record<string, number>>({ Tantrum: 0, Elopement: 0, Stereotypy: 0 })

  // Undo last result display
  const [lastResult, setLastResult] = useState<string | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const sessionId = useRef(nanoidShort())

  const currentTargets = allTargets.filter((t) => selectedTargetIds.includes(t.id))
  const currentTarget = currentTargets[currentTargetIdx] ?? currentTargets[0]

  // Timer logic
  useEffect(() => {
    if (!sessionStarted || isPaused) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [sessionStarted, isPaused])

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  const startSession = () => {
    const sess: ActiveSessionState = {
      sessionId: sessionId.current,
      clientId,
      startTime: Date.now(),
      pausedMs: 0,
      isPaused: false,
      selectedTargets: selectedTargetIds,
      currentTargetIndex: 0,
      pendingTrials: [],
      pendingBehaviors: [],
      undoStack: [],
    }
    setActiveSession(sess)
    setSessionStarted(true)
  }

  const logTrial = useCallback((result: Trial['result'], promptLevel?: number) => {
    if (!currentTarget) return
    const trial: Trial = {
      id: nanoidShort(),
      sessionId: sessionId.current,
      targetId: currentTarget.id,
      clientId,
      result,
      promptLevel,
      timestamp: new Date().toISOString(),
      therapistId: 't1',
      syncStatus: 'pending',
    }
    addTrial(trial)
    setLastResult(result)
    setJustLogged(result)
    setTimeout(() => setJustLogged(null), 600)
    setPromptOpen(false)
    // Auto-advance to next target after logging
    if (currentTargetIdx < currentTargets.length - 1) {
      setTimeout(() => setCurrentTargetIdx((i) => i + 1), 400)
    }
  }, [currentTarget, clientId, addTrial, currentTargetIdx, currentTargets.length])

  const handleUndo = () => {
    undoLastTrial()
    setLastResult(null)
  }

  const endSession = () => {
    setActiveSession(null)
    router.push(`/smart-steps/${clientId}`)
  }

  const incrementBehavior = (name: string) => {
    setBehaviorCounts((prev) => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }))
    const event: BehaviorEvent = {
      id: nanoidShort(),
      sessionId: sessionId.current,
      clientId,
      behaviorName: name,
      type: 'frequency',
      count: (behaviorCounts[name] ?? 0) + 1,
      timestamp: new Date().toISOString(),
      therapistId: 't1',
      syncStatus: 'pending',
    }
    addBehaviorEvent(event)
    if ('vibrate' in navigator) navigator.vibrate(20)
  }

  const decrementBehavior = (name: string) => {
    setBehaviorCounts((prev) => ({ ...prev, [name]: Math.max(0, (prev[name] ?? 0) - 1) }))
  }

  // ── Pre-session setup ──────────────────────────────────────────────────────
  if (!sessionStarted) {
    return (
      <div className="p-4 md:p-6 min-h-full flex flex-col max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">New Session</h1>
            <p className="text-xs text-slate-400">{client.firstName} {client.lastName}</p>
          </div>
        </div>

        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5 mb-4">
          <h2 className="font-semibold text-white mb-3 text-sm">Select Targets</h2>
          <div className="space-y-2">
            {allTargets.map((t) => (
              <label key={t.id} className="flex items-center gap-3 p-3 bg-white/3 rounded-xl cursor-pointer hover:bg-white/6 transition-all">
                <div
                  onClick={() => setSelectedTargetIds((prev) =>
                    prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                  )}
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    selectedTargetIds.includes(t.id)
                      ? 'bg-cyan-500 border-cyan-500'
                      : 'border-white/30'
                  }`}
                >
                  {selectedTargetIds.includes(t.id) && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">{t.name}</div>
                  <div className="text-[10px] text-slate-500">{t.type.replace(/_/g, ' ')} • {t.phase}</div>
                </div>
                {t.recentAccuracy !== undefined && (
                  <div className={`text-xs font-bold ${t.recentAccuracy >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {t.recentAccuracy}%
                  </div>
                )}
              </label>
            ))}
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={startSession}
          disabled={selectedTargetIds.length === 0}
          className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold rounded-2xl py-4 text-lg shadow-xl shadow-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-cyan-500/50 transition-all"
        >
          <Play className="w-5 h-5" />
          Start Session ({selectedTargetIds.length} targets)
        </motion.button>
      </div>
    )
  }

  // ── Active Session ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#080b14]">
      {showConfetti && (
        <ReactConfetti recycle={false} numberOfPieces={300} onConfettiComplete={dismissConfetti}
          colors={['#22d3ee', '#a855f7', '#ec4899', '#10b981']} />
      )}

      {/* Session header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0d1117] border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-red-400 animate-pulse'}`} />
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              {isPaused ? 'Paused' : 'Live'}
            </span>
          </div>
          <div className="font-mono text-lg font-bold text-cyan-400">{formatTime(elapsed)}</div>
        </div>
        <div className="text-xs text-slate-400 font-medium">
          {client.firstName} • {currentTargetIdx + 1}/{currentTargets.length} targets
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsPaused((p) => !p)}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-white"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button
            onClick={endSession}
            className="p-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 transition-all text-red-400"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Current target display */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentTarget?.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="bg-[#0d1117] border border-cyan-500/20 rounded-2xl p-4 relative overflow-hidden"
          >
            {/* Glow */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />

            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider mb-1">
                  Target {currentTargetIdx + 1} of {currentTargets.length}
                </div>
                <h2 className="text-lg font-bold text-white leading-tight">{currentTarget?.name}</h2>
              </div>
              <div className="flex flex-col items-end gap-1">
                {currentTarget?.recentAccuracy !== undefined && (
                  <div className={`text-sm font-bold ${currentTarget.recentAccuracy >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {currentTarget.recentAccuracy}% recent
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
              {currentTarget?.operationalDefinition}
            </p>

            {/* Target nav */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
              <button
                onClick={() => setCurrentTargetIdx((i) => Math.max(0, i - 1))}
                disabled={currentTargetIdx === 0}
                className="p-2 rounded-xl text-slate-400 hover:text-white disabled:opacity-30 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex gap-1.5">
                {currentTargets.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentTargetIdx(i)}
                    className={`rounded-full transition-all ${i === currentTargetIdx ? 'w-5 h-2 bg-cyan-400' : 'w-2 h-2 bg-white/20'}`}
                  />
                ))}
              </div>
              <button
                onClick={() => setCurrentTargetIdx((i) => Math.min(currentTargets.length - 1, i + 1))}
                disabled={currentTargetIdx === currentTargets.length - 1}
                className="p-2 rounded-xl text-slate-400 hover:text-white disabled:opacity-30 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* ─── THE BIG TRIAL BUTTONS ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <TrialBtn
            label="✓ Correct"
            color="bg-gradient-to-br from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 shadow-emerald-500/30"
            onClick={() => logTrial('correct')}
            count={activeSession?.pendingTrials.filter((t) => t.targetId === currentTarget?.id && t.result === 'correct').length}
            className="text-base min-h-[90px]"
          />
          <TrialBtn
            label="✗ Incorrect"
            color="bg-gradient-to-br from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 shadow-red-500/30"
            onClick={() => logTrial('incorrect')}
            count={activeSession?.pendingTrials.filter((t) => t.targetId === currentTarget?.id && t.result === 'incorrect').length}
            className="text-base min-h-[90px]"
          />
        </div>

        {/* Prompted button with level selector */}
        <div className="relative">
          <button
            onClick={() => setPromptOpen((p) => !p)}
            className="w-full flex items-center justify-between bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-2xl px-4 py-3 text-amber-300 font-semibold hover:border-amber-500/50 transition-all min-h-[52px]"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span>Prompted (select level)</span>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${promptOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {promptOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                className="absolute top-full left-0 right-0 mt-2 bg-[#1e293b] border border-white/20 rounded-2xl p-3 z-20 shadow-xl"
              >
                <div className="grid grid-cols-3 gap-2">
                  {DEFAULT_PROMPT_LEVELS.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => logTrial('prompted', pl.level)}
                      className="flex flex-col items-center p-2 rounded-xl hover:bg-white/10 transition-all border border-white/10 hover:border-white/20"
                      style={{ borderColor: pl.color + '40' }}
                    >
                      <div className="text-lg font-bold" style={{ color: pl.color }}>{pl.abbreviation}</div>
                      <div className="text-[9px] text-slate-400 text-center leading-tight">{pl.label}</div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TrialBtn
            label="— No Response"
            color="bg-gradient-to-br from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600"
            onClick={() => logTrial('no_response')}
            className="min-h-[52px] text-sm"
          />
          <TrialBtn
            label="⟩ Skip"
            color="bg-gradient-to-br from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700"
            onClick={() => { logTrial('skipped'); }}
            className="min-h-[52px] text-sm"
          />
        </div>

        {/* Just logged feedback */}
        <AnimatePresence>
          {justLogged && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={`text-center py-2 rounded-xl text-sm font-bold ${
                justLogged === 'correct' ? 'bg-emerald-500/20 text-emerald-400' :
                justLogged === 'incorrect' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-400'
              }`}
            >
              {justLogged === 'correct' ? '✓ Logged — Correct!' :
               justLogged === 'incorrect' ? '✗ Logged — Incorrect' :
               justLogged === 'prompted' ? '⚡ Logged — Prompted' :
               '• Logged'}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Undo */}
        <button
          onClick={handleUndo}
          disabled={!activeSession?.undoStack.length}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white hover:border-white/20 disabled:opacity-30 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Undo last entry
          {(activeSession?.undoStack.length ?? 0) > 0 && (
            <span className="bg-white/10 rounded-full text-xs px-1.5">{activeSession?.undoStack.length}</span>
          )}
        </button>

        {/* Session trial count */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {['correct', 'incorrect', 'prompted'].map((r) => {
            const count = activeSession?.pendingTrials.filter((t) => t.result === r).length ?? 0
            const colors: Record<string, string> = { correct: 'text-emerald-400', incorrect: 'text-red-400', prompted: 'text-amber-400' }
            return (
              <div key={r} className="bg-white/5 rounded-xl py-2">
                <div className={`text-xl font-bold ${colors[r]}`}>{count}</div>
                <div className="text-[10px] text-slate-500 capitalize">{r}</div>
              </div>
            )
          })}
        </div>

        {/* Behavior frequency trackers */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-purple-400" />
            Behavior Tracking
          </h3>
          <div className="space-y-2">
            {Object.entries(behaviorCounts).map(([name, count]) => (
              <FrequencyCounter
                key={name}
                name={name}
                count={count}
                onIncrement={() => incrementBehavior(name)}
                onDecrement={() => decrementBehavior(name)}
              />
            ))}
          </div>
        </div>

        {/* Session notes */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">Session Notes</h3>
            <button
              onClick={() => setVoiceActive((v) => !v)}
              className={`p-2 rounded-xl transition-all ${voiceActive ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-slate-400 hover:text-white'}`}
            >
              {voiceActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
          </div>
          <textarea
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            placeholder="Type or dictate session notes..."
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 resize-none"
          />
        </div>

        {/* End session button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={endSession}
          className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-2xl shadow-xl shadow-purple-500/30 text-base hover:shadow-purple-500/50 transition-all"
        >
          End Session & Save ({activeSession?.pendingTrials.length ?? 0} trials)
        </motion.button>
      </div>
    </div>
  )
}
