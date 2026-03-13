'use client'
// ─── Client Hub — Everything about one learner, beautifully organized ─────────
import { useState, use } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Play, BarChart2, BookOpen, Target, TrendingUp, TrendingDown,
  Minus, AlertTriangle, Star, ChevronRight, Calendar, Brain, Clock, Activity,
  MessageSquare, Video, User,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar,
} from 'recharts'
import {
  MOCK_CLIENTS, MOCK_TARGETS, MOCK_PROGRAMS, MOCK_CLIENT_STATS,
  generateMockTrialHistory, generateBehaviorHistory, generateHeatmapData, MOCK_BEHAVIORS,
} from '@/lib/smart-steps/mock-data'
import type { Target } from '@/lib/smart-steps/types'
import { useSmartStepsStore } from '@/lib/smart-steps/store'

const PHASE_CONFIG = {
  baseline:        { label: 'Baseline',        color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  acquisition:     { label: 'Acquisition',     color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  maintenance:     { label: 'Maintenance',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  generalization:  { label: 'Generalization',  color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  mastered:        { label: 'Mastered ⭐',      color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  on_hold:         { label: 'On Hold',         color: 'bg-red-500/20 text-red-300 border-red-500/30' },
}

const TREND_ICON = {
  up:      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  down:    <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
  flat:    <Minus className="w-3.5 h-3.5 text-amber-400" />,
  plateau: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
}

function HeatmapCalendar({ clientId }: { clientId: string }) {
  const data = generateHeatmapData(clientId)
  const weeks: Array<typeof data> = []
  let week: typeof data = []
  data.forEach((d, i) => {
    week.push(d)
    if (week.length === 7 || i === data.length - 1) { weeks.push(week); week = [] }
  })

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-1 min-w-max">
        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {wk.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count} session(s)`}
                className={`w-3.5 h-3.5 rounded-sm cursor-pointer transition-all hover:scale-125 ${
                  d.count === 0 ? 'bg-white/5' :
                  d.count === 1 ? 'bg-cyan-500/40' :
                  'bg-cyan-400'
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-500">
        <span>Less</span>
        <div className="w-3 h-3 rounded-sm bg-white/5" />
        <div className="w-3 h-3 rounded-sm bg-cyan-500/40" />
        <div className="w-3 h-3 rounded-sm bg-cyan-400" />
        <span>More</span>
      </div>
    </div>
  )
}

function TargetRow({ target }: { target: Target }) {
  const phase = PHASE_CONFIG[target.phase]
  return (
    <motion.div
      whileHover={{ x: 2 }}
      className="flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/6 border border-white/5 hover:border-cyan-500/20 transition-all cursor-pointer"
    >
      <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${phase.color} flex-shrink-0`}>
        {phase.label}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium truncate">{target.name}</div>
        <div className="text-[10px] text-slate-500 truncate">{target.operationalDefinition}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {target.recentAccuracy !== undefined && (
          <div className={`text-sm font-bold ${target.recentAccuracy >= 80 ? 'text-emerald-400' : target.recentAccuracy >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
            {target.recentAccuracy}%
          </div>
        )}
        {target.trend && TREND_ICON[target.trend]}
        {target.plateauDays && target.plateauDays >= 5 && (
          <div className="flex items-center gap-0.5 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
            <AlertTriangle className="w-2.5 h-2.5" />
            {target.plateauDays}d
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default function ClientHubPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const client = MOCK_CLIENTS.find((c) => c.id === clientId) ?? MOCK_CLIENTS[0]
  const stats = MOCK_CLIENT_STATS[clientId] ?? MOCK_CLIENT_STATS['c1']
  const targets = MOCK_TARGETS.filter((t) => t.clientId === clientId)
  const programs = MOCK_PROGRAMS.filter((p) => p.clientId === clientId)
  const { triggerConfetti } = useSmartStepsStore()

  const [selectedTarget, setSelectedTarget] = useState(targets.find((t) => t.isActive)?.id ?? targets[0]?.id)
  const [chartRange, setChartRange] = useState<14 | 30 | 60>(30)

  const chartData = selectedTarget ? generateMockTrialHistory(selectedTarget, chartRange) : []
  const behaviorData = generateBehaviorHistory('Tantrum', 30)

  const activeTargets = targets.filter((t) => t.phase !== 'mastered' && t.phase !== 'on_hold' && t.isActive)
  const masteredTargets = targets.filter((t) => t.phase === 'mastered')
  const plateauTargets = targets.filter((t) => (t.plateauDays ?? 0) >= 5)

  const initials = `${client.firstName[0]}${client.lastName[0]}`

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/smart-steps">
            <button className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-cyan-500/30">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{client.firstName} {client.lastName}</h1>
            <div className="text-xs text-slate-400">{client.age} yrs • {client.diagnosisTags[0]}</div>
          </div>
        </div>
        <Link href={`/smart-steps/${clientId}/session/active`}>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold rounded-xl px-4 py-2.5 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 transition-all text-sm min-h-[44px]"
          >
            <Play className="w-4 h-4" />
            Start Session
          </motion.button>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Mastery Rate', value: `${stats.masteryRate}%`, sub: `${stats.masteredTargets}/${stats.totalTargets} targets`, color: 'text-emerald-400', bg: 'from-emerald-500/10 to-emerald-500/5', icon: Star },
          { label: 'Sessions / Week', value: stats.sessionsThisWeek, sub: 'this week', color: 'text-cyan-400', bg: 'from-cyan-500/10 to-cyan-500/5', icon: Calendar },
          { label: 'Accuracy', value: `${stats.avgAccuracyThisWeek}%`, sub: 'last 7 days', color: 'text-purple-400', bg: 'from-purple-500/10 to-purple-500/5', icon: TrendingUp },
          { label: 'Plateau Alerts', value: stats.plateauAlerts, sub: `targets stalled`, color: stats.plateauAlerts > 0 ? 'text-amber-400' : 'text-slate-400', bg: 'from-amber-500/10 to-amber-500/5', icon: AlertTriangle },
        ].map((s) => (
          <motion.div key={s.label} whileHover={{ y: -2 }} className={`bg-gradient-to-br ${s.bg} border border-white/10 rounded-2xl p-4`}>
            <div className={`${s.color} mb-2`}><s.icon className="w-4 h-4" /></div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{s.label}</div>
            <div className="text-[10px] text-slate-600">{s.sub}</div>
          </motion.div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left: Target accuracy chart */}
        <div className="xl:col-span-2 space-y-4">
          {/* Chart */}
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-white">Target Performance</h3>
                <p className="text-xs text-slate-400 mt-0.5">% Correct over time</p>
              </div>
              <div className="flex gap-1.5">
                {([14, 30, 60] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`text-xs px-3 py-1 rounded-lg transition-all font-medium ${chartRange === r ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-white'}`}
                  >
                    {r}d
                  </button>
                ))}
              </div>
            </div>
            {/* Target selector pills */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {targets.filter((t) => t.isActive).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTarget(t.id)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${selectedTarget === t.id ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'}`}
                >
                  {t.name.length > 25 ? t.name.slice(0, 25) + '…' : t.name}
                </button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cgradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(v: number) => [`${v}%`, 'Accuracy']}
                />
                <Area type="monotone" dataKey="percent" stroke="#22d3ee" strokeWidth={2} fill="url(#cgradient)" dot={{ fill: '#22d3ee', r: 3 }} />
                {/* Mastery line */}
                <Line type="monotone" dataKey={() => 80} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-2">
              <div className="w-4 h-px border-dashed border-t border-emerald-500" />
              <span>Mastery criterion (80%)</span>
            </div>
          </div>

          {/* Behavior chart */}
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-1">Behavior Frequency</h3>
            <p className="text-xs text-slate-400 mb-4">Tantrum frequency (30 days)</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={behaviorData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Session heatmap */}
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-1">Session Calendar</h3>
            <p className="text-xs text-slate-400 mb-3">Last 90 days</p>
            <HeatmapCalendar clientId={clientId} />
          </div>
        </div>

        {/* Right: Targets list + info */}
        <div className="space-y-4">
          {/* Programs */}
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white text-sm">Active Programs</h3>
              <Link href={`/smart-steps/${clientId}/programs`}>
                <span className="text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer">View all →</span>
              </Link>
            </div>
            <div className="space-y-2">
              {programs.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs p-2 bg-white/3 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0" />
                  <span className="text-white flex-1">{p.name}</span>
                  <span className="text-slate-500">{p.domain}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Targets */}
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white text-sm">
                Active Targets <span className="text-slate-500 font-normal">({activeTargets.length})</span>
              </h3>
              {plateauTargets.length > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                  <AlertTriangle className="w-3 h-3" />
                  {plateauTargets.length} plateau
                </div>
              )}
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {activeTargets.map((t) => <TargetRow key={t.id} target={t} />)}
              {activeTargets.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-4">No active targets</div>
              )}
            </div>
          </div>

          {/* Top behaviors */}
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
            <h3 className="font-semibold text-white text-sm mb-3">Top Behaviors This Week</h3>
            <div className="space-y-2">
              {stats.topBehaviors.map((b) => (
                <div key={b.name} className="flex items-center gap-2">
                  <div className="flex-1 text-xs text-slate-300">{b.name}</div>
                  <div className="text-xs font-bold text-white">{b.count}x</div>
                  <div>
                    {b.trend === 'down' ? <TrendingDown className="w-3 h-3 text-emerald-400" /> :
                     b.trend === 'up' ? <TrendingUp className="w-3 h-3 text-red-400" /> :
                     <Minus className="w-3 h-3 text-amber-400" />}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI insight */}
          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-semibold text-purple-300">AI Insight</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {stats.plateauAlerts > 0
                ? `${plateauTargets[0]?.name} has been in plateau for ${plateauTargets[0]?.plateauDays} days. Consider reviewing prompt hierarchy or introducing errorless teaching.`
                : `${client.firstName} is trending positively across ${activeTargets.length} targets. Excellent work! Consider increasing session frequency for generalization probes.`
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
