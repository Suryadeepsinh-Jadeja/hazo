import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';

const MOCK_ROADMAP = {
  total_topics: 12,
  total_phases: 3,
  total_days: 90,
  phases: [
    { title: "Foundations", duration_days: 14, topics: ["Basics of Syntax", "Data Structures", "Simple Algorithms"] },
    { title: "Core Concepts", duration_days: 30, topics: ["System Design", "Advanced Patterns", "Database Indexing"] },
    { title: "Mastery & Practice", duration_days: 46, topics: ["Mock Interviews", "Whiteboard Practice", "Review"] }
  ]
};

export const RoadmapPreviewScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { goalId } = route.params || {};

  const [roadmap, setRoadmap] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRoadmap = async () => {
      try {
        const res = await api.get(`/api/v1/goals/${goalId}`);
        setRoadmap(res.data);
      } catch (err) {
        setRoadmap(MOCK_ROADMAP); // Fallback on error natively handled
      } finally {
        setLoading(false);
      }
    };
    fetchRoadmap();
  }, [goalId]);

  const handleStart = () => {
    navigation.reset({ index: 0, routes: [{ name: 'App' }] });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.accent.coral} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Your Roadmap is Ready</Text>
        <Text style={styles.subtitle}>
          {roadmap.total_topics || MOCK_ROADMAP.total_topics} topics · {roadmap.total_phases || MOCK_ROADMAP.total_phases} phases · {roadmap.total_days || MOCK_ROADMAP.total_days} days
        </Text>

        <View style={styles.timeline}>
          {roadmap.phases?.map((phase: any, index: number) => (
            <View key={index} style={styles.phaseCard}>
              <View style={styles.phaseHeader}>
                <Text style={styles.phaseTitle}>Phase {index + 1}: {phase.title}</Text>
                <Text style={styles.phaseDuration}>{phase.duration_days} days</Text>
              </View>
              
              <View style={styles.topicsList}>
                {phase.topics?.slice(0, 3).map((topic: any, tIdx: number) => {
                  const topicTitle = typeof topic === 'string' ? topic : topic.title;
                  return (
                    <View key={tIdx} style={styles.topicRow}>
                      <View style={styles.topicDot} />
                      <Text style={styles.topicText}>{topicTitle}</Text>
                    </View>
                  );
                })}
                {phase.topics?.length > 3 && (
                  <Text style={styles.moreTopics}>+ {phase.topics?.length - 3} more topics</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.button} onPress={handleStart}>
          <Text style={styles.buttonText}>Looks good, let's start →</Text>
        </TouchableOpacity>
      </View>
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
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: theme.spacing[24],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[120],
  },
  title: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[8],
  },
  subtitle: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginBottom: theme.spacing[32],
  },
  timeline: {
    borderLeftWidth: 2,
    borderColor: theme.colors.neutral.border,
    paddingLeft: theme.spacing[16],
    marginLeft: theme.spacing[8],
  },
  phaseCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[24],
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  phaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing[12],
  },
  phaseTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    flex: 1,
    marginRight: theme.spacing[12],
  },
  phaseDuration: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.accent.coral,
    backgroundColor: theme.colors.accent.coralLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
  },
  topicsList: {
    gap: theme.spacing[8],
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topicDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.neutral.borderMid,
    marginRight: theme.spacing[12],
  },
  topicText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    flex: 1,
  },
  moreTopics: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    fontStyle: 'italic',
    marginTop: theme.spacing[4],
    marginLeft: theme.spacing[16],
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: theme.spacing[24],
    paddingBottom: theme.spacing[48],
    backgroundColor: theme.colors.neutral.cream,
    borderTopWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  button: {
    backgroundColor: theme.colors.accent.coral,
    paddingVertical: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
