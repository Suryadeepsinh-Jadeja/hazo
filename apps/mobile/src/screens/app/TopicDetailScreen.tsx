import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Clock, Sparkles } from 'lucide-react-native';

import api from '../../lib/api';
import { ResourceCard } from '../../components/ResourceCard';
import { theme } from '../../constants/theme';
import { getGoalVisualTheme } from '../../lib/goalVisuals';
import { goals } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useGoalStore } from '../../store/goalStore';
import { useAuthStore } from '../../store/authStore';

interface TopicResource {
  resource_id?: string;
  type: string;
  title: string;
  url: string;
  source: string;
  is_free: boolean;
}

interface TopicDetail {
  topic_id: string;
  title: string;
  day_index: number;
  estimated_minutes: number;
  ai_note?: string;
  resource_queries?: string[];
  resources?: TopicResource[];
  practice_links?: TopicResource[];
  status: string;
  completed_at?: string;
}

interface LoadedTopicResult {
  goalTitle: string;
  phaseTitle: string;
  topic: TopicDetail | null;
}

const PREPARE_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

export const TopicDetailScreen = () => {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const route = useRoute<any>();
  const { goalId, topicId } = route.params || {};
  const goalThemes = useGoalStore((state) => state.goalThemes);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [goalTitle, setGoalTitle] = useState('');
  const [phaseTitle, setPhaseTitle] = useState('');
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [prepareMode, setPrepareMode] = useState<'prepare' | 'refresh' | null>(null);
  const visualTheme = (goalId ? goalThemes[goalId] : undefined) || getGoalVisualTheme(goalId || goalTitle);

  const completeTopicMutation = useMutation({
    mutationFn: async () => {
      if (!goalId || !topicId) {
        throw new Error('Missing goal or topic');
      }

      return goals.complete(goalId, topicId);
    },
    onSuccess: async (result) => {
      if (user) {
        setUser({
          ...user,
          streak_count: result.streak_count,
          longest_streak: Math.max(user.longest_streak || 0, result.streak_count),
          last_streak_date: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['todayTask'] }),
        queryClient.invalidateQueries({ queryKey: ['goals'] }),
        queryClient.invalidateQueries({ queryKey: ['userProfile'] }),
        queryClient.invalidateQueries({ queryKey: ['userStats'] }),
      ]);
      await loadTopic();
    },
  });

  const applyLoadedTopic = (loadedTopic: LoadedTopicResult | null) => {
    if (!loadedTopic) {
      return;
    }

    setGoalTitle(loadedTopic.goalTitle);
    setPhaseTitle(loadedTopic.phaseTitle);
    setTopic(loadedTopic.topic);
  };

  const fetchTopicDetails = async (): Promise<LoadedTopicResult | null> => {
    if (!goalId || !topicId) {
      return null;
    }

    const response = await api.get(`/api/v1/goals/${goalId}`);
    const goal = response.data;

    let matchedTopic: TopicDetail | null = null;
    let matchedPhaseTitle = '';
    for (const phase of goal.phases || []) {
      const candidate = phase.topics?.find((item: TopicDetail) => item.topic_id === topicId);
      if (candidate) {
        matchedTopic = candidate;
        matchedPhaseTitle = phase.title || '';
        break;
      }
    }

    return {
      goalTitle: goal.title || '',
      phaseTitle: matchedPhaseTitle,
      topic: matchedTopic,
    };
  };

  const loadTopic = async () => {
    if (!goalId || !topicId) {
      setLoading(false);
      return;
    }

    try {
      const loadedTopic = await fetchTopicDetails();
      applyLoadedTopic(loadedTopic);
    } catch (error) {
      console.warn('Failed to load topic details:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopic();
  }, [goalId, topicId]);

  const handlePrepareNow = async () => {
    if (!goalId || !topicId) {
      return;
    }

    const hasAnyExistingLinks =
      Boolean((topic?.resources?.length || 0) + (topic?.practice_links?.length || 0));

    setPreparing(true);
    setPrepareMode(hasAnyExistingLinks ? 'refresh' : 'prepare');
    try {
      const response = await api.post(
        `/api/v1/goals/${goalId}/topics/${topicId}/prepare`,
        null,
        {
          timeout: PREPARE_REQUEST_TIMEOUT_MS,
          params: {
            force: hasAnyExistingLinks,
          },
        }
      );
      setTopic(response.data.topic);
      setPhaseTitle(response.data.phase_title || phaseTitle);
      setGoalTitle(response.data.goal_title || goalTitle);
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ||
        error?.message ||
        'Could not prepare topic resources right now.';
      toast.show(`Could not prepare links: ${detail}`, 'error');
    } finally {
      setPreparing(false);
      setPrepareMode(null);
    }
  };

  const openSearchQuery = async (query: string) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accent.coral} />
      </View>
    );
  }

  if (!topic) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.emptyText}>This topic could not be loaded.</Text>
      </View>
    );
  }

  const materialCount = topic.resources?.length || 0;
  const practiceCount = topic.practice_links?.length || 0;
  const hasPreparedResources = materialCount + practiceCount > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ChevronLeft color={theme.colors.primary.ink} size={28} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {goalTitle || 'Topic'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.heroCard, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }]}>
          <Text style={[styles.phaseLabel, { color: visualTheme.accent }]}>{phaseTitle || 'Roadmap Topic'}</Text>
          <Text style={styles.topicTitle}>{topic.title}</Text>

          <View style={styles.metaRow}>
            <View style={[styles.metaChip, { backgroundColor: visualTheme.surfaceAlt }]}>
              <Clock color={theme.colors.primary.inkMuted} size={14} />
              <Text style={styles.metaText}>{topic.estimated_minutes} min</Text>
            </View>
            <View style={[styles.metaChip, { backgroundColor: visualTheme.surfaceAlt }]}>
              <Text style={styles.metaText}>Day {topic.day_index + 1}</Text>
            </View>
            <View
              style={[
                styles.statusChip,
                { backgroundColor: visualTheme.pillBg },
                topic.status === 'done' && styles.statusChipDone,
                topic.status === 'in_progress' && styles.statusChipActive,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  topic.status === 'done' && styles.statusTextDone,
                  topic.status === 'in_progress' && styles.statusTextActive,
                ]}
              >
                {topic.status.replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.completeButton,
              {
                backgroundColor: topic.status === 'done' ? visualTheme.surfaceAlt : visualTheme.accent,
              },
              completeTopicMutation.isPending && styles.completeButtonPending,
            ]}
            onPress={() => completeTopicMutation.mutate()}
            disabled={completeTopicMutation.isPending || topic.status === 'done' || topic.status === 'skipped'}
          >
            <Text
              style={[
                styles.completeButtonText,
                {
                  color: topic.status === 'done' ? visualTheme.accent : theme.colors.neutral.white,
                },
              ]}
            >
              {topic.status === 'done'
                ? 'Day Complete'
                : completeTopicMutation.isPending
                  ? 'Marking complete...'
                  : 'Mark All Done'}
            </Text>
          </TouchableOpacity>
        </View>

        {!!topic.ai_note && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Why This Topic Now</Text>
            <Text style={styles.noteText}>{topic.ai_note}</Text>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Materials</Text>
            <TouchableOpacity
              style={[styles.prepareButton, { backgroundColor: visualTheme.accent }]}
              onPress={handlePrepareNow}
              disabled={preparing}
            >
              {preparing ? (
                <ActivityIndicator size="small" color={theme.colors.neutral.white} />
              ) : (
                <Sparkles color={theme.colors.neutral.white} size={14} />
              )}
              <Text style={styles.prepareButtonText}>
                {preparing
                  ? prepareMode === 'refresh'
                    ? 'Refreshing...'
                    : 'Preparing...'
                  : hasPreparedResources
                    ? 'Refresh Links'
                    : 'Prepare Now'}
              </Text>
            </TouchableOpacity>
          </View>

          {materialCount > 0 ? (
            <>
              {topic.resources?.map((resource) => (
                <ResourceCard
                  key={resource.resource_id || `${resource.url}-${resource.title}`}
                  resource={resource}
                />
              ))}
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {hasPreparedResources ? 'No concept materials yet' : 'Links are not prepared yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {hasPreparedResources
                  ? 'Try refreshing to fetch better explainers, or jump into the practice links below.'
                  : 'You can prepare resources now, or use the search prompts below while Hazo catches up.'}
              </Text>
            </View>
          )}
        </View>

        {practiceCount > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Practice</Text>
            {topic.practice_links?.map((resource) => (
              <ResourceCard
                key={resource.resource_id || `${resource.url}-${resource.title}-practice`}
                resource={resource}
              />
            ))}
          </View>
        )}

        {!!topic.resource_queries?.length && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Search Prompts</Text>
            <View style={styles.queryList}>
              {topic.resource_queries.map((query) => (
                <TouchableOpacity
                  key={query}
                  style={styles.queryChip}
                  onPress={() => openSearchQuery(query)}
                >
                  <Text style={styles.queryChipText}>{query}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.cream,
    padding: theme.spacing[24],
  },
  emptyText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[16],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[16],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.border,
  },
  backButton: {
    padding: theme.spacing[4],
  },
  headerTitle: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.primary.ink,
    marginHorizontal: theme.spacing[8],
  },
  headerSpacer: {
    width: 28,
  },
  scrollContent: {
    padding: theme.spacing[24],
    paddingBottom: theme.spacing[64],
  },
  heroCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[20],
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[20],
  },
  phaseLabel: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.accent.coral,
    marginBottom: theme.spacing[8],
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  topicTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[16],
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[8],
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.cream,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
  },
  metaText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    marginLeft: theme.spacing[6],
  },
  statusChip: {
    backgroundColor: theme.colors.neutral.cream,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
  },
  statusChipDone: {
    backgroundColor: theme.colors.positive.sageLight,
  },
  statusChipActive: {
    backgroundColor: theme.colors.accent.coralLight,
  },
  statusText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  statusTextDone: {
    color: theme.colors.positive.sageDark,
  },
  statusTextActive: {
    color: theme.colors.accent.coralDark,
  },
  completeButton: {
    marginTop: theme.spacing[16],
    minHeight: 52,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[16],
  },
  completeButtonPending: {
    opacity: 0.75,
  },
  completeButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  section: {
    marginBottom: theme.spacing[24],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  sectionTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[12],
  },
  noteText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    lineHeight: 24,
  },
  emptyCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    padding: theme.spacing[16],
  },
  emptyTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[8],
  },
  emptyBody: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    lineHeight: 20,
  },
  prepareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary.ink,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    borderRadius: theme.borderRadius.full,
  },
  prepareButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.neutral.white,
    marginLeft: theme.spacing[6],
    fontWeight: theme.typography.fontWeights.semibold,
  },
  queryList: {
    gap: theme.spacing[10],
  },
  queryChip: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[12],
  },
  queryChipText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
});
