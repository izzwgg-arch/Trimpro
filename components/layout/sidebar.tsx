'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { TrimProLogo } from '@/components/branding/TrimProLogo'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { resetPermissionsCache } from '@/hooks/usePermissions'
import { SIDEBAR_PAGE_MODULE_IDS, getModuleById, getModuleSidebarPermissions } from '@/lib/page-module-permissions'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Calendar,
  FileText,
  DollarSign,
  ShoppingCart,
  CheckSquare,
  AlertCircle,
  Phone,
  MessageSquare,
  Settings,
  HelpCircle,
  LogOut,
  BarChart3,
  FileBarChart,
  Radio,
  Map,
  Mail,
  Package,
  Building2,
  ChevronLeft,
  ChevronRight,
  X,
  History,
  ScrollText,
  Receipt,
} from 'lucide-react'
import { useState, useEffect } from 'react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { name: 'Clients', href: '/dashboard/clients', icon: Users, permission: 'clients.view' },
  { name: 'Requests', href: '/dashboard/requests', icon: Users, permission: 'leads.view' },
  { name: 'Jobs', href: '/dashboard/jobs', icon: Briefcase, permission: 'jobs.view' },
  { name: 'Schedule', href: '/dashboard/schedule', icon: Calendar, permission: 'schedule.view' },
  { name: 'Estimates', href: '/dashboard/estimates', icon: FileText, permission: 'estimates.view' },
  { name: 'Invoices', href: '/dashboard/invoices', icon: DollarSign, permission: 'invoices.view' },
  { name: 'Credit Memos', href: '/dashboard/credit-memos', icon: Receipt, permission: 'invoices.view' },
  { name: 'Purchase Orders', href: '/dashboard/purchase-orders', icon: ShoppingCart, permission: 'purchase_orders.view' },
  { name: 'Items', href: '/dashboard/items', icon: Package, permission: 'settings.view' },
  { name: 'Vendors', href: '/dashboard/vendors', icon: Building2, permission: 'purchase_orders.view' },
  { name: 'Tasks', href: '/dashboard/tasks', icon: CheckSquare, permission: 'tasks.view' },
  { name: 'Issues', href: '/dashboard/issues', icon: AlertCircle, permission: 'issues.view' },
  { name: 'Teams', href: '/dashboard/teams', icon: Users, permission: 'teams.view' },
  { name: 'Calls', href: '/dashboard/calls', icon: Phone, permission: 'calls.view' },
  { name: 'Messages', href: '/dashboard/messages', icon: MessageSquare, permission: 'messages.view' },
  { name: 'Email', href: '/dashboard/email', icon: Mail, permission: 'messages.view' },
  { name: 'Maps', href: '/dashboard/maps', icon: Map, permission: 'jobs.view' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, permission: 'analytics.view' },
  { name: 'Reports', href: '/dashboard/reports', icon: FileBarChart, permission: 'reports.view' },
  { name: 'Payment History', href: '/dashboard/reports/payments', icon: History, permission: 'payments.view' },
  { name: 'Dispatch', href: '/dashboard/dispatch', icon: Radio, permission: 'dispatch.view' },
  { name: 'Audit Logs', href: '/dashboard/audit-logs', icon: ScrollText, permission: 'audit_logs.access' },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings, permission: 'settings.view' },
  { name: 'Help', href: '/dashboard/help', icon: HelpCircle, permission: 'dashboard.view' },
]

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Persist collapse state across sessions
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar-collapsed', String(!prev))
      return !prev
    })
  }

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    }
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    resetPermissionsCache()
    window.location.href = '/auth/login'
  }

  const sidebarContent = (
    <div
      className={cn(
        'flex h-full flex-col text-white transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
      style={{ backgroundColor: 'var(--brand-sidebar-color)' }}
    >
      {/* Header */}
      <div
        className="flex h-16 flex-shrink-0 items-center justify-between border-b px-3"
        style={{ borderColor: 'var(--brand-sidebar-border-color)' }}
      >
        {!collapsed && (
          <Link
            href="/dashboard"
            aria-label="Go to dashboard"
            className="inline-flex h-full min-h-0 min-w-0 flex-1 items-center justify-start pr-2"
          >
            <TrimProLogo variant="sidebar" size="md" />
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" aria-label="Go to dashboard" className="flex flex-1 items-center justify-center">
            <TrimProLogo variant="sidebar" size="sm" />
          </Link>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {!collapsed && <NotificationBell />}
          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex items-center justify-center h-7 w-7 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          {/* Mobile close button */}
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="flex lg:hidden items-center justify-center min-h-[44px] min-w-[44px] h-11 w-11 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto space-y-0.5 px-2 py-4 min-h-0">
        {navigation.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname?.startsWith(item.href + '/')
          const navItem = (
            <Link
              key={item.name}
              href={item.href}
              onClick={onMobileClose}
              title={collapsed ? item.name : undefined}
              className={cn(
                'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 !bg-transparent hover:!bg-transparent active:!bg-transparent focus:!bg-transparent',
                collapsed ? 'justify-center' : '',
                isActive ? 'text-[var(--brand-menu-color)]' : 'text-white hover:text-[var(--brand-menu-color)]'
              )}
            >
              <item.icon className={cn('h-5 w-5 flex-shrink-0', !collapsed && 'mr-3')} />
              {!collapsed && item.name}
            </Link>
          )

          if (item.permission) {
            const moduleId = SIDEBAR_PAGE_MODULE_IDS[item.name]
            const module = moduleId ? getModuleById(moduleId) : undefined
            const sidebarPermissions = module
              ? getModuleSidebarPermissions(module)
              : [item.permission]

            return (
              <PermissionGuard key={item.name} permissions={sidebarPermissions}>
                {navItem}
              </PermissionGuard>
            )
          }

          return navItem
        })}
      </nav>

      {/* Footer */}
      <div
        className="flex-shrink-0 border-t p-3"
        style={{ borderColor: 'var(--brand-sidebar-border-color)' }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <NotificationBell />
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center justify-center h-8 w-8 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-white transition-colors duration-200 ease-in-out !bg-transparent hover:!bg-transparent hover:text-[var(--brand-menu-color)]"
          >
            <LogOut className="mr-3 h-5 w-5" />
            Logout
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar — always in flow */}
      <div className="hidden lg:flex h-full">
        {sidebarContent}
      </div>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          {/* Drawer — always full width on mobile */}
          <div className="relative flex h-full w-[min(100vw,16rem)] max-w-[85vw] flex-col text-white shadow-xl"
            style={{ backgroundColor: 'var(--brand-sidebar-color)' }}
          >
            <div
              className="flex h-16 flex-shrink-0 items-center justify-between border-b px-4"
              style={{ borderColor: 'var(--brand-sidebar-border-color)' }}
            >
              <Link href="/dashboard" aria-label="Go to dashboard" className="inline-flex h-full flex-1 items-center justify-start pr-2" onClick={onMobileClose}>
                <TrimProLogo variant="sidebar" size="md" />
              </Link>
              <div className="flex items-center gap-1">
                <NotificationBell />
                <button
                  onClick={onMobileClose}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto space-y-0.5 px-2 py-4">
              {navigation.map((item) => {
                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname === item.href || pathname?.startsWith(item.href + '/')
                const navItem = (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={onMobileClose}
                    className={cn(
                      'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 !bg-transparent hover:!bg-transparent',
                      isActive ? 'text-[var(--brand-menu-color)]' : 'text-white hover:text-[var(--brand-menu-color)]'
                    )}
                  >
                    <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
                    {item.name}
                  </Link>
                )
                if (item.permission) {
                  const moduleId = SIDEBAR_PAGE_MODULE_IDS[item.name]
                  const module = moduleId ? getModuleById(moduleId) : undefined
                  const sidebarPermissions = module
                    ? getModuleSidebarPermissions(module)
                    : [item.permission]

                  return (
                    <PermissionGuard key={item.name} permissions={sidebarPermissions}>
                      {navItem}
                    </PermissionGuard>
                  )
                }
                return navItem
              })}
            </nav>
            <div className="flex-shrink-0 border-t p-4" style={{ borderColor: 'var(--brand-sidebar-border-color)' }}>
              <button
                onClick={handleLogout}
                className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-white !bg-transparent hover:!bg-transparent hover:text-[var(--brand-menu-color)]"
              >
                <LogOut className="mr-3 h-5 w-5" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
