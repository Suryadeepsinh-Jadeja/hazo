import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Home, CheckCircle, Target, User } from 'lucide-react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../constants/theme';
import api from '../lib/api';
import { TodayScreen } from '../screens/app/TodayScreen';
import { TasksScreen } from '../screens/app/TasksScreen';
import { GoalsScreen } from '../screens/app/GoalsScreen';
import { ProfileScreen } from '../screens/app/ProfileScreen';
import { RoadmapScreen } from '../screens/app/RoadmapScreen';
import { TaskDetailScreen } from '../screens/app/TaskDetailScreen';
import { MentorScreen } from '../screens/app/MentorScreen';
import { SkillsScreen } from '../screens/app/SkillsScreen';
import { RoomFeedScreen } from '../screens/app/RoomFeedScreen';
import { CommunityScreen } from '../screens/app/CommunityScreen';
import { TopicDetailScreen } from '../screens/app/TopicDetailScreen';
import { OnboardingStack } from './OnboardingStack';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const MainTabs = () => {
  const insets = useSafeAreaInsets();
  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ['tasks', 'tab-badge'],
    queryFn: async () => {
      const res = await api.get('/api/v1/tasks');
      return res.data;
    },
    staleTime: 60 * 1000,
  });
  const pendingTaskCount = tasks.filter(
    (task) => task && task.status !== 'done' && task.status !== 'abandoned'
  ).length;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: theme.colors.neutral.white,
          borderTopColor: theme.colors.neutral.border,
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: theme.colors.accent.coral,
        tabBarInactiveTintColor: theme.colors.primary.inkMuted,
        tabBarLabelStyle: {
          fontFamily: theme.typography.fontMono,
          fontSize: 10,
          letterSpacing: 0.6,
          marginTop: -4,
        },
      }}
      screenListeners={{
        tabPress: () => {
          ReactNativeHapticFeedback.trigger('impactLight');
        },
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              {focused && <View style={styles.activeTabIndicator} />}
              <Home color={color} size={22} strokeWidth={focused ? 2.5 : 2} style={{ opacity: focused ? 1 : 0.55 }} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Tasks"
        component={TasksScreen}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              {focused && <View style={styles.activeTabIndicator} />}
              <CheckCircle color={color} size={22} strokeWidth={focused ? 2.5 : 2} style={{ opacity: focused ? 1 : 0.55 }} />
              {pendingTaskCount > 0 ? (
                <View style={styles.badgeCountContainer}>
                  <Text style={styles.badgeCountText}>
                    {pendingTaskCount > 99 ? '99+' : pendingTaskCount}
                  </Text>
                </View>
              ) : null}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Goals"
        component={GoalsScreen}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              {focused && <View style={styles.activeTabIndicator} />}
              <Target color={color} size={22} strokeWidth={focused ? 2.5 : 2} style={{ opacity: focused ? 1 : 0.55 }} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              {focused && <View style={styles.activeTabIndicator} />}
              <User color={color} size={22} strokeWidth={focused ? 2.5 : 2} style={{ opacity: focused ? 1 : 0.55 }} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export const AppNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={MainTabs} />
      <Stack.Screen name="OnboardingStack" component={OnboardingStack} />
      <Stack.Screen name="RoadmapScreen" component={RoadmapScreen} />
      <Stack.Screen name="TaskDetailScreen" component={TaskDetailScreen} />
      <Stack.Screen name="TopicDetailScreen" component={TopicDetailScreen} />
      <Stack.Screen name="Mentor" component={MentorScreen} />
      <Stack.Screen name="MentorScreen" component={MentorScreen} />
      <Stack.Screen name="SkillsScreen" component={SkillsScreen} />
      <Stack.Screen name="RoomFeedScreen" component={RoomFeedScreen} />
      <Stack.Screen name="Community" component={CommunityScreen} />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    position: 'relative',
    paddingTop: 8,
  },
  activeTabIndicator: {
    position: 'absolute',
    top: -4, 
    width: 32,
    height: 2,
    backgroundColor: theme.colors.accent.coral,
    borderRadius: 1,
  },
  badgeCountContainer: {
    position: 'absolute',
    top: 2,
    right: -10,
    backgroundColor: theme.colors.primary.inkMuted,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCountText: {
    color: theme.colors.neutral.white,
    fontFamily: theme.typography.fontMono,
    fontSize: 8,
    lineHeight: 10,
  },
});
