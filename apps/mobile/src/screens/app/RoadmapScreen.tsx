import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TouchableWithoutFeedback } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronDown, ChevronUp, BotMessageSquare } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { TopicRow } from '../../components/TopicRow';
import { useGoalStore } from '../../store/goalStore';

export const RoadmapScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { goalId } = route.params || {};
  const { setActiveGoalId } = useGoalStore();

  const [roadmap, setRoadmap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({});

  const fabScale = useSharedValue(1);

  useEffect(() => {
    if (goalId) {
      setActiveGoalId(goalId);
    }
    fetchRoadmap();
  }, [goalId, setActiveGoalId]);

  const fetchRoadmap = async () => {
    try {
      const res = await api.get(`/api/v1/goals/${goalId}`);
      setRoadmap(res.data);
      // Auto-expand the active phase, collapse others
      const collapseMap: Record<string, boolean> = {};
      const phases = res.data.phases || [];
      phases.forEach((p: any, idx: number) => {
         const hasActiveTopics = p.topics?.some((t: any) => 
           t.status === 'in_progress' || t.status === 'pending'
         );
         collapseMap[p.phase_id || `p-${idx}`] = !hasActiveTopics;
      });
      setCollapsedPhases(collapseMap);
    } catch (err) {
      console.warn('Failed to fetch roadmap:', err);
    } finally {
      setLoading(false);
    }
  };

  const togglePhase = (phaseId: string) => {
    setCollapsedPhases(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const onPressInFab = () => { fabScale.value = withTiming(0.95, { duration: 100 }); };
  const onPressOutFab = () => { fabScale.value = withTiming(1, { duration: 100 }); };
  const handleFabPress = () => navigation.navigate('MentorScreen', { goalId });

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }]
  }));

  if (loading || !roadmap) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accent.coral} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Navbar Option header for back button + top right utility */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ChevronLeft color={theme.colors.primary.ink} size={28} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{roadmap.title}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('SkillsScreen', { goalId })}>
          <Text style={styles.headerAction}>Skills Graph</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
         {/* Timeline */}
         <View style={styles.timelineContainer}>
            {roadmap.phases.map((phase: any, index: number) => {
               const phaseKey = phase.phase_id || `phase-${index}`;
               const isCollapsed = collapsedPhases[phaseKey];
               const total = phase.topics.length;
               const done = phase.topics.filter((t:any) => t.status === 'done').length;

               return (
                 <View key={phaseKey} style={styles.phaseBlock}>
                   <TouchableOpacity style={styles.phaseHeader} onPress={() => togglePhase(phaseKey)} activeOpacity={0.7}>
                      <View style={styles.phaseHeaderLeft}>
                        {isCollapsed ? <ChevronDown color={theme.colors.primary.ink} size={20} /> : <ChevronUp color={theme.colors.primary.ink} size={20} />}
                        <Text style={styles.phaseTitle}>Phase {index + 1}: {phase.title}</Text>
                      </View>
                      <Text style={styles.phaseProgress}>{done}/{total}</Text>
                   </TouchableOpacity>

                   {!isCollapsed && (
                     <View style={styles.topicsList}>
                        <View style={styles.verticalTimelineStem} />
                        {phase.topics.map((topic: any) => (
                           <View key={topic.topic_id} style={styles.topicRowWrapper}>
                             <TopicRow 
                               topic={topic} 
                               isToday={topic.day_index === roadmap.current_day_index}
                               isLocked={topic.status === 'locked'}
                               onPress={() =>
                                 navigation.navigate('TopicDetailScreen', {
                                   goalId,
                                   topicId: topic.topic_id,
                                 })
                               } 
                             />
                           </View>
                        ))}
                     </View>
                   )}
                 </View>
               );
            })}
         </View>
      </ScrollView>

      {/* FAB Mentor Button */}
      <TouchableWithoutFeedback onPressIn={onPressInFab} onPressOut={onPressOutFab} onPress={handleFabPress}>
        <Animated.View style={[styles.fab, fabAnimatedStyle]}>
           <BotMessageSquare color={theme.colors.neutral.white} size={24} />
           {!roadmap.mentor_visited_today && <View style={styles.fabBadge} />}
        </Animated.View>
      </TouchableWithoutFeedback>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    textAlign: 'center',
    marginHorizontal: theme.spacing[8],
  },
  headerAction: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.accent.coral,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  scrollContent: {
    padding: theme.spacing[24],
    paddingBottom: 100, // accommodate FAB
  },
  timelineContainer: {
     flex: 1,
  },
  phaseBlock: {
    marginBottom: theme.spacing[16],
  },
  phaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  phaseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  phaseTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    marginLeft: theme.spacing[12],
    fontWeight: theme.typography.fontWeights.semibold,
  },
  phaseProgress: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
  },
  topicsList: {
    marginTop: theme.spacing[16],
    paddingLeft: theme.spacing[12], // indent relative to phase
  },
  verticalTimelineStem: {
    position: 'absolute',
    left: 20, // aligns under the chevron visually or near it
    top: 0,
    bottom: 20,
    width: 2,
    backgroundColor: theme.colors.neutral.border,
    zIndex: -1,
  },
  topicRowWrapper: {
    marginLeft: theme.spacing[24],
  },
  fab: {
    position: 'absolute',
    bottom: theme.spacing[32],
    right: theme.spacing[24],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary.ink, // #1A1714
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fabBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent.coral,
    borderWidth: 1.5,
    borderColor: theme.colors.primary.ink,
  },
});
