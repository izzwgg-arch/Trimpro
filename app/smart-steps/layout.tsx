'use client'
// ─── Smart Steps Layout — The frame that holds this masterpiece ───────────────
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, BarChart3, Settings, ChevronLeft, ChevronRight,
  Wifi, WifiOff, Clock, Bell, LogOut, Zap, Brain, Menu, X,
} from 'lucide-react'
import { useSmartStepsStore } from '@/lib/smart-steps/store'

const NAV_ITEMS = [
  { href: '/smart-steps', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/smart-steps/clients', label: 'Clients', icon: Users },
  { href: '/smart-steps/reports', label: 'Reports', icon: BarChart3 },
  { href: '/smart-steps/settings', label: 'Settings', icon: Settings },
]

export default function SmartStepsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isOnline, setOnline, pendingSyncCount, sidebarCollapsed, toggleSidebar } = useSmartStepsStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sessionTime, setSessionTime] = useState<string | null>(null)
  const { activeSession } = useSmartStepsStore()

  // Auth guard
  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) router.push('/auth/login')
  }, [router])

  // Online/offline detector
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [setOnline])

  // Live session timer
  useEffect(() => {
    if (!activeSession) { setSessionTime(null); return }
    const tick = () => {
      const elapsed = Date.now() - activeSession.startTime - activeSession.pausedMs
      const m = Math.floor(elapsed / 60000)
      const s = Math.floor((elapsed % 60000) / 1000)
      setSessionTime(`${m}:${s.toString().padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activeSession])

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href) && href !== '/smart-steps'
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo / Brand */}
      <div className={`flex items-center gap-3 p-4 border-b border-white/10 ${sidebarCollapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-cyan-500/30">
          <Brain className="w-5 h-5 text-white" />
        </div>
        {!sidebarCollapsed && (
          <div>
            <div className="font-bold text-white text-sm leading-tight">Smart Steps</div>
            <div className="text-[10px] text-cyan-400 font-medium tracking-wider uppercase">ABA Tracker</div>
          </div>
        )}
      </div>

      {/* Online / Sync Status */}
      {!sidebarCollapsed && (
        <div className="px-3 pt-3 pb-1">
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isOnline ? 'Online' : 'Offline Mode'}
            {pendingSyncCount > 0 && (
              <span className="ml-auto bg-amber-500 text-black rounded-full text-[10px] font-bold px-1.5 py-0.5">
                {pendingSyncCount}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Active Session Banner */}
      {activeSession && sessionTime && (
        <div className="mx-3 mt-2">
          <Link href={`/smart-steps/${activeSession.clientId}/session/active`}>
            <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl px-3 py-2 hover:bg-cyan-500/20 transition-all cursor-pointer">
              <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <div className="text-xs text-cyan-300 font-medium">Session Active</div>
                  <div className="ml-auto text-xs font-mono text-cyan-400 font-bold">{sessionTime}</div>
                </>
              )}
            </div>
          </Link>
        </div>
      )}

      {/* Nav Items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href, item.exact) || (item.exact && pathname === item.href)
          const exactActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}>
              <motion.div
                whileHover={{ x: 2 }}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all min-h-[44px] ${
                  exactActive
                    ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                } ${sidebarCollapsed ? 'justify-center' : ''}`}
              >
                <item.icon className={`w-5 h-5 flex-shrink-0 ${exactActive ? 'text-cyan-400' : ''}`} />
                {!sidebarCollapsed && <span>{item.label}</span>}
                {exactActive && !sidebarCollapsed && (
                  <div className="ml-auto w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                )}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* Bottom: collapse toggle + logout */}
      <div className="p-3 border-t border-white/10 space-y-1">
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-all"
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!sidebarCollapsed && <span>Collapse</span>}
        </button>
        <Link href="/dashboard">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer">
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Back to TrimPro</span>}
          </div>
        </Link>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-[#080b14] text-white overflow-hidden">
      {/* Desktop Sidebar */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 64 : 240 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="hidden md:flex flex-col h-full border-r border-white/10 bg-[#0d1117] flex-shrink-0 overflow-hidden"
      >
        <SidebarContent />
      </motion.aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 h-full w-72 bg-[#0d1117] border-r border-white/10 z-50 md:hidden"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0d1117]/80 backdrop-blur-md flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* Breadcrumb / Title derived from path */}
            <div className="text-sm text-slate-400 font-medium hidden sm:block">
              {pathname === '/smart-steps' && 'Dashboard'}
              {pathname.includes('/session/active') && '🔴 Live Session'}
              {pathname.includes('/programs') && 'Programs & Targets'}
              {pathname === '/smart-steps/reports' && 'Reports & Analytics'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingSyncCount > 0 && (
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full px-2.5 py-1 text-xs text-amber-400 font-medium"
              >
                <Zap className="w-3 h-3" />
                {pendingSyncCount} pending
              </motion.div>
            )}
            {!isOnline && (
              <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 rounded-full px-2.5 py-1 text-xs text-red-400 font-medium">
                <WifiOff className="w-3 h-3" />
                Offline
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  )
}
