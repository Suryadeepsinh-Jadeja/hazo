import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Flame, Trash2 } from 'lucide-react-native';
import { theme } from '../constants/theme';
import { getGoalVisualTheme } from '../lib/goalVisuals';

export interface GoalCardProps {
  goal: {
    _id?: string;
    title: string;
    current_day_index: number;
    total_days: number;
    status: 'active' | 'paused' | 'completed' | 'abandoned';
    timeline_target?: string;
  };
  onPress: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

export const GoalCard = ({ goal, onPress, onDelete, deleting = false }: GoalCardProps) => {
  const currentDay = Math.min((goal.current_day_index || 0) + 1, goal.total_days || 1);
  const targetDate = goal.timeline_target
    ? new Date(goal.timeline_target).toLocaleDateString()
    : null;
  const visualTheme = getGoalVisualTheme(goal._id || goal.title);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: visualTheme.surface,
          borderColor: visualTheme.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>{goal.title}</Text>
        <View style={[
            styles.statusBadge, 
            goal.status === 'active' && styles.activeBadge,
            goal.status === 'paused' && styles.pausedBadge,
            goal.status === 'completed' && styles.completedBadge
          ]}>
          <Text style={[
            styles.statusText, 
            goal.status === 'active' && styles.activeText,
            goal.status === 'paused' && styles.pausedText,
            goal.status === 'completed' && styles.completedText
          ]}>
            {goal.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.phaseText} numberOfLines={1}>
          {targetDate ? `Target ${targetDate}` : 'Active roadmap'}
        </Text>
        <Text style={styles.daysText}>Day {currentDay} of {goal.total_days}</Text>
      </View>

      <View style={styles.progressBarBg}>
        <View
          style={[
            styles.progressBarFill,
            { backgroundColor: visualTheme.accent },
            { width: `${Math.min(100, (currentDay / (goal.total_days || 1)) * 100)}%` },
          ]}
        />
      </View>

      <View style={[styles.streakRow, { backgroundColor: visualTheme.pillBg }]}>
        <Flame color={visualTheme.pillText} size={16} strokeWidth={2.5} />
        <Text style={[styles.streakText, { color: visualTheme.pillText }]}>{currentDay}/{goal.total_days} complete</Text>
      </View>

      {onDelete ? (
        <TouchableOpacity
          style={[
            styles.deleteButton,
            {
              borderColor: visualTheme.accent,
              backgroundColor: visualTheme.surfaceAlt,
            },
            deleting && styles.deleteButtonDisabled,
          ]}
          onPress={onDelete}
          disabled={deleting}
          activeOpacity={0.85}
        >
          <Trash2 color={visualTheme.accent} size={16} />
          <Text style={[styles.deleteButtonText, { color: visualTheme.accent }]}>
            {deleting ? 'Deleting...' : 'Delete Goal'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[20],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[16],
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing[20],
  },
  title: {
    flex: 1,
    flexShrink: 1,
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    marginRight: theme.spacing[12],
    fontWeight: theme.typography.fontWeights.bold,
    lineHeight: 34,
  },
  statusBadge: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.neutral.borderMid,
  },
  statusText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.bold,
    letterSpacing: 0.5,
    color: theme.colors.primary.inkMuted,
  },
  activeBadge: {
    backgroundColor: theme.colors.positive.sageLight,
  },
  activeText: {
    color: theme.colors.positive.sageDark,
  },
  pausedBadge: {
    backgroundColor: theme.colors.warning.amberLight,
  },
  pausedText: {
    color: theme.colors.warning.amberDark,
  },
  completedBadge: {
    backgroundColor: theme.colors.neutral.cream,
  },
  completedText: {
    color: theme.colors.primary.ink,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: theme.spacing[8],
  },
  phaseText: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginRight: theme.spacing[8],
  },
  daysText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: theme.colors.neutral.border,
    borderRadius: 2,
    marginBottom: theme.spacing[16],
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: theme.colors.active?.indigo || '#4F46E5',
    borderRadius: 2,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.warning.amberLight,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
  },
  streakText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.accent.coralDark,
    marginLeft: 6,
    fontWeight: theme.typography.fontWeights.bold,
  },
  deleteButton: {
    marginTop: theme.spacing[16],
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.neutral.cream,
    borderWidth: 1,
    borderColor: theme.colors.danger.rose,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    marginLeft: 6,
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.danger.rose,
  },
});
