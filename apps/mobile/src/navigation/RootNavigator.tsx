import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAuthStore } from '../store/authStore';
import { AuthStack } from './AuthStack';
import { AppNavigator } from './AppNavigator';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GlobalToast } from '../components/Toast';
import { theme } from '../constants/theme';
import { initSentry } from '../lib/sentry';
import { initializeOAuthDeepLinks } from '../lib/supabase';

initSentry();

const queryClient = new QueryClient();

export const RootNavigator = () => {
  const { initialize, isLoading, isAuthenticated } = useAuthStore();

  useEffect(() => {
    initialize();
    const cleanupOAuthDeepLinks = initializeOAuthDeepLinks();

    return () => {
      cleanupOAuthDeepLinks();
    };
  }, [initialize]);

  if (isLoading) {
    return (
      <View style={styles.splashContainer}>
        <ActivityIndicator size="large" color={theme.colors.accent.coral} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.container}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <NavigationContainer>
              {isAuthenticated ? <AppNavigator /> : <AuthStack />}
            </NavigationContainer>
            <GlobalToast />
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
