import React, { useCallback, useState, useEffect, memo, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import LinearGradient from 'react-native-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat, withDelay, Easing } from 'react-native-reanimated';
import { PlayCircle, Flame, Clock, BookOpen, CheckCircle2 } from 'lucide-react-native';
import { Linking } from 'react-native';

import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

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

interface GoalSummary {
  _id: string;
  title: string;
  status: string;
}

interface PersonalTask {
  _id: string;
  raw_input: string;
  due_date?: string | null;
  priority?: 'low' | 'medium' | 'high';
  status: string;
}

const getTodayDisplayMaterials = (topic?: Topic) => {
  if (!topic) {
    return [];
  }

  const conceptVideos = (topic.resources || [])
    .filter((resource) => resource.type === 'video')
    .slice(0, 2);
  const supportingLinks = [
    ...(topic.practice_links || []),
    ...(topic.resources || []).filter((resource) => resource.type !== 'video'),
  ].slice(0, 2);

  return [...conceptVideos, ...supportingLinks];
};

const getTomorrowEnd = () => {
  const tomorrowEnd = new Date();
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  tomorrowEnd.setHours(23, 59, 59, 999);
  return tomorrowEnd;
};

const formatTaskDueLabel = (dueDate?: string | null) => {
  if (!dueDate) {
    return 'No due date';
  }

  const due = new Date(dueDate);
  const today = new Date();
  const todayLabel = new Date();
  todayLabel.setHours(0, 0, 0, 0);
  const tomorrowLabel = new Date(todayLabel);
  tomorrowLabel.setDate(tomorrowLabel.getDate() + 1);
  const dueLabel = new Date(due);
  dueLabel.setHours(0, 0, 0, 0);

  if (dueLabel.getTime() < todayLabel.getTime()) {
    return 'Overdue';
  }

  if (dueLabel.getTime() === todayLabel.getTime()) {
    return 'Due today';
  }

  if (dueLabel.getTime() === tomorrowLabel.getTime()) {
    return 'Due tomorrow';
  }

  return `Due ${due.toLocaleDateString()}`;
};

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

  const [confettiActive, setConfettiActive] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [simplifyTarget, setSimplifyTarget] = useState<{ goalId: string; topicId: string } | null>(null);
  const [completingGoalId, setCompletingGoalId] = useState<string | null>(null);

  // Time-based Greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  // Fetch Data
  const {
    data: goals = [],
    isLoading: isGoalsLoading,
    refetch: refetchGoals,
    isRefetching: isGoalsRefetching,
  } = useQuery<GoalSummary[]>({
    queryKey: ['goals'],
    queryFn: async () => {
      const res = await api.get('/api/v1/goals');
      return res.data;
    },
  });

  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === 'active'),
    [goals]
  );

  const todayGoalQueries = useQueries({
    queries: activeGoals.map((goal) => ({
      queryKey: ['todayTask', goal._id],
      queryFn: async (): Promise<DailyTaskCard> => {
        const res = await api.get(`/api/v1/goals/${goal._id}/today`);
        return res.data;
      },
      enabled: !!goal._id,
    })),
  });

  const goalCards = useMemo(
    () =>
      activeGoals.map((goal, index) => ({
        goal,
        query: todayGoalQueries[index],
        taskCard: todayGoalQueries[index]?.data as DailyTaskCard | undefined,
        primaryTopic: (todayGoalQueries[index]?.data as DailyTaskCard | undefined)?.topics?.[0],
      })),
    [activeGoals, todayGoalQueries]
  );

  const isTodayGoalsRefetching = todayGoalQueries.some((query) => query.isRefetching);

  const {
    data: allTasks = [],
    isLoading: isTasksLoading,
    isRefetching: isTasksRefetching,
    refetch: refetchTasks,
  } = useQuery<PersonalTask[]>({
    queryKey: ['tasks', 'home-feed'],
    queryFn: async () => {
      const res = await api.get('/api/v1/tasks');
      return res.data;
    },
  });

  const personalTasks = useMemo(() => {
    const tomorrowEnd = getTomorrowEnd();

    return allTasks
      .filter((task) => {
        if (!task || task.status === 'done' || task.status === 'abandoned') {
          return false;
        }

        if (!task.due_date) {
          return false;
        }

        return new Date(task.due_date) <= tomorrowEnd;
      })
      .sort((a, b) => {
        const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
      });
  }, [allTasks]);

  const refreshHome = useCallback(async () => {
    await Promise.all([
      refetchTasks(),
      refetchGoals(),
      ...todayGoalQueries.map((query) => query.refetch()),
    ]);
  }, [refetchGoals, refetchTasks, todayGoalQueries]);

  // Mutations
  const completeMutation = useMutation({
    mutationFn: async ({ goalId, topicId }: { goalId: string; topicId: string }) => {
      await api.post(`/api/v1/goals/${goalId}/topics/${topicId}/complete`);
    },
    onMutate: ({ goalId }) => {
      setCompletingGoalId(goalId);
    },
    onSuccess: () => {
      setConfettiActive(true);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 3000);
      setTimeout(() => setConfettiActive(false), 3500);
      queryClient.invalidateQueries({ queryKey: ['todayTask'] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      queryClient.invalidateQueries({ queryKey: ['userStats'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onSettled: () => {
      setCompletingGoalId(null);
    },
  });

  const simplifyMutation = useMutation({
    mutationFn: async ({ goalId, topicId }: { goalId: string; topicId: string }) => {
      await api.post(`/api/v1/goals/${goalId}/topics/${topicId}/skip`);
    },
    onSuccess: () => {
      setSimplifyTarget(null);
      queryClient.invalidateQueries({ queryKey: ['todayTask'] });
    }
  });

  // Handlers
  const handleMarkDone = useCallback((goalId: string, topicId?: string) => {
    if (topicId) {
      completeMutation.mutate({ goalId, topicId });
    }
  }, [completeMutation]);

  const handleAskMentor = useCallback((goalId: string, topicTitle?: string) => {
    navigation.navigate('Mentor', { goalId, topicTitle });
  }, [navigation]);

  const handleOpenLink = useCallback(async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  }, []);

  const handleOpenTask = useCallback((task: PersonalTask) => {
    navigation.navigate('TaskDetailScreen', { taskId: task._id, task });
  }, [navigation]);

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

  if (isGoalsLoading && isTasksLoading) return renderSkeleton();

  const confettiColors = [theme.colors.accent.coral, theme.colors.positive.sage, theme.colors.warning.amber, theme.colors.danger.rose];

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isGoalsRefetching || isTodayGoalsRefetching || isTasksRefetching}
            onRefresh={refreshHome}
            tintColor={theme.colors.accent.coral}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.greetingText}>{greeting}, {user?.name?.split(' ')[0] || 'there'}</Text>
          <View style={styles.streakBadge}>
            <Flame color={theme.colors.accent.coralDark} size={14} strokeWidth={2.5} />
            <Text style={styles.streakText}>{user?.streak_count || 0}</Text>
          </View>
        </View>

        {goalCards.length > 0 && (
          <View style={styles.tasksSection}>
            <Text style={styles.sectionHeader}>Today Across Your Goals</Text>
            <Text style={styles.sectionSubheader}>Each active goal gets its own daily task card here.</Text>
          </View>
        )}

        {goalCards.map(({ goal, query, taskCard, primaryTopic }, goalIndex) => (
          <View key={goal._id} style={styles.goalSection}>
            {query?.isError ? (
              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Couldn&apos;t load {goal.title}</Text>
                <Text style={styles.infoCardBody}>
                  Pull to refresh or open the goal directly from the Goals tab.
                </Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => query.refetch()}>
                  <Text style={styles.secondaryButtonText}>Retry Goal</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {taskCard ? (
              <>
                {(() => {
                  const displayMaterials = getTodayDisplayMaterials(primaryTopic);
                  const isCompletingThisGoal = completeMutation.isPending && completingGoalId === goal._id;

                  return (
                    <>
                <View style={styles.progressContainer}>
                  <View style={styles.progressTextRow}>
                    <Text style={styles.phaseTitleText}>{taskCard.goal_title || goal.title}</Text>
                    <Text style={styles.dayIndexText}>Day {(taskCard.day_index || 0) + 1} of {taskCard.total_days || '—'}</Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(
                            100,
                            (((taskCard.day_index || 0) + 1) / Math.max(taskCard.total_days || 1, 1)) * 100
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.heroCard}>
                  {goalIndex === 0 && confettiActive && (
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
                  )}

                  <LinearGradient
                    colors={[theme.colors.accent.coral, theme.colors.primary.ink]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.heroGradientHeader}
                  >
                    <Text style={styles.phaseLabel}>TODAY&apos;S TASK • DAY {(taskCard.day_index || 0) + 1}</Text>
                    <Text style={styles.goalLabel}>{taskCard.goal_title || goal.title}</Text>
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

                    {displayMaterials.map((res, i) => (
                      <TouchableOpacity key={i} style={styles.resourceRow} onPress={() => handleOpenLink(res.url)}>
                        {res.type === 'video' ? <PlayCircle color={theme.colors.primary.inkMuted} size={18} /> : <BookOpen color={theme.colors.primary.inkMuted} size={18} />}
                        <Text style={styles.resourceText} numberOfLines={1}>{res.title}</Text>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={[styles.doneButton, isCompletingThisGoal && { opacity: 0.7 }]}
                      onPress={() => handleMarkDone(goal._id, primaryTopic?.topic_id)}
                      disabled={isCompletingThisGoal || !primaryTopic?.topic_id}
                    >
                      <Text style={styles.doneButtonText}>{isCompletingThisGoal ? 'Completing...' : 'Mark as Done ✓'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.ghostButton}
                      onPress={() => handleAskMentor(goal._id, primaryTopic?.title || taskCard.goal_title || goal.title)}
                    >
                      <Text style={styles.ghostButtonText}>Ask AI Mentor</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.tooMuchLink}
                  onPress={() => primaryTopic?.topic_id && setSimplifyTarget({ goalId: goal._id, topicId: primaryTopic.topic_id })}
                >
                  <Text style={styles.tooMuchText}>Too much today?</Text>
                </TouchableOpacity>

                {taskCard.topics?.length > 1 && (
                  <View style={styles.tasksSection}>
                    <Text style={styles.sectionHeader}>Coming Up In {taskCard.goal_title || goal.title}</Text>
                    {taskCard.topics.slice(1).map((topic, i) => (
                      <View key={topic.topic_id || i} style={styles.secondaryTopicCard}>
                         <Text style={styles.secondaryTopicTitle}>{topic.title}</Text>
                         <Text style={styles.secondaryTopicMins}>{topic.estimated_minutes} min</Text>
                      </View>
                    ))}
                  </View>
                )}
                    </>
                  );
                })()}
              </>
            ) : !query?.isLoading ? (
              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>No goal task ready for {goal.title}</Text>
                <Text style={styles.infoCardBody}>
                  The roadmap still exists, but this goal does not have a daily card ready right now.
                </Text>
              </View>
            ) : null}
          </View>
        ))}

        {activeGoals.length === 0 && (
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>No active goal yet</Text>
            <Text style={styles.infoCardBody}>
              You can still work through your personal tasks here, and add a goal when you want Stride to plan the bigger roadmap.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Goals')}>
              <Text style={styles.primaryButtonText}>Open Goals</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.tasksSection}>
          <Text style={styles.sectionHeader}>Your Personal Tasks</Text>
          <Text style={styles.sectionSubheader}>Incomplete tasks due today, tomorrow, or already overdue.</Text>

          {personalTasks.length > 0 ? (
            personalTasks.map((task) => (
              <TouchableOpacity
                key={task._id}
                style={styles.personalTaskCard}
                onPress={() => handleOpenTask(task)}
                activeOpacity={0.85}
              >
                <View style={styles.personalTaskRow}>
                  <View style={styles.personalTaskTitleWrap}>
                    <Text style={styles.personalTaskTitle}>{task.raw_input}</Text>
                    <Text style={styles.personalTaskMeta}>{formatTaskDueLabel(task.due_date)}</Text>
                  </View>
                  <CheckCircle2
                    color={task.status === 'overdue' ? theme.colors.danger.rose : theme.colors.primary.inkMuted}
                    size={20}
                  />
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.infoCardAlt}>
              <Text style={styles.infoCardAltText}>No personal tasks due today or tomorrow.</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Toast Overlay */}
      {toastVisible && (
        <Animated.View style={styles.toast}>
          <Text style={styles.toastText}>🔥 {(user?.streak_count || 0) + 1} day streak!</Text>
        </Animated.View>
      )}

      {/* Simplify Modal */}
      <Modal visible={!!simplifyTarget} transparent animationType="slide">
         <View style={styles.modalOverlay}>
           <View style={styles.bottomSheet}>
             <Text style={styles.modalTitle}>Too much today?</Text>
             <Text style={styles.modalBody}>No problem. For now, Stride can skip today&apos;s top topic and move you forward without breaking the plan.</Text>
             
             <TouchableOpacity
               style={styles.primaryButton}
               onPress={() => simplifyTarget && simplifyMutation.mutate(simplifyTarget)}
               disabled={simplifyMutation.isPending || !simplifyTarget}
             >
                <Text style={styles.primaryButtonText}>{simplifyMutation.isPending ? 'Skipping...' : 'Skip Top Task'}</Text>
             </TouchableOpacity>
             
             <TouchableOpacity style={styles.cancelButton} onPress={() => setSimplifyTarget(null)} disabled={simplifyMutation.isPending}>
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
  goalSection: {
    marginBottom: theme.spacing[24],
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
  goalLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: 'rgba(255, 255, 255, 0.85)',
    marginBottom: theme.spacing[8],
    fontWeight: theme.typography.fontWeights.medium,
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
  sectionSubheader: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginTop: -theme.spacing[8],
    marginBottom: theme.spacing[16],
  },
  personalTaskCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[10],
  },
  personalTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[12],
  },
  personalTaskTitleWrap: {
    flex: 1,
  },
  personalTaskTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[4],
  },
  personalTaskMeta: {
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
  infoCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    padding: theme.spacing[20],
    marginBottom: theme.spacing[20],
  },
  infoCardTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[8],
  },
  infoCardBody: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    lineHeight: 22,
    marginBottom: theme.spacing[16],
  },
  infoCardAlt: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    padding: theme.spacing[16],
  },
  infoCardAltText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
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
