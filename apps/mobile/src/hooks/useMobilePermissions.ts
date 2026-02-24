import { useAuth } from '../auth/AuthContext'

/**
 * Hook to check mobile permissions
 */
export function useMobilePermissions() {
  const { mobilePermissions } = useAuth()

  /**
   * Check if user has a specific mobile permission
   */
  const hasPermission = (permission: string): boolean => {
    return mobilePermissions.includes(permission)
  }

  /**
   * Check if user has any of the specified permissions
   */
  const hasAnyPermission = (permissions: string[]): boolean => {
    return permissions.some((perm) => mobilePermissions.includes(perm))
  }

  /**
   * Check if user has all of the specified permissions
   */
  const hasAllPermissions = (permissions: string[]): boolean => {
    return permissions.every((perm) => mobilePermissions.includes(perm))
  }

  /**
   * Check if user can view all jobs (admin/dispatch)
   */
  const canViewAllJobs = (): boolean => {
    return hasPermission('mobile.jobs.view_all')
  }

  /**
   * Check if user can assign jobs
   */
  const canAssignJobs = (): boolean => {
    return hasPermission('mobile.jobs.assign')
  }

  /**
   * Check if user can complete jobs
   */
  const canCompleteJobs = (): boolean => {
    return hasPermission('mobile.jobs.complete')
  }

  /**
   * Check if user can create jobs
   */
  const canCreateJobs = (): boolean => {
    return hasPermission('mobile.jobs.create')
  }

  /**
   * Check if user can edit jobs
   */
  const canEditJobs = (): boolean => {
    return hasPermission('mobile.jobs.edit')
  }

  /**
   * Check if user can schedule jobs
   */
  const canScheduleJobs = (): boolean => {
    return hasPermission('mobile.jobs.schedule')
  }

  /**
   * Check if user can change job status
   */
  const canChangeJobStatus = (): boolean => {
    return hasPermission('mobile.jobs.status')
  }

  /**
   * Check if user can create tasks
   */
  const canCreateTasks = (): boolean => {
    return hasPermission('mobile.tasks.create')
  }

  /**
   * Check if user can assign tasks to admins
   */
  const canAssignTasksToAdmin = (): boolean => {
    return hasPermission('mobile.tasks.assign_to_admin') || hasPermission('mobile.tasks.assign_to_any')
  }

  /**
   * Check if user can assign tasks to any user
   */
  const canAssignTasksToAny = (): boolean => {
    return hasPermission('mobile.tasks.assign_to_any')
  }

  /**
   * Check if user can create issues
   */
  const canCreateIssues = (): boolean => {
    return hasPermission('mobile.issues.create')
  }

  /**
   * Check if user can assign issues to admins
   */
  const canAssignIssuesToAdmin = (): boolean => {
    return hasPermission('mobile.issues.assign_to_admin') || hasPermission('mobile.issues.assign_to_any')
  }

  /**
   * Check if user can assign issues to any user
   */
  const canAssignIssuesToAny = (): boolean => {
    return hasPermission('mobile.issues.assign_to_any')
  }

  /**
   * Check if user can upload media
   */
  const canUploadMedia = (): boolean => {
    return hasPermission('mobile.media.upload')
  }

  /**
   * Check if user can use messaging
   */
  const canUseMessaging = (): boolean => {
    return hasPermission('mobile.messaging.enabled')
  }

  const canTrackTime = (): boolean => {
    return hasPermission('mobile.jobs.track_time')
  }

  const canEditOwnTimeEntries = (): boolean => {
    return hasPermission('mobile.jobs.edit_own_time_entries')
  }

  const canEditTeamTimeEntries = (): boolean => {
    return hasPermission('mobile.jobs.edit_team_time_entries')
  }

  /**
   * Check if user has mobile app access
   */
  const hasMobileAccess = (): boolean => {
    return hasPermission('mobile.access')
  }

  return {
    permissions: mobilePermissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    canViewAllJobs,
    canAssignJobs,
    canCompleteJobs,
    canCreateJobs,
    canEditJobs,
    canScheduleJobs,
    canChangeJobStatus,
    canCreateTasks,
    canAssignTasksToAdmin,
    canAssignTasksToAny,
    canCreateIssues,
    canAssignIssuesToAdmin,
    canAssignIssuesToAny,
    canUploadMedia,
    canUseMessaging,
    canTrackTime,
    canEditOwnTimeEntries,
    canEditTeamTimeEntries,
    hasMobileAccess,
  }
}
