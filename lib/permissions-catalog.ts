/**
 * Comprehensive Permission Catalog
 * All granular permissions for the Trim Pro platform
 */

export interface PermissionDefinition {
  key: string
  label: string
  description: string
  category: string
  module: string
}

export const PERMISSIONS: PermissionDefinition[] = [
  // ============================================
  // DASHBOARD
  // ============================================
  {
    key: 'dashboard.view',
    label: 'View Dashboard',
    description: 'Access the main dashboard',
    category: 'Dashboard',
    module: 'dashboard',
  },

  // ============================================
  // CLIENTS
  // ============================================
  {
    key: 'clients.view',
    label: 'View Clients',
    description: 'View client list and details',
    category: 'Clients',
    module: 'clients',
  },
  {
    key: 'clients.create',
    label: 'Create Clients',
    description: 'Create new client records',
    category: 'Clients',
    module: 'clients',
  },
  {
    key: 'clients.edit',
    label: 'Edit Clients',
    description: 'Edit existing client records',
    category: 'Clients',
    module: 'clients',
  },
  {
    key: 'clients.delete',
    label: 'Delete Clients',
    description: 'Delete client records',
    category: 'Clients',
    module: 'clients',
  },
  {
    key: 'clients.export',
    label: 'Export Clients',
    description: 'Export client data',
    category: 'Clients',
    module: 'clients',
  },

  // ============================================
  // LEADS
  // ============================================
  {
    key: 'leads.view',
    label: 'View Leads',
    description: 'View lead list and details',
    category: 'Leads',
    module: 'leads',
  },
  {
    key: 'leads.create',
    label: 'Create Leads',
    description: 'Create new lead records',
    category: 'Leads',
    module: 'leads',
  },
  {
    key: 'leads.edit',
    label: 'Edit Leads',
    description: 'Edit existing lead records',
    category: 'Leads',
    module: 'leads',
  },
  {
    key: 'leads.delete',
    label: 'Delete Leads',
    description: 'Delete lead records',
    category: 'Leads',
    module: 'leads',
  },
  {
    key: 'leads.convert',
    label: 'Convert Leads',
    description: 'Convert leads to clients',
    category: 'Leads',
    module: 'leads',
  },
  {
    key: 'leads.export',
    label: 'Export Leads',
    description: 'Export lead data',
    category: 'Leads',
    module: 'leads',
  },

  // ============================================
  // JOBS
  // ============================================
  {
    key: 'jobs.view',
    label: 'View Jobs',
    description: 'View job list and details',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.create',
    label: 'Create Jobs',
    description: 'Create new job records',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.edit',
    label: 'Edit Jobs',
    description: 'Edit existing job records',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.delete',
    label: 'Delete Jobs',
    description: 'Delete job records',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.assign',
    label: 'Assign Jobs',
    description: 'Assign jobs to technicians',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.reassign',
    label: 'Reassign Jobs',
    description: 'Reassign jobs to different technicians',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.change_status',
    label: 'Change Job Status',
    description: 'Update job status',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.add_notes',
    label: 'Add Job Notes',
    description: 'Add notes to jobs',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.upload_files',
    label: 'Upload Job Files',
    description: 'Upload files to jobs',
    category: 'Jobs',
    module: 'jobs',
  },
  {
    key: 'jobs.export',
    label: 'Export Jobs',
    description: 'Export job data',
    category: 'Jobs',
    module: 'jobs',
  },

  // ============================================
  // SCHEDULE / CALENDAR
  // ============================================
  {
    key: 'schedule.view',
    label: 'View Schedule',
    description: 'View calendar and schedule',
    category: 'Schedule',
    module: 'schedule',
  },
  {
    key: 'schedule.create',
    label: 'Create Schedule',
    description: 'Create schedule entries',
    category: 'Schedule',
    module: 'schedule',
  },
  {
    key: 'schedule.edit',
    label: 'Edit Schedule',
    description: 'Edit schedule entries',
    category: 'Schedule',
    module: 'schedule',
  },
  {
    key: 'schedule.delete',
    label: 'Delete Schedule',
    description: 'Delete schedule entries',
    category: 'Schedule',
    module: 'schedule',
  },
  {
    key: 'schedule.dispatch',
    label: 'Dispatch Schedule',
    description: 'Dispatch jobs from schedule',
    category: 'Schedule',
    module: 'schedule',
  },
  {
    key: 'schedule.reschedule',
    label: 'Reschedule',
    description: 'Reschedule jobs',
    category: 'Schedule',
    module: 'schedule',
  },

  // ============================================
  // ESTIMATES
  // ============================================
  {
    key: 'estimates.view',
    label: 'View Estimates',
    description: 'View estimate list and details',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.create',
    label: 'Create Estimates',
    description: 'Create new estimates',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.edit',
    label: 'Edit Estimates',
    description: 'Edit existing estimates',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.delete',
    label: 'Delete Estimates',
    description: 'Delete estimates',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.send',
    label: 'Send Estimates',
    description: 'Send estimates to clients',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.approve',
    label: 'Approve Estimates',
    description: 'Approve estimates',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.convert',
    label: 'Convert Estimates',
    description: 'Convert estimates to jobs/invoices',
    category: 'Estimates',
    module: 'estimates',
  },
  {
    key: 'estimates.export',
    label: 'Export Estimates',
    description: 'Export estimate data',
    category: 'Estimates',
    module: 'estimates',
  },

  // ============================================
  // INVOICES
  // ============================================
  {
    key: 'invoices.view',
    label: 'View Invoices',
    description: 'View invoice list and details',
    category: 'Invoices',
    module: 'invoices',
  },
  {
    key: 'invoices.create',
    label: 'Create Invoices',
    description: 'Create new invoices',
    category: 'Invoices',
    module: 'invoices',
  },
  {
    key: 'invoices.edit',
    label: 'Edit Invoices',
    description: 'Edit existing invoices',
    category: 'Invoices',
    module: 'invoices',
  },
  {
    key: 'invoices.delete',
    label: 'Delete Invoices',
    description: 'Delete invoices',
    category: 'Invoices',
    module: 'invoices',
  },
  {
    key: 'invoices.send',
    label: 'Send Invoices',
    description: 'Send invoices to clients',
    category: 'Invoices',
    module: 'invoices',
  },
  {
    key: 'invoices.refund',
    label: 'Refund Invoices',
    description: 'Process invoice refunds',
    category: 'Invoices',
    module: 'invoices',
  },
  {
    key: 'invoices.export',
    label: 'Export Invoices',
    description: 'Export invoice data',
    category: 'Invoices',
    module: 'invoices',
  },

  // ============================================
  // PURCHASE ORDERS
  // ============================================
  {
    key: 'purchase_orders.view',
    label: 'View Purchase Orders',
    description: 'View purchase order list and details',
    category: 'Purchase Orders',
    module: 'purchase_orders',
  },
  {
    key: 'purchase_orders.create',
    label: 'Create Purchase Orders',
    description: 'Create new purchase orders',
    category: 'Purchase Orders',
    module: 'purchase_orders',
  },
  {
    key: 'purchase_orders.edit',
    label: 'Edit Purchase Orders',
    description: 'Edit existing purchase orders',
    category: 'Purchase Orders',
    module: 'purchase_orders',
  },
  {
    key: 'purchase_orders.delete',
    label: 'Delete Purchase Orders',
    description: 'Delete purchase orders',
    category: 'Purchase Orders',
    module: 'purchase_orders',
  },
  {
    key: 'purchase_orders.approve',
    label: 'Approve Purchase Orders',
    description: 'Approve purchase orders',
    category: 'Purchase Orders',
    module: 'purchase_orders',
  },
  {
    key: 'purchase_orders.export',
    label: 'Export Purchase Orders',
    description: 'Export purchase order data',
    category: 'Purchase Orders',
    module: 'purchase_orders',
  },

  // ============================================
  // TASKS
  // ============================================
  {
    key: 'tasks.view',
    label: 'View Tasks',
    description: 'View task list and details',
    category: 'Tasks',
    module: 'tasks',
  },
  {
    key: 'tasks.create',
    label: 'Create Tasks',
    description: 'Create new tasks',
    category: 'Tasks',
    module: 'tasks',
  },
  {
    key: 'tasks.edit',
    label: 'Edit Tasks',
    description: 'Edit existing tasks',
    category: 'Tasks',
    module: 'tasks',
  },
  {
    key: 'tasks.delete',
    label: 'Delete Tasks',
    description: 'Delete tasks',
    category: 'Tasks',
    module: 'tasks',
  },
  {
    key: 'tasks.assign',
    label: 'Assign Tasks',
    description: 'Assign tasks to users',
    category: 'Tasks',
    module: 'tasks',
  },
  {
    key: 'tasks.complete',
    label: 'Complete Tasks',
    description: 'Mark tasks as complete',
    category: 'Tasks',
    module: 'tasks',
  },

  // ============================================
  // ISSUES
  // ============================================
  {
    key: 'issues.view',
    label: 'View Issues',
    description: 'View issue list and details',
    category: 'Issues',
    module: 'issues',
  },
  {
    key: 'issues.create',
    label: 'Create Issues',
    description: 'Create new issues/tickets',
    category: 'Issues',
    module: 'issues',
  },
  {
    key: 'issues.edit',
    label: 'Edit Issues',
    description: 'Edit existing issues',
    category: 'Issues',
    module: 'issues',
  },
  {
    key: 'issues.delete',
    label: 'Delete Issues',
    description: 'Delete issues',
    category: 'Issues',
    module: 'issues',
  },
  {
    key: 'issues.assign',
    label: 'Assign Issues',
    description: 'Assign issues to users',
    category: 'Issues',
    module: 'issues',
  },
  {
    key: 'issues.close',
    label: 'Close Issues',
    description: 'Close/resolve issues',
    category: 'Issues',
    module: 'issues',
  },

  // ============================================
  // TEAMS
  // ============================================
  {
    key: 'teams.view',
    label: 'View Teams',
    description: 'View team list and details',
    category: 'Teams',
    module: 'teams',
  },
  {
    key: 'teams.create',
    label: 'Create Teams',
    description: 'Create new teams',
    category: 'Teams',
    module: 'teams',
  },
  {
    key: 'teams.edit',
    label: 'Edit Teams',
    description: 'Edit existing teams',
    category: 'Teams',
    module: 'teams',
  },
  {
    key: 'teams.delete',
    label: 'Delete Teams',
    description: 'Delete teams',
    category: 'Teams',
    module: 'teams',
  },
  {
    key: 'teams.add_members',
    label: 'Add Team Members',
    description: 'Add members to teams',
    category: 'Teams',
    module: 'teams',
  },
  {
    key: 'teams.remove_members',
    label: 'Remove Team Members',
    description: 'Remove members from teams',
    category: 'Teams',
    module: 'teams',
  },

  // ============================================
  // CALLS
  // ============================================
  {
    key: 'calls.view',
    label: 'View Calls',
    description: 'View call logs',
    category: 'Communication',
    module: 'calls',
  },
  {
    key: 'calls.send',
    label: 'Make Calls',
    description: 'Make phone calls',
    category: 'Communication',
    module: 'calls',
  },
  {
    key: 'calls.delete',
    label: 'Delete Calls',
    description: 'Delete call records',
    category: 'Communication',
    module: 'calls',
  },
  {
    key: 'calls.export',
    label: 'Export Calls',
    description: 'Export call data',
    category: 'Communication',
    module: 'calls',
  },

  // ============================================
  // MESSAGES (SMS/Email)
  // ============================================
  {
    key: 'messages.view',
    label: 'View Messages',
    description: 'View SMS and email messages',
    category: 'Communication',
    module: 'messages',
  },
  {
    key: 'messages.send',
    label: 'Send Messages',
    description: 'Send SMS and email messages',
    category: 'Communication',
    module: 'messages',
  },
  {
    key: 'messages.delete',
    label: 'Delete Messages',
    description: 'Delete message records',
    category: 'Communication',
    module: 'messages',
  },
  {
    key: 'messages.export',
    label: 'Export Messages',
    description: 'Export message data',
    category: 'Communication',
    module: 'messages',
  },
  {
    key: 'messaging.sms',
    label: 'Send SMS',
    description: 'Send SMS messages via VoIP.ms',
    category: 'Communication',
    module: 'messaging',
  },
  {
    key: 'messaging.whatsapp',
    label: 'Send WhatsApp',
    description: 'Send WhatsApp messages',
    category: 'Communication',
    module: 'messaging',
  },
  {
    key: 'messaging.email',
    label: 'Send Email',
    description: 'Send email messages',
    category: 'Communication',
    module: 'messaging',
  },
  {
    key: 'integrations.manage',
    label: 'Manage Integrations',
    description: 'Configure and manage integrations',
    category: 'Settings',
    module: 'integrations',
  },

  // ============================================
  // SETTINGS
  // ============================================
  {
    key: 'settings.view',
    label: 'View Settings',
    description: 'View system settings',
    category: 'Settings',
    module: 'settings',
  },
  {
    key: 'settings.edit',
    label: 'Edit Settings',
    description: 'Edit system settings',
    category: 'Settings',
    module: 'settings',
  },

  // ============================================
  // USERS
  // ============================================
  {
    key: 'users.view',
    label: 'View Users',
    description: 'View user list and details',
    category: 'Users',
    module: 'users',
  },
  {
    key: 'users.create',
    label: 'Create Users',
    description: 'Create new user accounts',
    category: 'Users',
    module: 'users',
  },
  {
    key: 'users.edit',
    label: 'Edit Users',
    description: 'Edit existing user accounts',
    category: 'Users',
    module: 'users',
  },
  {
    key: 'users.deactivate',
    label: 'Deactivate Users',
    description: 'Deactivate user accounts',
    category: 'Users',
    module: 'users',
  },
  {
    key: 'users.reset_password',
    label: 'Reset User Passwords',
    description: 'Reset user passwords',
    category: 'Users',
    module: 'users',
  },

  // ============================================
  // ROLES
  // ============================================
  {
    key: 'roles.view',
    label: 'View Roles',
    description: 'View role list and details',
    category: 'Roles',
    module: 'roles',
  },
  {
    key: 'roles.create',
    label: 'Create Roles',
    description: 'Create new custom roles',
    category: 'Roles',
    module: 'roles',
  },
  {
    key: 'roles.edit',
    label: 'Edit Roles',
    description: 'Edit existing roles',
    category: 'Roles',
    module: 'roles',
  },
  {
    key: 'roles.delete',
    label: 'Delete Roles',
    description: 'Delete custom roles',
    category: 'Roles',
    module: 'roles',
  },
  {
    key: 'roles.assign',
    label: 'Assign Roles',
    description: 'Assign roles to users',
    category: 'Roles',
    module: 'roles',
  },

  // ============================================
  // ANALYTICS
  // ============================================
  {
    key: 'analytics.view',
    label: 'View Analytics',
    description: 'Access analytics dashboards',
    category: 'Analytics',
    module: 'analytics',
  },

  // ============================================
  // REPORTS
  // ============================================
  {
    key: 'reports.view',
    label: 'View Reports',
    description: 'View report list and details',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.create',
    label: 'Create Reports',
    description: 'Create new custom reports',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.edit',
    label: 'Edit Reports',
    description: 'Edit existing reports',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.delete',
    label: 'Delete Reports',
    description: 'Delete reports',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.run',
    label: 'Run Reports',
    description: 'Execute and view report results',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.schedule',
    label: 'Schedule Reports',
    description: 'Schedule automated report delivery',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.export',
    label: 'Export Reports',
    description: 'Export report data',
    category: 'Reports',
    module: 'reports',
  },
  {
    key: 'reports.share',
    label: 'Share Reports',
    description: 'Share reports with other users',
    category: 'Reports',
    module: 'reports',
  },

  // ============================================
  // DISPATCH
  // ============================================
  {
    key: 'dispatch.view',
    label: 'View Dispatch',
    description: 'Access dispatch board',
    category: 'Dispatch',
    module: 'dispatch',
  },
  {
    key: 'dispatch.dispatch',
    label: 'Dispatch Jobs',
    description: 'Dispatch jobs to technicians',
    category: 'Dispatch',
    module: 'dispatch',
  },
  {
    key: 'dispatch.assign',
    label: 'Assign Jobs',
    description: 'Assign jobs via dispatch',
    category: 'Dispatch',
    module: 'dispatch',
  },
  {
    key: 'dispatch.route',
    label: 'Route Jobs',
    description: 'Plan and optimize job routes',
    category: 'Dispatch',
    module: 'dispatch',
  },
  {
    key: 'dispatch.notify',
    label: 'Send Notifications',
    description: 'Send dispatch notifications',
    category: 'Dispatch',
    module: 'dispatch',
  },
  {
    key: 'dispatch.override_lock',
    label: 'Override Locks',
    description: 'Override dispatch locks and conflicts',
    category: 'Dispatch',
    module: 'dispatch',
  },

  // ============================================
  // AUDIT LOGS
  // ============================================
  {
    key: 'audit_logs.view',
    label: 'View Audit Logs',
    description: 'View audit log entries',
    category: 'Audit',
    module: 'audit_logs',
  },
  {
    key: 'audit_logs.export',
    label: 'Export Audit Logs',
    description: 'Export audit log data',
    category: 'Audit',
    module: 'audit_logs',
  },

  // ============================================
  // BILLING / PAYMENTS
  // ============================================
  {
    key: 'payments.view',
    label: 'View Payments',
    description: 'View payment records',
    category: 'Billing',
    module: 'payments',
  },
  {
    key: 'payments.manage',
    label: 'Manage Payments',
    description: 'Process and manage payments',
    category: 'Billing',
    module: 'payments',
  },
  {
    key: 'payments.refund',
    label: 'Process Refunds',
    description: 'Process payment refunds',
    category: 'Billing',
    module: 'payments',
  },

  // ============================================
  // SYSTEM / INTEGRATIONS
  // ============================================
  {
    key: 'system.integrations',
    label: 'Manage Integrations',
    description: 'Manage third-party integrations',
    category: 'System',
    module: 'system',
  },
  {
    key: 'system.webhooks',
    label: 'Manage Webhooks',
    description: 'Manage webhook configurations',
    category: 'System',
    module: 'system',
  },
  {
    key: 'system.api_keys',
    label: 'Manage API Keys',
    description: 'Manage API keys and tokens',
    category: 'System',
    module: 'system',
  },
]

/**
 * Get all permissions grouped by category
 */
export function getPermissionsByCategory(): Record<string, PermissionDefinition[]> {
  const grouped: Record<string, PermissionDefinition[]> = {}
  for (const perm of PERMISSIONS) {
    if (!grouped[perm.category]) {
      grouped[perm.category] = []
    }
    grouped[perm.category].push(perm)
  }
  return grouped
}

/**
 * Get all permissions for a module
 */
export function getPermissionsByModule(module: string): PermissionDefinition[] {
  return PERMISSIONS.filter((p) => p.module === module)
}

/**
 * Get permission by key
 */
export function getPermission(key: string): PermissionDefinition | undefined {
  return PERMISSIONS.find((p) => p.key === key)
}
