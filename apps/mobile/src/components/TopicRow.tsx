import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CheckCircle2, Lock, Circle } from 'lucide-react-native';
import { theme } from '../constants/theme';

export interface TopicRowProps {
  topic: {
    title: string;
    estimated_minutes: number;
    status: string;
  };
  isToday: boolean;
  isLocked: boolean;
  onPress: () => void;
}

export const TopicRow = ({ topic, isToday, isLocked, onPress }: TopicRowProps) => {
  const isDone = topic.status === 'done';

  return (
    <TouchableOpacity 
      style={[
        styles.container, 
        isToday && styles.todayCard,
        isLocked && styles.lockedCard
      ]} 
      onPress={onPress}
      disabled={isLocked}
      activeOpacity={0.7}
    >
      {/* Accent bar for today */}
      {isToday && <View style={styles.todayAccentBar} />}

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          {isDone ? (
            <CheckCircle2 color={theme.colors.accent.coral} size={22} strokeWidth={2.5} />
          ) : isLocked ? (
            <Lock color={theme.colors.neutral.borderMid} size={20} strokeWidth={2} />
          ) : (
            <Circle color={isToday ? theme.colors.accent.coral : theme.colors.primary.inkMuted} size={22} strokeWidth={2} />
          )}
        </View>

        <View style={styles.textContainer}>
          <Text style={[
            styles.title,
            isDone && styles.doneText,
            isLocked && styles.lockedText
          ]} numberOfLines={2}>
            {topic.title}
          </Text>
          <Text style={[styles.timeText, isLocked && styles.lockedText]}>
            {topic.estimated_minutes} min
          </Text>
        </View>

        {isToday && (
           <View style={styles.todayTag}>
             <Text style={styles.todayTagText}>TODAY</Text>
           </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[8],
    overflow: 'hidden',
  },
  todayCard: {
    backgroundColor: theme.colors.neutral.cream, // #FAF8F3
    borderColor: theme.colors.accent.coralLight,
  },
  lockedCard: {
    borderColor: '#D4CFC5', // light dashed approximation
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  todayAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: theme.colors.accent.coral,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[16],
  },
  iconContainer: {
    marginRight: theme.spacing[16],
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.medium,
    lineHeight: 22,
  },
  doneText: {
    color: theme.colors.primary.inkMuted, // #5C5750
  },
  lockedText: {
    color: theme.colors.primary.inkMuted,
    opacity: 0.45,
  },
  timeText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    marginTop: 4,
  },
  todayTag: {
    backgroundColor: theme.colors.accent.coralLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing[12],
  },
  todayTagText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.accent.coral,
    letterSpacing: 0.5,
  },
});
