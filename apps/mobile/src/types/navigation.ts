export type JobsStackParamList = {
  JobsList: undefined
  AllJobsList: undefined
  JobDetail: { jobId: string }
  AdminJobDetail: { jobId: string }
  CreateJob: undefined
  EditJob: { jobId: string }
}

export type DashboardStackParamList = {
  DashboardHome: undefined
}

export type TasksStackParamList = {
  TasksList: undefined
  TaskDetail: { taskId: string }
}

export type MessagesStackParamList = {
  MessagesList: undefined
  MessageThread: { conversationId: string }
  TeamChat: undefined
}

export type MoreStackParamList = {
  MoreHome: undefined
  Requests: undefined
  Issues: undefined
  IssueDetail: { issueId: string }
  Calls: undefined
  Outbox: undefined
  Profile: undefined
}

export type IssuesStackParamList = {
  IssuesList: undefined
  IssueDetail: { issueId: string }
}

export type RootDrawerParamList = {
  DashboardTab: undefined
  JobsTab: undefined
  ScheduleTab: undefined
  TasksTab: undefined
  MessagesTab: undefined
  RequestsTab: undefined
  IssuesTab: undefined
  CallsTab: undefined
  OutboxTab: undefined
  ProfileTab: undefined
}

// Backward-compatible alias for existing imports.
export type RootTabParamList = RootDrawerParamList