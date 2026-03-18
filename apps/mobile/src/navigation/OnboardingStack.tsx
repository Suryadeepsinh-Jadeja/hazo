import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GoalInputScreen } from '../screens/onboarding/GoalInputScreen';
import { QuestionsScreen } from '../screens/onboarding/QuestionsScreen';
import { GeneratingScreen } from '../screens/onboarding/GeneratingScreen';
import { RoadmapPreviewScreen } from '../screens/onboarding/RoadmapPreviewScreen';
import { theme } from '../../constants/theme';

const Stack = createNativeStackNavigator();

const OnboardingHeader = ({ progress }: { progress: number }) => (
  <View style={styles.headerContainer}>
    <View style={styles.progressBarBg}>
      <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
    </View>
  </View>
);

export const OnboardingStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.neutral.cream },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
        headerTintColor: theme.colors.primary.ink,
      }}
    >
      <Stack.Screen 
        name="GoalInput" 
        component={GoalInputScreen} 
        options={{ headerTitle: () => <OnboardingHeader progress={0.15} /> }} 
      />
      <Stack.Screen 
        name="Questions" 
        component={QuestionsScreen} 
        options={{ headerTitle: () => <OnboardingHeader progress={0.5} /> }} 
      />
      <Stack.Screen 
        name="Generating" 
        component={GeneratingScreen} 
        options={{ headerShown: false, gestureEnabled: false }} 
      />
      <Stack.Screen 
        name="RoadmapPreview" 
        component={RoadmapPreviewScreen} 
        options={{ headerShown: false, gestureEnabled: false }} 
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    width: '100%',
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[16],
  },
  progressBarBg: {
    height: 4,
    backgroundColor: theme.colors.neutral.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: theme.colors.accent.coral,
    borderRadius: 2,
  },
});
