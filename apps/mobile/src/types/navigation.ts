export type JobsStackParamList = {
  JobsList: undefined
  JobDetail: { jobId: string }
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

export type RootTabParamList = {
  JobsTab: undefined
  ScheduleTab: undefined
  TasksTab: undefined
  MessagesTab: undefined
  MoreTab: undefined
}

