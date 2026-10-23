/**
 * A request (lead) is named by its job site address; the person's name is shown
 * alongside. Falls back to the person / company when there is no address yet.
 */
type RequestNameParts = {
  jobSiteAddress?: string | null
  firstName?: string | null
  lastName?: string | null
  company?: string | null
}

export function requestPersonName(r: RequestNameParts): string {
  return `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim()
}

export function requestDisplayName(r: RequestNameParts): string {
  const site = String(r.jobSiteAddress ?? '').trim()
  if (site) return site
  return requestPersonName(r) || String(r.company ?? '').trim() || 'Request'
}

/** The line under the name: the person (and company) when the name is the address. */
export function requestSubtitle(r: RequestNameParts): string {
  if (!String(r.jobSiteAddress ?? '').trim()) return String(r.company ?? '').trim()
  return [requestPersonName(r), String(r.company ?? '').trim()].filter(Boolean).join(' · ')
}
