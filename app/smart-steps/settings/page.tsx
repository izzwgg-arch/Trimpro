'use client'
import { motion } from 'framer-motion'
import { Settings, Bell, Shield, Users, Palette, Database, Download, Zap } from 'lucide-react'

const SETTING_SECTIONS = [
  {
    title: 'Account & Roles',
    icon: Users,
    color: 'text-cyan-400',
    items: [
      { label: 'Your Role', value: 'BCBA', type: 'badge' },
      { label: 'Therapists on caseload', value: '3', type: 'badge' },
      { label: 'Client assignments', value: 'Manage →', type: 'link' },
    ],
  },
  {
    title: 'Notifications',
    icon: Bell,
    color: 'text-purple-400',
    items: [
      { label: 'Mastery milestone alerts', value: true, type: 'toggle' },
      { label: 'Plateau alerts (5+ days)', value: true, type: 'toggle' },
      { label: 'Session completion summary', value: false, type: 'toggle' },
    ],
  },
  {
    title: 'Data & Sync',
    icon: Database,
    color: 'text-emerald-400',
    items: [
      { label: 'Auto-sync on WiFi', value: true, type: 'toggle' },
      { label: 'Sync on cellular', value: false, type: 'toggle' },
      { label: 'Offline data stored', value: '2.4 MB', type: 'badge' },
    ],
  },
  {
    title: 'Session Defaults',
    icon: Zap,
    color: 'text-amber-400',
    items: [
      { label: 'Vibration on trial entry', value: true, type: 'toggle' },
      { label: 'Auto-advance targets', value: true, type: 'toggle' },
      { label: 'Voice commands', value: false, type: 'toggle' },
    ],
  },
]

export default function SettingsPage() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Configure Smart Steps for your workflow</p>
      </div>

      {SETTING_SECTIONS.map((section) => (
        <div key={section.title} className="bg-[#0d1117] border border-white/10 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
            <section.icon className={`w-4 h-4 ${section.color}`} />
            <h2 className="font-semibold text-white text-sm">{section.title}</h2>
          </div>
          <div className="divide-y divide-white/5">
            {section.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm text-slate-300">{item.label}</span>
                {item.type === 'toggle' && (
                  <div className={`w-10 h-5 rounded-full transition-all cursor-pointer flex items-center ${item.value ? 'bg-cyan-500 justify-end' : 'bg-white/10 justify-start'}`}>
                    <div className="w-4 h-4 bg-white rounded-full mx-0.5 shadow" />
                  </div>
                )}
                {item.type === 'badge' && (
                  <span className="text-xs bg-white/10 text-slate-300 px-2.5 py-1 rounded-full">{item.value}</span>
                )}
                {item.type === 'link' && (
                  <span className="text-xs text-cyan-400 cursor-pointer hover:text-cyan-300">{item.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5 flex items-center justify-between">
        <div>
          <div className="font-medium text-white text-sm">Export All Data</div>
          <div className="text-xs text-slate-400 mt-0.5">Download complete clinical data archive</div>
        </div>
        <button className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 text-sm text-white transition-all">
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      <div className="text-center text-xs text-slate-600 pb-4">
        Smart Steps ABA Tracker v2026.1.0 — Built for RBTs & BCBAs who demand excellence
      </div>
    </div>
  )
}
