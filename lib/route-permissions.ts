/**
 * Centralized dashboard route → permission mapping.
 * More specific prefixes must appear before broader ones.
 */

export interface RoutePermissionRule {
  prefix: string
  /** Single permission or any-of list */
  permission: string | string[]
}

export const ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
  { prefix: '/dashboard/settings/roles', permission: 'roles.view' },
  { prefix: '/dashboard/settings/integrations', permission: ['settings.view', 'system.integrations'] },
  { prefix: '/dashboard/settings/branding', permission: 'settings.edit' },
  { prefix: '/dashboard/settings/email-integrations', permission: ['settings.view', 'system.integrations'] },
  { prefix: '/dashboard/settings', permission: 'settings.view' },
  { prefix: '/dashboard/clients', permission: 'clients.view' },
  { prefix: '/dashboard/requests', permission: 'leads.view' },
  { prefix: '/dashboard/leads', permission: 'leads.view' },
  { prefix: '/dashboard/measuring-requests', permission: 'leads.view' },
  { prefix: '/dashboard/jobs', permission: 'jobs.view' },
  { prefix: '/dashboard/schedule', permission: 'schedule.view' },
  { prefix: '/dashboard/estimates', permission: 'estimates.view' },
  { prefix: '/dashboard/invoices', permission: 'invoices.view' },
  { prefix: '/dashboard/purchase-orders', permission: 'purchase_orders.view' },
  { prefix: '/dashboard/items', permission: 'settings.view' },
  { prefix: '/dashboard/vendors', permission: 'purchase_orders.view' },
  { prefix: '/dashboard/tasks', permission: 'tasks.view' },
  { prefix: '/dashboard/issues', permission: 'issues.view' },
  { prefix: '/dashboard/teams', permission: 'teams.view' },
  { prefix: '/dashboard/calls', permission: 'calls.view' },
  { prefix: '/dashboard/messages', permission: 'messages.view' },
  { prefix: '/dashboard/email', permission: 'messages.view' },
  { prefix: '/dashboard/maps', permission: 'jobs.view' },
  { prefix: '/dashboard/analytics', permission: 'analytics.view' },
  { prefix: '/dashboard/reports', permission: 'reports.view' },
  { prefix: '/dashboard/dispatch', permission: 'dispatch.view' },
  { prefix: '/dashboard/help/new', permission: 'settings.edit' },
  { prefix: '/dashboard/help', permission: 'dashboard.view' },
  { prefix: '/dashboard/notifications', permission: 'dashboard.view' },
  { prefix: '/dashboard', permission: 'dashboard.view' },
]

/**
 * Resolve the required permission(s) for a dashboard pathname.
 * Returns null when the path is not a protected dashboard route.
 */
export function getRoutePermission(pathname: string): string | string[] | null {
  if (!pathname.startsWith('/dashboard')) {
    return null
  }

  for (const rule of ROUTE_PERMISSION_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule.permission
    }
  }

  return 'dashboard.view'
}
