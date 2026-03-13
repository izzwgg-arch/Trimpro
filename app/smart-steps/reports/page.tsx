'use client'
// ─── Reports & Analytics — Data that actually tells a story ──────────────────
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, Download, TrendingUp, TrendingDown, Minus, Star,
  Calendar, Filter, ChevronDown, FileText, Share2, Brain, Zap,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts'
import {
  MOCK_CLIENTS, MOCK_CLIENT_STATS, generateMockTrialHistory,
  generateBehaviorHistory,
} from '@/lib/smart-steps/mock-data'

const COLORS = ['#22d3ee', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#3b82f6']

const domainData = [
  { domain: 'Mand', mastered: 8, active: 3, baseline: 1 },
  { domain: 'Tact', mastered: 12, active: 4, baseline: 0 },
  { domain: 'Intraverbal', mastered: 3, active: 5, baseline: 2 },
  { domain: 'Social', mastered: 2, active: 3, baseline: 1 },
  { domain: 'ADL', mastered: 4, active: 2, baseline: 0 },
  { domain: 'Academic', mastered: 1, active: 3, baseline: 2 },
]

const weeklyTrials = Array.from({ length: 8 }, (_, i) => ({
  week: `W${i + 1}`,
  marcus: Math.floor(Math.random() * 60) + 80,
  aaliyah: Math.floor(Math.random() * 40) + 100,
  ethan: Math.floor(Math.random() * 50) + 60,
  sofia: Math.floor(Math.random() * 70) + 90,
}))

const masteryPieData = [
  { name: 'Mastered', value: 53, color: '#10b981' },
  { name: 'Acquisition', value: 25, color: '#22d3ee' },
  { name: 'Maintenance', value: 8, color: '#3b82f6' },
  { name: 'Baseline', value: 6, color: '#64748b' },
  { name: 'On Hold', value: 3, color: '#ef4444' },
]

const radarData = [
  { skill: 'Manding', A: 85, B: 72 },
  { skill: 'Tacting', A: 92, B: 68 },
  { skill: 'Intraverbal', A: 61, B: 45 },
  { skill: 'Social', A: 55, B: 80 },
  { skill: 'ADL', A: 78, B: 65 },
  { skill: 'Academic', A: 40, B: 55 },
]

export default function ReportsPage() {
  const [selectedClient, setSelectedClient] = useState('all')
  const [dateRange, setDateRange] = useState('30d')

  const totalClients = MOCK_CLIENTS.length
  const totalMastered = MOCK_CLIENTS.reduce((s, c) => s + (c.masteredTargets ?? 0), 0)
  const totalSessions = MOCK_CLIENTS.reduce((s, c) => s + (c.sessionsThisWeek ?? 0), 0)
  const avgProgress = Math.round(MOCK_CLIENTS.reduce((s, c) => s + (c.overallProgress ?? 0), 0) / totalClients)
  const plateauAlerts = Object.values(MOCK_CLIENT_STATS).reduce((s, st) => s + st.plateauAlerts, 0)

  const behaviorTrend = generateBehaviorHistory('Tantrum', 30)
  const accuracyTrend = generateMockTrialHistory('tgt1', 30)

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Reports &{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Analytics</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">Clinical data that tells the real story</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Clients</option>
            {MOCK_CLIENTS.map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </select>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last 12 months</option>
          </select>
          <button className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-xl px-4 py-2 text-sm shadow-lg shadow-cyan-500/30">
            <Download className="w-4 h-4" />
            Export PDF
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Clients', value: totalClients, color: 'text-cyan-400', trend: null },
          { label: 'Sessions/Wk', value: totalSessions, color: 'text-purple-400', trend: 'up' },
          { label: 'Avg Progress', value: `${avgProgress}%`, color: 'text-emerald-400', trend: 'up' },
          { label: 'Targets Mastered', value: totalMastered, color: 'text-amber-400', trend: 'up' },
          { label: 'Plateau Alerts', value: plateauAlerts, color: plateauAlerts > 0 ? 'text-red-400' : 'text-slate-500', trend: 'down' },
        ].map((k) => (
          <motion.div key={k.label} whileHover={{ y: -2 }} className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
              {k.label}
              {k.trend === 'up' && <TrendingUp className="w-3 h-3 text-emerald-400" />}
              {k.trend === 'down' && <TrendingDown className="w-3 h-3 text-red-400" />}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Caseload accuracy trend */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
          <h3 className="font-semibold text-white mb-1">Caseload Accuracy Trend</h3>
          <p className="text-xs text-slate-400 mb-4">% correct across all active targets</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={accuracyTrend}>
              <defs>
                <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94a3b8' }} />
              <Area type="monotone" dataKey="percent" stroke="#22d3ee" strokeWidth={2} fill="url(#ag)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly trials by client */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
          <h3 className="font-semibold text-white mb-1">Weekly Trials by Client</h3>
          <p className="text-xs text-slate-400 mb-4">Trials logged per week</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyTrials}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="marcus" name="Marcus" fill="#22d3ee" radius={[3, 3, 0, 0]} />
              <Bar dataKey="aaliyah" name="Aaliyah" fill="#a855f7" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ethan" name="Ethan" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="sofia" name="Sofia" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Target phase distribution pie */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
          <h3 className="font-semibold text-white mb-1">Target Phase Distribution</h3>
          <p className="text-xs text-slate-400 mb-4">All targets across caseload</p>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={masteryPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                  {masteryPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 flex-shrink-0">
              {masteryPieData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-slate-300">{d.name}</span>
                  <span className="text-slate-500 ml-auto">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Domain mastery bar */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5">
          <h3 className="font-semibold text-white mb-1">Mastery by Domain</h3>
          <p className="text-xs text-slate-400 mb-4">Mastered vs. active targets per skill area</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={domainData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis dataKey="domain" type="category" tick={{ fill: '#94a3b8', fontSize: 11 }} width={70} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="mastered" name="Mastered" fill="#10b981" radius={[0, 4, 4, 0]} stackId="a" />
              <Bar dataKey="active" name="Active" fill="#22d3ee" radius={[0, 4, 4, 0]} stackId="a" />
              <Bar dataKey="baseline" name="Baseline" fill="#475569" radius={[0, 4, 4, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Behavior frequency trend */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5 xl:col-span-2">
          <h3 className="font-semibold text-white mb-1">Behavior Frequency Trends</h3>
          <p className="text-xs text-slate-400 mb-4">30-day behavior frequency across caseload</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={behaviorTrend}>
              <defs>
                <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="count" name="Tantrum" stroke="#a855f7" strokeWidth={2} fill="url(#bg2)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Plateau Alert Cards */}
      {plateauAlerts > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="font-semibold text-amber-300">Plateau Alerts ({plateauAlerts})</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {MOCK_CLIENTS.filter((c) => (MOCK_CLIENT_STATS[c.id]?.plateauAlerts ?? 0) > 0).map((c) => (
              <div key={c.id} className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-sm">
                <div className="font-medium text-white">{c.firstName} {c.lastName}</div>
                <div className="text-xs text-amber-400 mt-0.5">{MOCK_CLIENT_STATS[c.id].plateauAlerts} targets in plateau (5+ days)</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report export options */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: FileText, label: 'Progress Report', desc: 'Full PDF with all charts + narrative', action: 'Generate PDF' },
          { icon: BarChart3, label: 'Data Export', desc: 'Raw trial data as CSV/Excel', action: 'Export CSV' },
          { icon: Share2, label: 'Parent Summary', desc: 'Simplified report for caregivers', action: 'Share Link' },
        ].map((r) => (
          <motion.div key={r.label} whileHover={{ y: -2 }} className="bg-[#0d1117] border border-white/10 rounded-2xl p-4 flex flex-col gap-2">
            <r.icon className="w-5 h-5 text-cyan-400" />
            <div className="font-medium text-white text-sm">{r.label}</div>
            <div className="text-xs text-slate-400 flex-1">{r.desc}</div>
            <button className="text-xs text-cyan-400 font-semibold hover:text-cyan-300 transition-colors text-left">{r.action} →</button>
          </motion.div>
        ))}
      </div>

      {/* AI summary */}
      <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-5 flex items-start gap-3">
        <Brain className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-purple-300 mb-2">AI Summary ✨</div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Caseload is performing at <span className="text-cyan-400 font-bold">{avgProgress}% average mastery</span> this period.
            Aaliyah Rivera shows the strongest growth trajectory at 88% weekly accuracy.
            Marcus Johnson's mand program has 2 plateau alerts — recommend BCBA review of motivation operations before next session block.
            Ethan Kim would benefit from increased session frequency (currently 2×/wk) to accelerate acquisition phase targets.
          </p>
        </div>
      </div>
    </div>
  )
}
