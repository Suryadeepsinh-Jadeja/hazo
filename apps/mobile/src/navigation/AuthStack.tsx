import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';

import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { theme } from '../constants/theme';

const ForgotPasswordScreen = () => (
  <View style={styles.fallbackContainer}>
    <Text style={styles.fallbackText}>Forgot Password Screen</Text>
  </View>
);

const Stack = createNativeStackNavigator();

export const AuthStack = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.cream,
  },
  fallbackText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.primary.ink,
  },
});
