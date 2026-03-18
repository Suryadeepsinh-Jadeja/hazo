import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home, CheckCircle, Target, User } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../constants/theme';

const PlaceholderScreen = ({ title }: { title: string }) => (
  <View style={styles.placeholderContainer}>
    <Text style={styles.placeholderText}>{title}</Text>
  </View>
);
const TodayScreen = () => <PlaceholderScreen title="Today" />;
const TasksScreen = () => <PlaceholderScreen title="Tasks" />;
const GoalsScreen = () => <PlaceholderScreen title="Goals" />;
const ProfileScreen = () => <PlaceholderScreen title="Profile" />;

const Tab = createBottomTabNavigator();

export const AppNavigator = () => {
  const insets = useSafeAreaInsets();

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
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
              <View style={styles.badgeDot} />
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
              <View style={styles.badgeCountContainer}>
                <Text style={styles.badgeCountText}>3</Text>
              </View>
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

const styles = StyleSheet.create({
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.cream,
  },
  placeholderText: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
  },
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
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: -4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: theme.colors.accent.coral,
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
