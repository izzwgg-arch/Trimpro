'use client'
// ─── Programs & Targets Management — BCBA's favorite screen ──────────────────
import { useState, use } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Plus, Target, BookOpen, ChevronDown, ChevronRight,
  Edit2, Trash2, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle, Lock, Zap, Brain, Star,
} from 'lucide-react'
import { MOCK_CLIENTS, MOCK_TARGETS, MOCK_PROGRAMS } from '@/lib/smart-steps/mock-data'
import type { Target as TargetType, Program } from '@/lib/smart-steps/types'

const DOMAIN_COLORS: Record<string, string> = {
  Mand: 'from-cyan-500/20 to-cyan-500/10 border-cyan-500/30 text-cyan-300',
  Tact: 'from-purple-500/20 to-purple-500/10 border-purple-500/30 text-purple-300',
  Intraverbal: 'from-blue-500/20 to-blue-500/10 border-blue-500/30 text-blue-300',
  Echoic: 'from-pink-500/20 to-pink-500/10 border-pink-500/30 text-pink-300',
  Social: 'from-emerald-500/20 to-emerald-500/10 border-emerald-500/30 text-emerald-300',
  ADL: 'from-amber-500/20 to-amber-500/10 border-amber-500/30 text-amber-300',
  Academic: 'from-rose-500/20 to-rose-500/10 border-rose-500/30 text-rose-300',
  Motor: 'from-violet-500/20 to-violet-500/10 border-violet-500/30 text-violet-300',
  Behavior: 'from-red-500/20 to-red-500/10 border-red-500/30 text-red-300',
}

const PHASE_META = {
  baseline:       { label: 'Baseline',        dot: 'bg-slate-400' },
  acquisition:    { label: 'Acquisition',      dot: 'bg-cyan-400' },
  maintenance:    { label: 'Maintenance',      dot: 'bg-blue-400' },
  generalization: { label: 'Generalization',   dot: 'bg-purple-400' },
  mastered:       { label: '⭐ Mastered',      dot: 'bg-emerald-400' },
  on_hold:        { label: 'On Hold',          dot: 'bg-red-400' },
}

function ProgramBlock({ program, targets }: { program: Program; targets: TargetType[] }) {
  const [expanded, setExpanded] = useState(true)
  const domainStyle = DOMAIN_COLORS[program.domain] || DOMAIN_COLORS['Mand']
  const masteredCount = targets.filter((t) => t.phase === 'mastered').length
  const activeCount = targets.filter((t) => t.isActive && t.phase !== 'mastered').length

  return (
    <motion.div
      layout
      className="bg-[#0d1117] border border-white/10 rounded-2xl overflow-hidden"
    >
      {/* Program header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-4 hover:bg-white/3 transition-all text-left"
      >
        <div className={`text-xs font-bold px-2.5 py-1 rounded-lg bg-gradient-to-r border ${domainStyle} flex-shrink-0`}>
          {program.domain}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm">{program.name}</div>
          {program.description && (
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">{program.description}</div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400">
            <span className="text-emerald-400 font-bold">{masteredCount}</span>/<span>{targets.length}</span>
            <span>mastered</span>
          </div>
          <div className={`w-4 h-4 rounded transition-transform ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </button>

      {/* Targets list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-white/5 divide-y divide-white/5">
              {targets.map((target) => {
                const phase = PHASE_META[target.phase]
                return (
                  <motion.div
                    key={target.id}
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                    className="flex items-center gap-3 px-4 py-3 group"
                  >
                    <div className={`w-2 h-2 rounded-full ${phase.dot} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate flex items-center gap-2">
                        {target.name}
                        {target.phase === 'mastered' && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                        {(target.plateauDays ?? 0) >= 5 && (
                          <span className="flex items-center gap-0.5 text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            plateau
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>{phase.label}</span>
                        <span>•</span>
                        <span>{target.type.replace(/_/g, ' ')}</span>
                        {target.masteryRule && (
                          <>
                            <span>•</span>
                            <span className="text-slate-600">Mastery: {target.masteryRule.percentCorrect}% × {target.masteryRule.consecutiveSessions} sessions</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {target.recentAccuracy !== undefined && (
                        <div className={`text-sm font-bold ${target.recentAccuracy >= 80 ? 'text-emerald-400' : target.recentAccuracy >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                          {target.recentAccuracy}%
                        </div>
                      )}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}

              {/* Add target row */}
              <button className="flex items-center gap-2 px-4 py-3 w-full text-left text-xs text-slate-500 hover:text-cyan-400 hover:bg-white/3 transition-all">
                <Plus className="w-3.5 h-3.5" />
                Add target to {program.name}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function ProgramsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const client = MOCK_CLIENTS.find((c) => c.id === clientId) ?? MOCK_CLIENTS[0]
  const programs = MOCK_PROGRAMS.filter((p) => p.clientId === clientId)
  const targets = MOCK_TARGETS.filter((t) => t.clientId === clientId)

  const totalTargets = targets.length
  const masteredCount = targets.filter((t) => t.phase === 'mastered').length
  const activeCount = targets.filter((t) => t.isActive && t.phase !== 'mastered').length
  const plateauCount = targets.filter((t) => (t.plateauDays ?? 0) >= 5).length

  return (
    <div className="p-4 md:p-6 space-y-5 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/smart-steps/${clientId}`}>
            <button className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Programs & Targets</h1>
            <p className="text-xs text-slate-400">{client.firstName} {client.lastName}</p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-xl px-4 py-2.5 shadow-lg shadow-cyan-500/30 text-sm"
        >
          <Plus className="w-4 h-4" />
          New Program
        </motion.button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Targets', value: totalTargets, color: 'text-white' },
          { label: 'Active', value: activeCount, color: 'text-cyan-400' },
          { label: 'Mastered', value: masteredCount, color: 'text-emerald-400' },
          { label: 'Plateaued', value: plateauCount, color: plateauCount > 0 ? 'text-amber-400' : 'text-slate-500' },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Mastery criteria legend */}
      <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-start gap-3">
        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 leading-relaxed">
          <span className="font-semibold text-emerald-300">Auto-advance enabled</span> — Targets will automatically move to maintenance when mastery criteria are met.
          BCBAs will receive a notification for review before phase change is finalized.
        </div>
      </div>

      {/* Programs list */}
      <div className="space-y-3">
        {programs.map((prog) => (
          <ProgramBlock
            key={prog.id}
            program={prog}
            targets={targets.filter((t) => t.programId === prog.id)}
          />
        ))}

        {programs.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium">No programs yet</div>
            <div className="text-sm mt-1">Create the first program for {client.firstName}</div>
          </div>
        )}
      </div>

      {/* AI suggestion */}
      <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-4 flex items-start gap-3">
        <Brain className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-semibold text-purple-300 mb-1">BCBA Suggestion ✨</div>
          <div className="text-xs text-slate-400">
            {plateauCount > 0
              ? `${plateauCount} targets have been in plateau for 5+ days. Review antecedent conditions and consider modifying prompt fading procedures.`
              : `Target mastery is progressing well. Consider adding generalization probes for recently mastered targets to promote maintenance.`}
          </div>
        </div>
      </div>
    </div>
  )
}
