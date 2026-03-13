// ─── Smart Steps Mock Data — Real enough to demo, structured to scale ─────────
import type { ABAClient, Program, Target, Session, Trial, BehaviorEvent, TargetDataPoint, BehaviorDataPoint, ClientStats } from './types'

export const MOCK_CLIENTS: ABAClient[] = [
  {
    id: 'c1',
    firstName: 'Marcus',
    lastName: 'Johnson',
    dob: '2017-04-12',
    age: 7,
    photoUrl: '',
    diagnosisTags: ['ASD Level 2', 'ADHD'],
    assignedTherapists: ['t1', 't2'],
    guardianName: 'Diana Johnson',
    guardianPhone: '555-0101',
    guardianEmail: 'diana@example.com',
    notes: 'Highly motivated by trains and music. Responds well to DRO.',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2025-03-01T08:00:00Z',
    lastSessionDate: '2025-03-10T14:30:00Z',
    overallProgress: 68,
    masteredTargets: 17,
    totalTargets: 25,
    sessionsThisWeek: 3,
  },
  {
    id: 'c2',
    firstName: 'Aaliyah',
    lastName: 'Rivera',
    dob: '2019-08-22',
    age: 5,
    photoUrl: '',
    diagnosisTags: ['ASD Level 1'],
    assignedTherapists: ['t1'],
    guardianName: 'Carlos Rivera',
    guardianPhone: '555-0202',
    guardianEmail: 'carlos@example.com',
    notes: 'Strong echoic skills. Working on expanding tact repertoire.',
    createdAt: '2024-03-10T10:00:00Z',
    updatedAt: '2025-03-05T08:00:00Z',
    lastSessionDate: '2025-03-09T10:00:00Z',
    overallProgress: 82,
    masteredTargets: 22,
    totalTargets: 27,
    sessionsThisWeek: 4,
  },
  {
    id: 'c3',
    firstName: 'Ethan',
    lastName: 'Kim',
    dob: '2015-11-03',
    age: 9,
    photoUrl: '',
    diagnosisTags: ['ASD Level 2', 'Intellectual Disability'],
    assignedTherapists: ['t2', 't3'],
    guardianName: 'Jessica Kim',
    guardianPhone: '555-0303',
    createdAt: '2023-06-20T10:00:00Z',
    updatedAt: '2025-02-28T08:00:00Z',
    lastSessionDate: '2025-03-08T16:00:00Z',
    overallProgress: 45,
    masteredTargets: 9,
    totalTargets: 20,
    sessionsThisWeek: 2,
  },
  {
    id: 'c4',
    firstName: 'Sofia',
    lastName: 'Patel',
    dob: '2020-02-14',
    age: 5,
    photoUrl: '',
    diagnosisTags: ['ASD Level 3', 'Sensory Processing Disorder'],
    assignedTherapists: ['t1', 't3'],
    guardianName: 'Priya Patel',
    guardianPhone: '555-0404',
    createdAt: '2024-07-01T10:00:00Z',
    updatedAt: '2025-03-10T08:00:00Z',
    lastSessionDate: '2025-03-10T09:00:00Z',
    overallProgress: 31,
    masteredTargets: 5,
    totalTargets: 16,
    sessionsThisWeek: 5,
  },
]

export const MOCK_PROGRAMS: Program[] = [
  {
    id: 'prog1',
    clientId: 'c1',
    name: 'Functional Communication',
    domain: 'Mand',
    description: 'Build mand repertoire using PECS and vocal approximations',
    isActive: true,
    createdByRole: 'BCBA',
    createdAt: '2024-01-20T10:00:00Z',
    updatedAt: '2025-01-10T10:00:00Z',
  },
  {
    id: 'prog2',
    clientId: 'c1',
    name: 'Object Labeling',
    domain: 'Tact',
    description: 'Label common household and school items',
    isActive: true,
    createdByRole: 'BCBA',
    createdAt: '2024-01-20T10:00:00Z',
    updatedAt: '2025-02-01T10:00:00Z',
  },
  {
    id: 'prog3',
    clientId: 'c1',
    name: 'Self-Care Skills',
    domain: 'ADL',
    description: 'Handwashing, teeth brushing, dressing sequences',
    isActive: true,
    createdByRole: 'BCBA',
    createdAt: '2024-03-01T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
  },
  {
    id: 'prog4',
    clientId: 'c1',
    name: 'Social Interactions',
    domain: 'Social',
    description: 'Greetings, turn-taking, joint attention',
    isActive: true,
    createdByRole: 'BCBA',
    createdAt: '2024-06-01T10:00:00Z',
    updatedAt: '2025-03-01T10:00:00Z',
  },
]

export const MOCK_TARGETS: Target[] = [
  // Mand targets
  {
    id: 'tgt1', programId: 'prog1', clientId: 'c1',
    name: 'Mand for preferred items (3 items)',
    operationalDefinition: 'Client emits a vocalization, approximation, or sign within 3 seconds of deprivation when preferred item is present',
    type: 'discrete_trial', phase: 'maintenance',
    masteryRule: { id: 'mr1', targetId: 'tgt1', percentCorrect: 80, consecutiveSessions: 3, minTrialsPerSession: 10, maxPromptLevel: 0, autoAdvance: true },
    isActive: true, sortOrder: 1,
    createdAt: '2024-01-25T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z',
    recentAccuracy: 92, trend: 'up', trialCount: 847,
  },
  {
    id: 'tgt2', programId: 'prog1', clientId: 'c1',
    name: 'Mand for break',
    operationalDefinition: 'Client says "break" or uses break card within 3s when given non-preferred demand',
    type: 'discrete_trial', phase: 'acquisition',
    masteryRule: { id: 'mr2', targetId: 'tgt2', percentCorrect: 80, consecutiveSessions: 3, minTrialsPerSession: 8, maxPromptLevel: 1, autoAdvance: true },
    isActive: true, sortOrder: 2,
    createdAt: '2024-03-01T10:00:00Z', updatedAt: '2025-03-01T10:00:00Z',
    recentAccuracy: 67, trend: 'up', trialCount: 234, plateauDays: 0,
  },
  {
    id: 'tgt3', programId: 'prog1', clientId: 'c1',
    name: 'Mand for help',
    operationalDefinition: 'Client says "help" or taps help icon when presented with difficult/blocked task',
    type: 'discrete_trial', phase: 'acquisition',
    masteryRule: { id: 'mr3', targetId: 'tgt3', percentCorrect: 80, consecutiveSessions: 3, minTrialsPerSession: 8, maxPromptLevel: 0, autoAdvance: true },
    isActive: true, sortOrder: 3,
    createdAt: '2024-04-15T10:00:00Z', updatedAt: '2025-02-15T10:00:00Z',
    recentAccuracy: 54, trend: 'flat', trialCount: 156, plateauDays: 6,
  },
  // Tact targets
  {
    id: 'tgt4', programId: 'prog2', clientId: 'c1',
    name: 'Label 10 household items',
    operationalDefinition: 'When shown real object or photo, client labels within 3s at independent level',
    type: 'discrete_trial', phase: 'mastered',
    isActive: false, sortOrder: 1,
    createdAt: '2024-01-25T10:00:00Z', updatedAt: '2024-12-01T10:00:00Z',
    recentAccuracy: 100, trend: 'up', trialCount: 1203,
  },
  {
    id: 'tgt5', programId: 'prog2', clientId: 'c1',
    name: 'Label emotions (happy/sad/angry/scared)',
    operationalDefinition: 'Client labels emotion in photo/real face within 3s at gestural prompt or less',
    type: 'discrete_trial', phase: 'acquisition',
    masteryRule: { id: 'mr5', targetId: 'tgt5', percentCorrect: 80, consecutiveSessions: 3, minTrialsPerSession: 12, maxPromptLevel: 2, autoAdvance: true },
    isActive: true, sortOrder: 2,
    createdAt: '2024-08-01T10:00:00Z', updatedAt: '2025-02-01T10:00:00Z',
    recentAccuracy: 71, trend: 'up', trialCount: 389,
  },
  // ADL targets
  {
    id: 'tgt6', programId: 'prog3', clientId: 'c1',
    name: 'Handwashing (8-step sequence)',
    operationalDefinition: 'Client completes all 8 steps of handwashing independently in correct order',
    type: 'task_analysis_forward', phase: 'acquisition',
    masteryRule: { id: 'mr6', targetId: 'tgt6', percentCorrect: 90, consecutiveSessions: 3, minTrialsPerSession: 3, maxPromptLevel: 0, autoAdvance: true },
    isActive: true, sortOrder: 1,
    createdAt: '2024-03-10T10:00:00Z', updatedAt: '2025-03-01T10:00:00Z',
    recentAccuracy: 75, trend: 'up', trialCount: 127,
  },
]

// ─── Trial History Data (for charts) ─────────────────────────────────────────

export function generateMockTrialHistory(targetId: string, days = 30): TargetDataPoint[] {
  const baseAccuracy: Record<string, number> = {
    tgt1: 88, tgt2: 62, tgt3: 50, tgt4: 99, tgt5: 68, tgt6: 72,
  }
  const base = baseAccuracy[targetId] ?? 65
  const points: TargetDataPoint[] = []
  const now = new Date()

  for (let i = days; i >= 1; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    // Skip ~25% of days (no session)
    if (Math.random() < 0.25) continue

    const jitter = (Math.random() - 0.3) * 20
    const percent = Math.min(100, Math.max(0, base + jitter + (days - i) * 0.3))
    const trials = Math.floor(Math.random() * 8) + 8
    const correct = Math.round((percent / 100) * trials)
    const prompted = Math.floor(Math.random() * 3)

    points.push({
      date: d.toISOString().slice(0, 10),
      percent: Math.round(percent),
      trials,
      correct,
      incorrect: trials - correct - prompted,
      prompted,
      sessionId: `s_mock_${i}`,
    })
  }
  return points
}

export function generateBehaviorHistory(name: string, days = 30): BehaviorDataPoint[] {
  const points: BehaviorDataPoint[] = []
  const now = new Date()
  let baseline = name === 'Elopement' ? 4 : name === 'Aggression' ? 2 : 6

  for (let i = days; i >= 1; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    if (Math.random() < 0.2) continue

    const trend = -0.05 // downward trend = good
    baseline = Math.max(0, baseline + trend + (Math.random() - 0.5) * 1.5)

    points.push({
      date: d.toISOString().slice(0, 10),
      count: Math.round(baseline),
      intensity: {
        mild: Math.round(baseline * 0.6),
        moderate: Math.round(baseline * 0.3),
        severe: Math.round(baseline * 0.1),
      },
    })
  }
  return points
}

export const MOCK_BEHAVIORS = ['Elopement', 'Aggression', 'Self-Injurious Behavior', 'Tantrum', 'Stereotypy']

export const MOCK_CLIENT_STATS: Record<string, ClientStats> = {
  c1: {
    masteredTargets: 17, totalTargets: 25, activeTargets: 8,
    sessionsThisWeek: 3, totalTrialsThisMonth: 847, avgAccuracyThisWeek: 74,
    plateauAlerts: 2, masteryRate: 68,
    topBehaviors: [
      { name: 'Tantrum', count: 14, trend: 'down' },
      { name: 'Elopement', count: 5, trend: 'flat' },
      { name: 'Stereotypy', count: 22, trend: 'down' },
    ],
  },
  c2: {
    masteredTargets: 22, totalTargets: 27, activeTargets: 5,
    sessionsThisWeek: 4, totalTrialsThisMonth: 1203, avgAccuracyThisWeek: 88,
    plateauAlerts: 0, masteryRate: 82,
    topBehaviors: [
      { name: 'Tantrum', count: 3, trend: 'down' },
    ],
  },
  c3: {
    masteredTargets: 9, totalTargets: 20, activeTargets: 11,
    sessionsThisWeek: 2, totalTrialsThisMonth: 412, avgAccuracyThisWeek: 52,
    plateauAlerts: 4, masteryRate: 45,
    topBehaviors: [
      { name: 'Aggression', count: 8, trend: 'flat' },
      { name: 'Self-Injurious Behavior', count: 4, trend: 'down' },
      { name: 'Elopement', count: 6, trend: 'up' },
    ],
  },
  c4: {
    masteredTargets: 5, totalTargets: 16, activeTargets: 11,
    sessionsThisWeek: 5, totalTrialsThisMonth: 623, avgAccuracyThisWeek: 61,
    plateauAlerts: 1, masteryRate: 31,
    topBehaviors: [
      { name: 'Stereotypy', count: 31, trend: 'down' },
      { name: 'Tantrum', count: 9, trend: 'down' },
    ],
  },
}

export const MOCK_RECENT_SESSIONS: Session[] = [
  {
    id: 'sess1', clientId: 'c1', therapistId: 't1', therapistName: 'Jamie Torres',
    startTime: '2025-03-10T14:30:00Z', endTime: '2025-03-10T16:00:00Z',
    status: 'completed', targetIds: ['tgt1', 'tgt2', 'tgt5'],
    notes: 'Great session! Marcus was highly motivated. Mastered tgt1 today 🎉',
    location: 'Home', createdAt: '2025-03-10T14:30:00Z', updatedAt: '2025-03-10T16:05:00Z',
    syncStatus: 'synced', trialCount: 48, correctPercent: 78,
  },
  {
    id: 'sess2', clientId: 'c1', therapistId: 't2', therapistName: 'Alex Chen',
    startTime: '2025-03-08T10:00:00Z', endTime: '2025-03-08T11:30:00Z',
    status: 'completed', targetIds: ['tgt2', 'tgt3', 'tgt6'],
    notes: 'Worked on mand + handwashing. Good progress on step 4.',
    location: 'Clinic', createdAt: '2025-03-08T10:00:00Z', updatedAt: '2025-03-08T11:35:00Z',
    syncStatus: 'synced', trialCount: 41, correctPercent: 65,
  },
]

// Heatmap data: sessions per day for last 90 days
export function generateHeatmapData(clientId: string): Array<{ date: string; count: number }> {
  const data: Array<{ date: string; count: number }> = []
  const now = new Date()
  const sessionsPerClient: Record<string, number> = { c1: 0.65, c2: 0.75, c3: 0.4, c4: 0.8 }
  const freq = sessionsPerClient[clientId] ?? 0.6

  for (let i = 90; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const hasSession = Math.random() < freq
    data.push({ date: dateStr, count: hasSession ? Math.floor(Math.random() * 2) + 1 : 0 })
  }
  return data
}
