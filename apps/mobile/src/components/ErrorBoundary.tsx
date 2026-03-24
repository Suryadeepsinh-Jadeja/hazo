import React, { ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import RNRestart from 'react-native-restart';
import { AlertTriangle, RefreshCcw } from 'lucide-react-native';
import { theme } from '../constants/theme';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  errorStr: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    errorStr: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorStr: error.toString() };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleRestart = () => {
    RNRestart.Restart();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <AlertTriangle color={theme.colors.danger.rose} size={48} strokeWidth={1.5} />
            </View>
            <Text style={styles.title}>Oops! Something broke.</Text>
            <Text style={styles.subtitle}>
              Hazo encountered an unexpected issue. Don't worry, your progress is safely 
              synced to the cloud.
            </Text>

            <View style={styles.traceBox}>
              <Text style={styles.traceText} numberOfLines={4}>
                 {this.state.errorStr}
              </Text>
            </View>

            <TouchableOpacity style={styles.restartBtn} onPress={this.handleRestart} activeOpacity={0.8}>
              <RefreshCcw color={theme.colors.neutral.white} size={20} />
              <Text style={styles.restartText}>Restart App</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[32],
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.danger.roseLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[24],
    borderWidth: 2,
    borderColor: theme.colors.danger.rose,
  },
  title: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
    textAlign: 'center',
    marginBottom: theme.spacing[16],
    fontWeight: theme.typography.fontWeights.bold,
  },
  subtitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.inkMuted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: theme.spacing[32],
  },
  traceBox: {
    width: '100%',
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[48],
  },
  traceText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.primary.inkMuted,
  },
  restartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary.ink,
    paddingVertical: theme.spacing[16],
    paddingHorizontal: theme.spacing[32],
    borderRadius: theme.borderRadius.sm,
  },
  restartText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
    marginLeft: theme.spacing[12],
  },
});
