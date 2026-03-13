'use client'
// ─── Smart Steps Main Dashboard — Where the magic begins ─────────────────────
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, TrendingUp, Brain, Zap, AlertTriangle, Star,
  ChevronRight, Search, Filter, Plus, Activity, Target,
  Calendar, Clock, Trophy,
} from 'lucide-react'
import { MOCK_CLIENTS, MOCK_CLIENT_STATS } from '@/lib/smart-steps/mock-data'
import type { ABAClient } from '@/lib/smart-steps/types'
import ReactConfetti from 'react-confetti'
import { useSmartStepsStore } from '@/lib/smart-steps/store'

const DIAGNOSIS_COLORS: Record<string, string> = {
  'ASD Level 1': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'ASD Level 2': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'ASD Level 3': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'ADHD': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Intellectual Disability': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'Sensory Processing Disorder': 'bg-pink-500/20 text-pink-300 border-pink-500/30',
}

function getProgressColor(pct: number) {
  if (pct >= 80) return 'from-emerald-400 to-cyan-400'
  if (pct >= 60) return 'from-cyan-400 to-blue-400'
  if (pct >= 40) return 'from-amber-400 to-orange-400'
  return 'from-rose-400 to-pink-400'
}

function ClientCard({ client }: { client: ABAClient }) {
  const stats = MOCK_CLIENT_STATS[client.id]
  const progress = client.overallProgress ?? 0
  const initials = `${client.firstName[0]}${client.lastName[0]}`
  const gradients = ['from-cyan-500 to-blue-600', 'from-purple-500 to-pink-600', 'from-emerald-500 to-cyan-600', 'from-amber-500 to-orange-600']
  const grad = gradients[client.id.charCodeAt(1) % gradients.length]

  return (
    <Link href={`/smart-steps/${client.id}`}>
      <motion.div
        whileHover={{ y: -4, scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        className="group relative bg-[#0d1117] border border-white/10 rounded-2xl p-5 cursor-pointer hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 overflow-hidden"
      >
        {/* Background glow on hover */}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-purple-500/0 group-hover:from-cyan-500/5 group-hover:to-purple-500/5 transition-all duration-500 rounded-2xl" />

        {/* Header */}
        <div className="flex items-start justify-between mb-4 relative">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg`}>
              {initials}
            </div>
            <div>
              <div className="font-semibold text-white text-base leading-tight">
                {client.firstName} {client.lastName}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{client.age} yrs old</div>
            </div>
          </div>
          {stats?.plateauAlerts > 0 && (
            <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 text-xs text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              {stats.plateauAlerts}
            </div>
          )}
        </div>

        {/* Diagnosis tags */}
        <div className="flex flex-wrap gap-1.5 mb-4 relative">
          {client.diagnosisTags.map((tag) => (
            <span
              key={tag}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${DIAGNOSIS_COLORS[tag] || 'bg-slate-700 text-slate-300 border-slate-600'}`}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Progress bar */}
        <div className="mb-4 relative">
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>Overall Progress</span>
            <span className="font-bold text-white">{progress}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
              className={`h-full rounded-full bg-gradient-to-r ${getProgressColor(progress)}`}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{client.masteredTargets}/{client.totalTargets} targets mastered</div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 relative">
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <div className="text-lg font-bold text-white leading-none">{client.sessionsThisWeek}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">sessions/wk</div>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <div className="text-lg font-bold text-cyan-400 leading-none">{stats?.avgAccuracyThisWeek ?? '--'}%</div>
            <div className="text-[10px] text-slate-400 mt-0.5">accuracy</div>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <div className="text-lg font-bold text-purple-400 leading-none">{client.masteredTargets}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">mastered</div>
          </div>
        </div>

        {/* Last session */}
        {client.lastSessionDate && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 relative">
            <Clock className="w-3 h-3" />
            Last session: {new Date(client.lastSessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            <ChevronRight className="w-3 h-3 ml-auto text-slate-600 group-hover:text-cyan-400 transition-colors" />
          </div>
        )}
      </motion.div>
    </Link>
  )
}

export default function SmartStepsDashboard() {
  const [clients, setClients] = useState<ABAClient[]>(MOCK_CLIENTS)
  const [search, setSearch] = useState('')
  const [filterDiag, setFilterDiag] = useState<string | null>(null)
  const { showConfetti, dismissConfetti } = useSmartStepsStore()

  // Global stats
  const totalClients = clients.length
  const totalSessions = clients.reduce((s, c) => s + (c.sessionsThisWeek ?? 0), 0)
  const avgProgress = Math.round(clients.reduce((s, c) => s + (c.overallProgress ?? 0), 0) / clients.length)
  const totalMastered = clients.reduce((s, c) => s + (c.masteredTargets ?? 0), 0)
  const totalBehaviors = Object.values(MOCK_CLIENT_STATS).reduce((s, st) => s + st.topBehaviors.reduce((b, bh) => b + bh.count, 0), 0)

  const filtered = clients.filter((c) => {
    const matchSearch = `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      c.diagnosisTags.some((d) => d.toLowerCase().includes(search.toLowerCase()))
    const matchDiag = !filterDiag || c.diagnosisTags.includes(filterDiag)
    return matchSearch && matchDiag
  })

  const allDiags = Array.from(new Set(clients.flatMap((c) => c.diagnosisTags)))

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-full">
      {showConfetti && (
        <ReactConfetti
          recycle={false}
          numberOfPieces={400}
          onConfettiComplete={dismissConfetti}
          colors={['#22d3ee', '#a855f7', '#ec4899', '#10b981', '#f59e0b']}
        />
      )}

      {/* Hero Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight">
            Smart Steps{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ABA Tracker
            </span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-xl px-5 py-2.5 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 transition-all self-start"
        >
          <Plus className="w-4 h-4" />
          New Client
        </motion.button>
      </div>

      {/* Global KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Active Clients', value: totalClients, icon: Users, color: 'text-cyan-400', bg: 'from-cyan-500/10 to-cyan-500/5' },
          { label: 'Sessions / Week', value: totalSessions, icon: Activity, color: 'text-purple-400', bg: 'from-purple-500/10 to-purple-500/5' },
          { label: 'Avg Progress', value: `${avgProgress}%`, icon: TrendingUp, color: 'text-emerald-400', bg: 'from-emerald-500/10 to-emerald-500/5' },
          { label: 'Targets Mastered', value: totalMastered, icon: Star, color: 'text-amber-400', bg: 'from-amber-500/10 to-amber-500/5' },
          { label: 'Behaviors Logged', value: totalBehaviors, icon: Brain, color: 'text-pink-400', bg: 'from-pink-500/10 to-pink-500/5' },
        ].map((kpi) => (
          <motion.div
            key={kpi.label}
            whileHover={{ y: -2 }}
            className={`bg-gradient-to-br ${kpi.bg} border border-white/10 rounded-2xl p-4`}
          >
            <div className={`${kpi.color} mb-2`}><kpi.icon className="w-5 h-5" /></div>
            <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{kpi.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Teaser Stats Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-cyan-500/20 rounded-2xl px-5 py-3 flex flex-wrap items-center gap-4 text-sm"
      >
        <Zap className="w-4 h-4 text-cyan-400 flex-shrink-0" />
        <span className="text-slate-300">
          <span className="text-cyan-400 font-bold">{totalSessions}</span> sessions this week
        </span>
        <span className="text-slate-600 hidden md:block">•</span>
        <span className="text-slate-300">
          Mastery <span className="text-amber-400 font-bold">🔥 {avgProgress}%</span>
        </span>
        <span className="text-slate-600 hidden md:block">•</span>
        <span className="text-slate-300">
          <span className="text-purple-400 font-bold">{totalBehaviors}</span> behaviors logged this month
        </span>
      </motion.div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients by name or diagnosis..."
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:bg-white/8 transition-all"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterDiag(null)}
            className={`text-xs px-3 py-2 rounded-xl border transition-all font-medium ${!filterDiag ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'}`}
          >
            All
          </button>
          {allDiags.map((d) => (
            <button
              key={d}
              onClick={() => setFilterDiag(d === filterDiag ? null : d)}
              className={`text-xs px-3 py-2 rounded-xl border transition-all font-medium ${filterDiag === d ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Client Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            My Clients <span className="text-slate-400 font-normal text-sm">({filtered.length})</span>
          </h2>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <div>No clients match your search</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            <AnimatePresence>
              {filtered.map((client, i) => (
                <motion.div
                  key={client.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <ClientCard client={client} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* AI Nudge Placeholder */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-4 flex items-start gap-3"
      >
        <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
          <Brain className="w-4 h-4 text-purple-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-purple-300">AI Clinical Insight ✨</div>
          <div className="text-xs text-slate-400 mt-1">
            Marcus has shown plateau behavior on "Mand for help" for 6 days.{' '}
            <span className="text-purple-300">Consider DRO or increasing motivation operations before next session.</span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
