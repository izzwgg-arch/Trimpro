import React from 'react'
import { NavigationContainer, DefaultTheme, LinkingOptions } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../auth/AuthContext'
import { LoginScreen } from '../screens/auth/LoginScreen'
import { JobsScreen } from '../screens/jobs/JobsScreen'
import { JobDetailScreen } from '../screens/jobs/JobDetailScreen'
import { ScheduleScreen } from '../screens/schedule/ScheduleScreen'
import { TasksScreen } from '../screens/tasks/TasksScreen'
import { MessagesScreen } from '../screens/messages/MessagesScreen'
import { MessageThreadScreen } from '../screens/messages/MessageThreadScreen'
import { TeamChatScreen } from '../screens/messages/TeamChatScreen'
import { MoreScreen } from '../screens/more/MoreScreen'
import { CreateRequestScreen } from '../screens/requests/CreateRequestScreen'
import { IssuesScreen } from '../screens/issues/IssuesScreen'
import { IssueDetailScreen } from '../screens/issues/IssueDetailScreen'
import { CallsScreen } from '../screens/calls/CallsScreen'
import { ProfileScreen } from '../screens/profile/ProfileScreen'
import { OutboxScreen } from '../screens/outbox/OutboxScreen'
import { BRAND } from '../config/env'
import {
  JobsStackParamList,
  MessagesStackParamList,
  MoreStackParamList,
  RootTabParamList,
  TasksStackParamList,
} from '../types/navigation'
import { TaskDetailScreen } from '../screens/tasks/TaskDetailScreen'
import { useOutboxCount } from '../hooks/useOutboxCount'

const Tab = createBottomTabNavigator<RootTabParamList>()
const JobsStack = createNativeStackNavigator<JobsStackParamList>()
const TasksStack = createNativeStackNavigator<TasksStackParamList>()
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>()
const MoreStack = createNativeStackNavigator<MoreStackParamList>()
const AuthStack = createNativeStackNavigator()

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: ['trimprofield://'],
  config: {
    screens: {
      JobsTab: {
        screens: {
          JobsList: 'jobs',
          JobDetail: 'jobs/:jobId',
        },
      } as never,
      ScheduleTab: 'schedule',
      TasksTab: {
        screens: {
          TasksList: 'tasks',
          TaskDetail: 'tasks/:taskId',
        },
      } as never,
      MessagesTab: {
        screens: {
          MessagesList: 'messages',
          MessageThread: 'messages/:conversationId',
          TeamChat: 'messages/team',
        },
      } as never,
      MoreTab: {
        screens: {
          MoreHome: 'more',
          Requests: 'requests',
          Issues: 'issues',
          IssueDetail: 'issues/:issueId',
          Calls: 'calls',
          Profile: 'profile',
          Outbox: 'outbox',
        },
      } as never,
    },
  },
}

function JobsStackNavigator() {
  return (
    <JobsStack.Navigator>
      <JobsStack.Screen name="JobsList" component={JobsScreen} options={{ title: 'Jobs' }} />
      <JobsStack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: 'Job Details' }} />
    </JobsStack.Navigator>
  )
}

function TasksStackNavigator() {
  return (
    <TasksStack.Navigator>
      <TasksStack.Screen name="TasksList" component={TasksScreen} options={{ title: 'Tasks' }} />
      <TasksStack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task Details' }} />
    </TasksStack.Navigator>
  )
}

function MessagesStackNavigator() {
  return (
    <MessagesStack.Navigator>
      <MessagesStack.Screen name="MessagesList" component={MessagesScreen} options={{ title: 'Messages' }} />
      <MessagesStack.Screen name="TeamChat" component={TeamChatScreen} options={{ title: 'Team Chat' }} />
      <MessagesStack.Screen name="MessageThread" component={MessageThreadScreen} options={{ title: 'Thread' }} />
    </MessagesStack.Navigator>
  )
}

function MoreStackNavigator() {
  return (
    <MoreStack.Navigator>
      <MoreStack.Screen name="MoreHome" component={MoreScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="Requests" component={CreateRequestScreen} options={{ title: 'Requests' }} />
      <MoreStack.Screen name="Issues" component={IssuesScreen} options={{ title: 'Issues' }} />
      <MoreStack.Screen name="IssueDetail" component={IssueDetailScreen} options={{ title: 'Issue Details' }} />
      <MoreStack.Screen name="Calls" component={CallsScreen} options={{ title: 'Calls' }} />
      <MoreStack.Screen name="Outbox" component={OutboxScreen} options={{ title: 'Outbox' }} />
      <MoreStack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </MoreStack.Navigator>
  )
}

export function RootNavigator() {
  const { token } = useAuth()
  const outboxCount = useOutboxCount()
  return (
    <NavigationContainer
      linking={linking}
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: BRAND.bg,
        },
      }}
    >
      {!token ? (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </AuthStack.Navigator>
      ) : (
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: BRAND.primary,
            tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
            tabBarIcon: ({ color, size }) => {
              const iconName =
                route.name === 'JobsTab'
                  ? 'briefcase-outline'
                  : route.name === 'ScheduleTab'
                    ? 'calendar-outline'
                    : route.name === 'TasksTab'
                      ? 'checkbox-outline'
                      : route.name === 'MessagesTab'
                        ? 'chatbubble-ellipses-outline'
                        : 'ellipsis-horizontal-circle-outline'
              return <Ionicons name={iconName as any} size={size} color={color} />
            },
          })}
        >
          <Tab.Screen
            name="JobsTab"
            component={JobsStackNavigator}
            options={{
              title: 'Jobs',
              tabBarBadge: outboxCount > 0 ? outboxCount : undefined,
            }}
          />
          <Tab.Screen name="ScheduleTab" component={ScheduleScreen} options={{ title: 'Schedule' }} />
          <Tab.Screen name="TasksTab" component={TasksStackNavigator} options={{ title: 'Tasks' }} />
          <Tab.Screen name="MessagesTab" component={MessagesStackNavigator} options={{ title: 'Messages' }} />
          <Tab.Screen name="MoreTab" component={MoreStackNavigator} options={{ title: 'More' }} />
        </Tab.Navigator>
      )}
    </NavigationContainer>
  )
}

