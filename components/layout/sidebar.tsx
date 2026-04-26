'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { TrimProLogo } from '@/components/branding/TrimProLogo'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
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
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { name: 'Clients', href: '/dashboard/clients', icon: Users, permission: 'clients.view' },
  { name: 'Requests', href: '/dashboard/requests', icon: Users, permission: 'leads.view' },
  { name: 'Jobs', href: '/dashboard/jobs', icon: Briefcase, permission: 'jobs.view' },
  { name: 'Schedule', href: '/dashboard/schedule', icon: Calendar, permission: 'schedule.view' },
  { name: 'Estimates', href: '/dashboard/estimates', icon: FileText, permission: 'estimates.view' },
  { name: 'Invoices', href: '/dashboard/invoices', icon: DollarSign, permission: 'invoices.view' },
  { name: 'Purchase Orders', href: '/dashboard/purchase-orders', icon: ShoppingCart },
  { name: 'Items', href: '/dashboard/items', icon: Package },
  { name: 'Vendors', href: '/dashboard/vendors', icon: Building2 },
  { name: 'Tasks', href: '/dashboard/tasks', icon: CheckSquare, permission: 'tasks.view' },
  { name: 'Issues', href: '/dashboard/issues', icon: AlertCircle, permission: 'issues.view' },
  { name: 'Teams', href: '/dashboard/teams', icon: Users, permission: 'teams.view' },
  { name: 'Calls', href: '/dashboard/calls', icon: Phone, permission: 'calls.view' },
  { name: 'Messages', href: '/dashboard/messages', icon: MessageSquare, permission: 'messages.view' },
  { name: 'Email', href: '/dashboard/email', icon: Mail },
  { name: 'Maps', href: '/dashboard/maps', icon: Map },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, permission: 'analytics.view' },
  { name: 'Reports', href: '/dashboard/reports', icon: FileBarChart, permission: 'reports.view' },
  { name: 'Dispatch', href: '/dashboard/dispatch', icon: Radio, permission: 'dispatch.view' },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings, permission: 'settings.view' },
  { name: 'Help', href: '/dashboard/help', icon: HelpCircle },
]

export function Sidebar() {
  const pathname = usePathname()

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
    window.location.href = '/auth/login'
  }

  return (
    <div
      className="flex h-full w-64 flex-col text-white"
      style={{ backgroundColor: 'var(--brand-sidebar-color)' }}
    >
      <div
        className="flex h-16 flex-shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: 'var(--brand-sidebar-border-color)' }}
      >
        <Link
          href="/dashboard"
          aria-label="Go to dashboard"
          className="inline-flex h-full min-h-0 min-w-0 flex-1 items-center justify-start pr-2"
        >
          <TrimProLogo variant="sidebar" size="md" />
        </Link>
        <NotificationBell />
      </div>
      <nav className="flex-1 overflow-y-auto space-y-1 px-2 py-4 min-h-0">
        {navigation.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname?.startsWith(item.href + '/')
          const navItem = (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ease-in-out !bg-transparent hover:!bg-transparent active:!bg-transparent focus:!bg-transparent',
                isActive ? 'text-[var(--brand-menu-color)]' : 'text-white hover:text-[var(--brand-menu-color)]'
              )}
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.name}
            </Link>
          )

          // If permission required, wrap in PermissionGuard
          if (item.permission) {
            return (
              <PermissionGuard key={item.name} permission={item.permission}>
                {navItem}
              </PermissionGuard>
            )
          }

          return navItem
        })}
      </nav>
      <div
        className="flex-shrink-0 border-t p-4"
        style={{ borderColor: 'var(--brand-sidebar-border-color)' }}
      >
        <button
          onClick={handleLogout}
          className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-white transition-colors duration-200 ease-in-out !bg-transparent hover:!bg-transparent hover:text-[var(--brand-menu-color)]"
        >
          <LogOut className="mr-3 h-5 w-5" />
          Logout
        </button>
      </div>
    </div>
  )
}
