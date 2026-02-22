import React from 'react'
import { NavigationContainer, DefaultTheme, LinkingOptions } from '@react-navigation/native'
import { createDrawerNavigator, DrawerContentComponentProps, DrawerContentScrollView } from '@react-navigation/drawer'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { LoginScreen } from '../screens/auth/LoginScreen'
import { JobsScreen } from '../screens/jobs/JobsScreen'
import { JobDetailScreen } from '../screens/jobs/JobDetailScreen'
import { ScheduleScreen } from '../screens/schedule/ScheduleScreen'
import { TasksScreen } from '../screens/tasks/TasksScreen'
import { MessagesScreen } from '../screens/messages/MessagesScreen'
import { MessageThreadScreen } from '../screens/messages/MessageThreadScreen'
import { TeamChatScreen } from '../screens/messages/TeamChatScreen'
import { CreateRequestScreen } from '../screens/requests/CreateRequestScreen'
import { IssuesScreen } from '../screens/issues/IssuesScreen'
import { IssueDetailScreen } from '../screens/issues/IssueDetailScreen'
import { CallsScreen } from '../screens/calls/CallsScreen'
import { ProfileScreen } from '../screens/profile/ProfileScreen'
import { OutboxScreen } from '../screens/outbox/OutboxScreen'
import { colors, spacing, typography } from '../theme/tokens'
import {
  JobsStackParamList,
  MessagesStackParamList,
  MoreStackParamList,
  RootTabParamList,
  TasksStackParamList,
  IssuesStackParamList,
  RootDrawerParamList,
} from '../types/navigation'
import { TaskDetailScreen } from '../screens/tasks/TaskDetailScreen'
import { useOutboxCount } from '../hooks/useOutboxCount'
import { Card } from '../components/Card'

const Drawer = createDrawerNavigator<RootDrawerParamList>()
const JobsStack = createNativeStackNavigator<JobsStackParamList>()
const ScheduleStack = createNativeStackNavigator()
const TasksStack = createNativeStackNavigator<TasksStackParamList>()
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>()
const IssuesStack = createNativeStackNavigator<IssuesStackParamList>()
const RequestsStack = createNativeStackNavigator()
const CallsStack = createNativeStackNavigator()
const OutboxStack = createNativeStackNavigator()
const ProfileStack = createNativeStackNavigator()
const AuthStack = createNativeStackNavigator()

const linking: LinkingOptions<RootDrawerParamList> = {
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
      RequestsTab: 'requests',
      IssuesTab: {
        screens: {
          IssuesList: 'issues',
          IssueDetail: 'issues/:issueId',
        },
      } as never,
      CallsTab: 'calls',
      OutboxTab: 'outbox',
      ProfileTab: 'profile',
    },
  },
}

function JobsStackNavigator() {
  return (
    <JobsStack.Navigator screenOptions={stackOptions}>
      <JobsStack.Screen name="JobsList" component={JobsScreen} options={mainHeaderOptions('Dashboard')} />
      <JobsStack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: 'Job Details' }} />
    </JobsStack.Navigator>
  )
}

function ScheduleStackNavigator() {
  return (
    <ScheduleStack.Navigator screenOptions={stackOptions}>
      <ScheduleStack.Screen name="ScheduleHome" component={ScheduleScreen} options={mainHeaderOptions('Schedule')} />
    </ScheduleStack.Navigator>
  )
}

function TasksStackNavigator() {
  return (
    <TasksStack.Navigator screenOptions={stackOptions}>
      <TasksStack.Screen name="TasksList" component={TasksScreen} options={mainHeaderOptions('Tasks')} />
      <TasksStack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task Details' }} />
    </TasksStack.Navigator>
  )
}

function MessagesStackNavigator() {
  return (
    <MessagesStack.Navigator screenOptions={stackOptions}>
      <MessagesStack.Screen name="MessagesList" component={MessagesScreen} options={mainHeaderOptions('Messages')} />
      <MessagesStack.Screen name="TeamChat" component={TeamChatScreen} options={{ title: 'Team Chat' }} />
      <MessagesStack.Screen name="MessageThread" component={MessageThreadScreen} options={{ title: 'Thread' }} />
    </MessagesStack.Navigator>
  )
}

function RequestsStackNavigator() {
  return (
    <RequestsStack.Navigator screenOptions={stackOptions}>
      <RequestsStack.Screen name="RequestsHome" component={CreateRequestScreen} options={mainHeaderOptions('Requests')} />
    </RequestsStack.Navigator>
  )
}

function IssuesStackNavigator() {
  return (
    <IssuesStack.Navigator screenOptions={stackOptions}>
      <IssuesStack.Screen name="IssuesList" component={IssuesScreen} options={mainHeaderOptions('Issues')} />
      <IssuesStack.Screen name="IssueDetail" component={IssueDetailScreen} options={{ title: 'Issue Details' }} />
    </IssuesStack.Navigator>
  )
}

function CallsStackNavigator() {
  return (
    <CallsStack.Navigator screenOptions={stackOptions}>
      <CallsStack.Screen name="CallsHome" component={CallsScreen} options={mainHeaderOptions('Calls')} />
    </CallsStack.Navigator>
  )
}

function OutboxStackNavigator() {
  return (
    <OutboxStack.Navigator screenOptions={stackOptions}>
      <OutboxStack.Screen name="OutboxHome" component={OutboxScreen} options={mainHeaderOptions('Outbox')} />
    </OutboxStack.Navigator>
  )
}

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={stackOptions}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} options={mainHeaderOptions('Profile')} />
    </ProfileStack.Navigator>
  )
}

const stackOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  headerShadowVisible: false,
  headerTintColor: colors.textPrimary,
} as const

function mainHeaderOptions(title: string) {
  return ({ navigation }: any) => ({
    title,
    headerLeft: () => (
      <Pressable
        onPress={() => navigation.toggleDrawer()}
        android_ripple={{ color: 'rgba(15,23,42,0.1)', borderless: true }}
        style={styles.headerMenuButton}
      >
        <Ionicons name="menu" size={20} color={colors.textPrimary} />
      </Pressable>
    ),
  })
}

function DrawerContent(props: DrawerContentComponentProps) {
  const { user, signOut } = useAuth()
  const outboxCount = useOutboxCount()

  // Navigation items - More option removed, all items now directly in sidebar
  const items: Array<{
    key: keyof RootDrawerParamList
    label: string
    icon: keyof typeof Ionicons.glyphMap
  }> = [
    { key: 'JobsTab', label: 'Jobs', icon: 'briefcase-outline' },
    { key: 'ScheduleTab', label: 'Schedule', icon: 'calendar-outline' },
    { key: 'TasksTab', label: 'Tasks', icon: 'checkbox-outline' },
    { key: 'MessagesTab', label: 'Messages', icon: 'chatbubble-ellipses-outline' },
    { key: 'RequestsTab', label: 'Requests', icon: 'document-text-outline' },
    { key: 'IssuesTab', label: 'Issues', icon: 'alert-circle-outline' },
    { key: 'CallsTab', label: 'Calls', icon: 'call-outline' },
    { key: 'OutboxTab', label: `Outbox${outboxCount > 0 ? ` (${outboxCount})` : ''}`, icon: 'cloud-upload-outline' },
    { key: 'ProfileTab', label: 'Profile', icon: 'person-outline' },
  ]

  const current = props.state.routeNames[props.state.index]

  return (
    <View style={styles.drawerRoot}>
      <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerScroll}>
        <View style={styles.brandWrap}>
          <Text style={styles.brandTitle}>TrimPro</Text>
          <Text style={styles.brandSubtitle}>Field Operations</Text>
        </View>
        <Card style={styles.userCard}>
          <Text style={styles.userName}>{user ? `${user.firstName} ${user.lastName}` : 'User'}</Text>
          <Text style={styles.userRole}>{user?.role || 'FIELD'}</Text>
        </Card>

        <View style={styles.navList}>
          {items.map((item) => {
            const active = current === item.key
            return (
              <Pressable
                key={item.key}
                onPress={() => props.navigation.navigate(item.key)}
                android_ripple={{ color: 'rgba(15,76,92,0.12)' }}
                style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && styles.navPressed]}
              >
                {active && <View style={styles.activeBar} />}
                <Ionicons name={item.icon} size={18} color={active ? colors.brandPrimary : colors.textSecondary} />
                <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </DrawerContentScrollView>

      <View style={styles.drawerBottom}>
        <Pressable
          onPress={() => props.navigation.navigate('ProfileTab')}
          android_ripple={{ color: 'rgba(15,23,42,0.1)' }}
          style={({ pressed }) => [styles.bottomBtn, pressed && styles.navPressed]}
        >
          <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.bottomText}>Settings</Text>
        </Pressable>
        <Pressable
          onPress={() => void signOut()}
          android_ripple={{ color: 'rgba(220,38,38,0.1)' }}
          style={({ pressed }) => [styles.bottomBtn, pressed && styles.navPressed]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={[styles.bottomText, { color: colors.danger }]}>Logout</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function RootNavigator() {
  const { token } = useAuth()
  return (
    <NavigationContainer
      linking={linking}
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.background,
        },
      }}
    >
      {!token ? (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </AuthStack.Navigator>
      ) : (
        <Drawer.Navigator
          drawerContent={(props) => <DrawerContent {...props} />}
          screenOptions={{
            headerShown: false,
            drawerType: 'slide',
            overlayColor: 'rgba(15,23,42,0.28)',
            drawerStyle: { width: 286, backgroundColor: colors.surface },
            sceneStyle: { backgroundColor: colors.background },
          }}
        >
          <Drawer.Screen
            name="JobsTab"
            component={JobsStackNavigator}
            options={{ title: 'Jobs' }}
          />
          <Drawer.Screen name="ScheduleTab" component={ScheduleStackNavigator} options={{ title: 'Schedule' }} />
          <Drawer.Screen name="TasksTab" component={TasksStackNavigator} options={{ title: 'Tasks' }} />
          <Drawer.Screen name="MessagesTab" component={MessagesStackNavigator} options={{ title: 'Messages' }} />
          <Drawer.Screen name="RequestsTab" component={RequestsStackNavigator} options={{ title: 'Requests' }} />
          <Drawer.Screen name="IssuesTab" component={IssuesStackNavigator} options={{ title: 'Issues' }} />
          <Drawer.Screen name="CallsTab" component={CallsStackNavigator} options={{ title: 'Calls' }} />
          <Drawer.Screen name="OutboxTab" component={OutboxStackNavigator} options={{ title: 'Outbox' }} />
          <Drawer.Screen name="ProfileTab" component={ProfileStackNavigator} options={{ title: 'Profile' }} />
        </Drawer.Navigator>
      )}
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  headerMenuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerRoot: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  drawerScroll: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  brandWrap: {
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  brandTitle: {
    ...typography.h2,
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  brandSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  userCard: {
    marginBottom: spacing.md,
  },
  userName: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  userRole: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  navList: {
    gap: spacing.xs,
  },
  navItem: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  navItemActive: {
    backgroundColor: 'rgba(15,76,92,0.1)',
  },
  navPressed: {
    opacity: 0.9,
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 999,
    backgroundColor: colors.brandPrimary,
  },
  navText: {
    ...typography.sub,
    color: colors.textSecondary,
  },
  navTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  drawerBottom: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  bottomBtn: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bottomText: {
    ...typography.sub,
    color: colors.textSecondary,
  },
})

