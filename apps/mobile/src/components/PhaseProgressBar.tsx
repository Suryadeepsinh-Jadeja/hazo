import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { theme } from '../constants/theme';

export interface PhaseProgressBarProps {
  currentDay: number;
  totalDays: number;
  phaseTitle: string;
}

export const PhaseProgressBar = ({ currentDay, totalDays, phaseTitle }: PhaseProgressBarProps) => {
  const progressPercent = Math.min(100, Math.max(0, (currentDay / totalDays) * 100));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{phaseTitle}</Text>
        <Text style={styles.ratio}>Day {currentDay} of {totalDays}</Text>
      </View>
      
      <View style={styles.barBg}>
        <LinearGradient
          colors={[theme.colors.active?.indigo || '#4F46E5', theme.colors.primary.ink]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.barFill, { width: `${progressPercent}%` }]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: theme.spacing[16],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  title: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginRight: theme.spacing[8],
  },
  ratio: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  barBg: {
    height: 4,
    backgroundColor: theme.colors.neutral.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
});
