'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
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
  ChevronRight,
  BarChart3,
  FileBarChart,
  Radio,
  Map,
  Mail,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { name: 'Clients', href: '/dashboard/clients', icon: Users, permission: 'clients.view' },
  { name: 'Requests', href: '/dashboard/requests', icon: Users, permission: 'leads.view' },
  { name: 'Jobs', href: '/dashboard/jobs', icon: Briefcase, permission: 'jobs.view' },
  { name: 'Schedule', href: '/dashboard/schedule', icon: Calendar, permission: 'schedule.view' },
  { name: 'Estimates', href: '/dashboard/estimates', icon: FileText, permission: 'estimates.view' },
  { name: 'Invoices', href: '/dashboard/invoices', icon: DollarSign, permission: 'invoices.view' },
  { name: 'Purchase Orders', href: '/dashboard/purchase-orders', icon: ShoppingCart, permission: 'purchaseOrders.view' },
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
    <div className="flex h-screen w-64 flex-col bg-gray-900 text-white">
      <div className="flex h-16 items-center justify-between px-4 border-b border-gray-800">
        <h1 className="text-xl font-bold">Trim Pro</h1>
        <NotificationBell />
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
          const navItem = (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.name}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
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
      <div className="border-t border-gray-800 p-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          <LogOut className="mr-3 h-5 w-5" />
          Logout
        </button>
      </div>
    </div>
  )
}
