import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoalInputScreen } from '../screens/onboarding/GoalInputScreen';
import { QuestionsScreen } from '../screens/onboarding/QuestionsScreen';
import { AvailabilitySetupScreen } from '../screens/onboarding/AvailabilitySetupScreen';
import { GeneratingScreen } from '../screens/onboarding/GeneratingScreen';
import { RoadmapPreviewScreen } from '../screens/onboarding/RoadmapPreviewScreen';
import { theme } from '../../constants/theme';

const Stack = createNativeStackNavigator();

const OnboardingHeader = ({ progress }: { progress: number }) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.headerShell,
        {
          paddingTop: insets.top,
        },
      ]}
    >
      <View style={styles.headerContainer}>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
    </View>
  );
};

export const OnboardingStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen 
        name="GoalInput" 
        component={GoalInputScreen} 
        options={{ headerShown: true, header: () => <OnboardingHeader progress={0.15} /> }} 
      />
      <Stack.Screen 
        name="Questions" 
        component={QuestionsScreen} 
        options={{ headerShown: true, header: () => <OnboardingHeader progress={0.5} /> }} 
      />
      <Stack.Screen
        name="AvailabilitySetup"
        component={AvailabilitySetupScreen}
        options={{ headerShown: true, header: () => <OnboardingHeader progress={0.72} /> }}
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
  headerShell: {
    backgroundColor: theme.colors.neutral.cream,
  },
  headerContainer: {
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
