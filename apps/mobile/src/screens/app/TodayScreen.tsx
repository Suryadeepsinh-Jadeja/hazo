import React, { useCallback, useState, useEffect, memo, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import LinearGradient from 'react-native-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat, withDelay, Easing } from 'react-native-reanimated';
import { PlayCircle, FileText, CheckCircle, Flame, Plus, Lock, Clock, BookOpen } from 'lucide-react-native';
import { Linking } from 'react-native';

import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { useGoalStore } from '../../store/goalStore';

// --- Types ---
interface Resource {
  type: string;
  title: string;
  url: string;
}

interface Topic {
  topic_id: string;
  title: string;
  estimated_minutes: number;
  ai_note: string;
  resources: Resource[];
  practice_links: Resource[];
  status: string;
}

interface DailyTaskCard {
  goal_id: string;
  date: string;
  topics: Topic[];
  available_minutes: number;
  task_mode_count: number;
  phase_title: string;
  day_index: number;
  total_days: number;
  goal_title: string;
}

// --- Animated Shimmer Skeleton ---
const Skeleton = memo(({ width, height, style, borderRadius = theme.borderRadius.sm }: any) => {
  const opacity = useSharedValue(0.3);
  
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 800 }),
        withTiming(0.3, { duration: 800 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[{ width, height, backgroundColor: theme.colors.neutral.borderMid, borderRadius }, style, animatedStyle]} />
  );
});

// --- Confetti Particle ---
const ConfettiParticle = memo(({ active, color, angle, distance, delay }: any) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (active) {
      progress.value = 0;
      progress.value = withDelay(delay, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    }
  }, [active]);

  const animatedStyle = useAnimatedStyle(() => {
    const translateX = Math.cos(angle) * distance * progress.value;
    const translateY = Math.sin(angle) * distance * progress.value;
    return {
      transform: [
        { translateX },
        { translateY },
        { scale: Math.max(0, 1 - progress.value) }
      ],
      opacity: Math.max(0, 1 - progress.value),
    };
  });

  return (
    <Animated.View style={[{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: color }, animatedStyle]} />
  );
});

// --- Main Screen ---
export const TodayScreen = () => {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { activeGoalId } = useGoalStore();

  const [confettiActive, setConfettiActive] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [simplifyModalVisible, setSimplifyModalVisible] = useState(false);

  // Time-based Greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  // Fetch Data
  const { data: taskCard, isLoading, isError, refetch, isRefetching } = useQuery<DailyTaskCard>({
    queryKey: ['todayTask', activeGoalId],
    queryFn: async () => {
      const res = await api.get(`/api/v1/goals/${activeGoalId}/today`);
      return res.data;
    },
    enabled: !!activeGoalId,
  });

  const primaryTopic = taskCard?.topics?.[0];

  // Mutations
  const completeMutation = useMutation({
    mutationFn: async (topicId: string) => {
      await api.post(`/api/v1/goals/${activeGoalId}/topics/${topicId}/complete`);
    },
    onSuccess: () => {
      setConfettiActive(true);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 3000);
      setTimeout(() => setConfettiActive(false), 3500);
      queryClient.invalidateQueries({ queryKey: ['todayTask', activeGoalId] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      queryClient.invalidateQueries({ queryKey: ['userStats'] });
    }
  });

  const simplifyMutation = useMutation({
    mutationFn: async (topicId: string) => {
      await api.post(`/api/v1/goals/${activeGoalId}/topics/${topicId}/skip`);
    },
    onSuccess: () => {
      setSimplifyModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['todayTask', activeGoalId] });
    }
  });

  // Handlers
  const handleMarkDone = useCallback(() => {
    if (primaryTopic?.topic_id) {
      completeMutation.mutate(primaryTopic.topic_id);
    }
  }, [completeMutation, primaryTopic?.topic_id]);

  const handleAskMentor = useCallback(() => {
    navigation.navigate('Mentor', { goalId: activeGoalId });
  }, [navigation, activeGoalId]);

  const handleOpenLink = useCallback(async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  }, []);

  // Sub-renders
  const renderSkeleton = () => (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Skeleton width={200} height={24} />
        <Skeleton width={40} height={24} borderRadius={12} />
      </View>
      <Skeleton width="100%" height={4} style={{ marginVertical: 16 }} />
      <View style={styles.heroSkeleton}>
        <Skeleton width={100} height={16} style={{ marginBottom: 12 }} />
        <Skeleton width="80%" height={28} style={{ marginBottom: 16 }} />
        <Skeleton width="100%" height={14} style={{ marginBottom: 8 }} />
        <Skeleton width="90%" height={14} style={{ marginBottom: 24 }} />
        <Skeleton width="100%" height={56} borderRadius={theme.borderRadius.sm} />
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.centerContainer}>
      <Text style={styles.emptyText}>No active goal.</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Goals')}>
        <Text style={styles.primaryButtonText}>Add one in Goals →</Text>
      </TouchableOpacity>
    </View>
  );

  const renderError = () => (
    <View style={styles.centerContainer}>
      <Text style={styles.errorText}>Couldn't load your task.</Text>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => refetch()}>
        <Text style={styles.secondaryButtonText}>Pull to refresh</Text>
      </TouchableOpacity>
    </View>
  );

  if (!activeGoalId && !isLoading) return renderEmpty();
  if (isLoading) return renderSkeleton();
  if (isError || !taskCard) return renderError();

  const confettiColors = [theme.colors.accent.coral, theme.colors.positive.sage, theme.colors.warning.amber, theme.colors.danger.rose];

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.colors.accent.coral} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.greetingText}>{greeting}, {user?.name?.split(' ')[0] || 'there'}</Text>
          <View style={styles.streakBadge}>
            <Flame color={theme.colors.accent.coralDark} size={14} strokeWidth={2.5} />
            <Text style={styles.streakText}>{user?.streak_count || 0}</Text>
          </View>
        </View>

        {/* Phase Progress */}
        <View style={styles.progressContainer}>
          <View style={styles.progressTextRow}>
            <Text style={styles.phaseTitleText}>{taskCard.phase_title || taskCard.goal_title || 'Today'}</Text>
            <Text style={styles.dayIndexText}>Day {(taskCard.day_index || 0) + 1} of {taskCard.total_days || '—'}</Text>
          </View>
          <View style={styles.progressBarBg}>
             <View style={[styles.progressBarFill, { width: `${Math.min(100, (((taskCard.day_index || 0) + 1) / Math.max(taskCard.total_days || 1, 1)) * 100)}%` }]} />
          </View>
        </View>

        {/* Hero Card */}
        <View style={styles.heroCard}>
          {/* Confetti Animation Layer */}
          <View style={{ position: 'absolute', top: '50%', left: '50%', zIndex: 100 }} pointerEvents="none">
             {Array.from({ length: 20 }).map((_, i) => (
               <ConfettiParticle 
                 key={i} 
                 active={confettiActive} 
                 color={confettiColors[i % confettiColors.length]} 
                 angle={(Math.PI * 2 * i) / 20} 
                 distance={80 + Math.random() * 60} 
                 delay={Math.random() * 100}
               />
             ))}
          </View>

          <LinearGradient
            colors={[theme.colors.accent.coral, theme.colors.primary.ink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradientHeader}
          >
            <Text style={styles.phaseLabel}>TODAY'S TASK • DAY {(taskCard.day_index || 0) + 1}</Text>
            <Text style={styles.topicTitle}>{primaryTopic?.title || 'No Tasks Today'}</Text>
            
            <View style={styles.timeChip}>
              <Clock color={theme.colors.primary.ink} size={12} />
              <Text style={styles.timeChipText}>~{primaryTopic?.estimated_minutes || 0} min</Text>
            </View>
          </LinearGradient>

          <View style={styles.heroBody}>
            {primaryTopic?.ai_note && (
              <Text style={styles.aiNote}>"{primaryTopic.ai_note}"</Text>
            )}

            {primaryTopic?.resources?.slice(0, 2).map((res, i) => (
              <TouchableOpacity key={i} style={styles.resourceRow} onPress={() => handleOpenLink(res.url)}>
                {res.type === 'video' ? <PlayCircle color={theme.colors.primary.inkMuted} size={18} /> : <BookOpen color={theme.colors.primary.inkMuted} size={18} />}
                <Text style={styles.resourceText} numberOfLines={1}>{res.title}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity 
              style={[styles.doneButton, completeMutation.isPending && { opacity: 0.7 }]} 
              onPress={handleMarkDone}
              disabled={completeMutation.isPending || !primaryTopic?.topic_id}
            >
              <Text style={styles.doneButtonText}>{completeMutation.isPending ? 'Completing...' : 'Mark as Done ✓'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ghostButton} onPress={handleAskMentor}>
              <Text style={styles.ghostButtonText}>Ask AI Mentor</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Adjusting load */}
        <TouchableOpacity style={styles.tooMuchLink} onPress={() => setSimplifyModalVisible(true)}>
          <Text style={styles.tooMuchText}>Too much today?</Text>
        </TouchableOpacity>

        {/* Task List Section */}
        {taskCard.topics?.length > 1 && (
          <View style={styles.tasksSection}>
            <Text style={styles.sectionHeader}>Your Tasks Today ({taskCard.task_mode_count})</Text>
            {taskCard.topics.slice(1).map((topic, i) => (
              <View key={topic.topic_id || i} style={styles.secondaryTopicCard}>
                 <Text style={styles.secondaryTopicTitle}>{topic.title}</Text>
                 <Text style={styles.secondaryTopicMins}>{topic.estimated_minutes} min</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Toast Overlay */}
      {toastVisible && (
        <Animated.View style={styles.toast}>
          <Text style={styles.toastText}>🔥 {(user?.streak_count || 0) + 1} day streak!</Text>
        </Animated.View>
      )}

      {/* Simplify Modal */}
      <Modal visible={simplifyModalVisible} transparent animationType="slide">
         <View style={styles.modalOverlay}>
           <View style={styles.bottomSheet}>
             <Text style={styles.modalTitle}>Too much today?</Text>
             <Text style={styles.modalBody}>No problem. For now, Stride can skip today&apos;s top topic and move you forward without breaking the plan.</Text>
             
             <TouchableOpacity style={styles.primaryButton} onPress={() => primaryTopic?.topic_id && simplifyMutation.mutate(primaryTopic.topic_id)} disabled={simplifyMutation.isPending || !primaryTopic?.topic_id}>
                <Text style={styles.primaryButtonText}>{simplifyMutation.isPending ? 'Skipping...' : 'Skip Top Task'}</Text>
             </TouchableOpacity>
             
             <TouchableOpacity style={styles.cancelButton} onPress={() => setSimplifyModalVisible(false)} disabled={simplifyMutation.isPending}>
                <Text style={styles.cancelButtonText}>Nevermind, I got this</Text>
             </TouchableOpacity>
           </View>
         </View>
      </Modal>
    </View>
  );
};

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    paddingTop: theme.spacing[48],
  },
  centerContainer: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing[24],
  },
  scrollContent: {
    padding: theme.spacing[24],
    paddingBottom: theme.spacing[64],
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[24],
  },
  greetingText: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.warning.amberLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  streakText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.accent.coralDark,
    marginLeft: 4,
    fontWeight: theme.typography.fontWeights.bold,
  },
  progressContainer: {
    marginBottom: theme.spacing[32],
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[8],
  },
  phaseTitleText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  dayIndexText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: theme.colors.neutral.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4F46E5', // "indigo" as requested in prompt
    borderRadius: 2,
  },
  heroSkeleton: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[24],
    borderRadius: theme.borderRadius.lg,
    marginHorizontal: theme.spacing[24],
  },
  heroCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    marginBottom: theme.spacing[16],
    overflow: 'hidden',
  },
  heroGradientHeader: {
    padding: theme.spacing[24],
    borderBottomWidth: 0,
  },
  phaseLabel: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: theme.spacing[8],
  },
  topicTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: 22,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.neutral.white,
    marginBottom: theme.spacing[16],
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    alignSelf: 'flex-start',
  },
  timeChipText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.ink,
    marginLeft: 4,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  heroBody: {
    padding: theme.spacing[24],
  },
  aiNote: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    fontStyle: 'italic',
    marginBottom: theme.spacing[20],
    lineHeight: 22,
  },
  resourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
    backgroundColor: theme.colors.neutral.cream,
    padding: theme.spacing[12],
    borderRadius: theme.borderRadius.sm,
  },
  resourceText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    marginLeft: theme.spacing[8],
    flex: 1,
  },
  doneButton: {
    backgroundColor: '#4F46E5', // indigo
    height: 56,
    borderRadius: theme.borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing[16],
  },
  doneButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  ghostButton: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing[8],
  },
  ghostButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    fontWeight: theme.typography.fontWeights.medium,
  },
  tooMuchLink: {
    alignSelf: 'center',
    marginBottom: theme.spacing[32],
  },
  tooMuchText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    textDecorationLine: 'underline',
  },
  tasksSection: {
    marginTop: theme.spacing[16],
  },
  sectionHeader: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[16],
  },
  secondaryTopicCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[8],
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  secondaryTopicTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    flex: 1,
    marginRight: theme.spacing[12],
  },
  secondaryTopicMins: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: theme.colors.primary.ink,
    paddingHorizontal: theme.spacing[20],
    paddingVertical: theme.spacing[12],
    borderRadius: theme.borderRadius.full,
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 999,
  },
  toastText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.bold,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 23, 20, 0.4)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: theme.colors.neutral.white,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing[24],
    paddingBottom: theme.spacing[48],
  },
  modalTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[12],
  },
  modalBody: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    lineHeight: 22,
    marginBottom: theme.spacing[24],
  },
  primaryButton: {
    backgroundColor: theme.colors.primary.ink,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  primaryButtonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  secondaryButton: {
    backgroundColor: theme.colors.neutral.cream,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  secondaryButtonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.primary.ink,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.medium,
  },
  cancelButton: {
    padding: theme.spacing[16],
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.primary.inkMuted,
    fontSize: theme.typography.fontSizes.base,
  },
  emptyText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.inkMuted,
    marginBottom: theme.spacing[24],
  },
  errorText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.danger.rose,
    marginBottom: theme.spacing[24],
  },
});
