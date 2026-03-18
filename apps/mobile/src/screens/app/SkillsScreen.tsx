import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Dimensions, ActivityIndicator } from 'react-native';
import { DownloadCloud, AlertCircle } from 'lucide-react-native';
import { useQuery } from '@react-navigation/native';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { RadarChart } from '../../components/RadarChart';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

const { width } = Dimensions.get('window');

interface Skill {
  skill_id: string;
  name: string;
  mastery_level: number;
  last_practiced: string;
}

export const SkillsScreen = () => {
  const { user } = useAuthStore();
  const goalId = 'mock-goal-id'; // Pulled from a global activeGoalId state in production

  const { data: skills, isLoading } = useReactQuery<Skill[]>({
    queryKey: ['skills', goalId],
    queryFn: async () => {
      const res = await api.get(`/api/v1/skills/${goalId}`);
      return res.data;
    }
  });

  const handleExport = () => {
    if (user?.plan !== 'pro') {
      Alert.alert(
        "Pro Feature", 
        "Exporting your Skill Graph and raw JSON analytics requires Stride Pro.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upgrade to Pro", style: "default" }
        ]
      );
    } else {
      Alert.alert("Exporting", "Your skills profile is being downloaded.");
    }
  };

  const getStatusColor = (mastery: number) => {
    if (mastery >= 80) return theme.colors.warning.amber; // "gold" advanced
    if (mastery >= 50) return theme.colors.positive.sage; // green mastered 
    if (mastery > 0) return theme.colors.active?.indigo || '#4F46E5'; // blue in progress
    return theme.colors.neutral.borderMid; // gray not started
  };

  const getStatusLabel = (mastery: number) => {
    if (mastery >= 80) return "Advanced";
    if (mastery >= 50) return "Mastered";
    if (mastery > 0) return "In Progress";
    return "Not Started";
  };

  const checkDecay = (lastPracticed: string) => {
    const daysSince = Math.floor((new Date().getTime() - new Date(lastPracticed).getTime()) / (1000 * 3600 * 24));
    return daysSince > 25;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accent.coral} />
      </View>
    );
  }

  const chartSkills = skills?.map(s => ({
    name: s.name,
    masteryLevel: s.mastery_level
  })) || [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Skills</Text>
        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
          <DownloadCloud color={theme.colors.primary.ink} size={20} />
          {user?.plan !== 'pro' && <View style={styles.proBadge} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Radar Chart */}
        <View style={styles.chartSection}>
           <RadarChart skills={chartSkills} size={width - 48} />
        </View>

        {/* Legend */}
        {skills && skills.length > 0 && (
          <View style={styles.legendContainer}>
             <View style={styles.legendItem}>
               <View style={[styles.legendColor, { backgroundColor: theme.colors.neutral.borderMid }]} />
               <Text style={styles.legendText}>Not Started</Text>
             </View>
             <View style={styles.legendItem}>
               <View style={[styles.legendColor, { backgroundColor: '#4F46E5' }]} />
               <Text style={styles.legendText}>In Progress</Text>
             </View>
             <View style={styles.legendItem}>
               <View style={[styles.legendColor, { backgroundColor: theme.colors.positive.sage }]} />
               <Text style={styles.legendText}>Mastered</Text>
             </View>
             <View style={styles.legendItem}>
               <View style={[styles.legendColor, { backgroundColor: theme.colors.warning.amber }]} />
               <Text style={styles.legendText}>Advanced</Text>
             </View>
          </View>
        )}

        {/* Skills List */}
        <View style={styles.listSection}>
          {skills?.map((skill) => {
            const isDecaying = checkDecay(skill.last_practiced);
            const statusColor = getStatusColor(skill.mastery_level);

            return (
              <View key={skill.skill_id} style={styles.skillCard}>
                <View style={styles.skillHeader}>
                   <View style={styles.skillNameWrap}>
                     <Text style={styles.skillName}>{skill.name}</Text>
                     {isDecaying && (
                       <View style={styles.decayBadge}>
                         <AlertCircle color={theme.colors.danger.rose} size={10} style={{marginRight: 2}} />
                         <Text style={styles.decayText}>Needs review</Text>
                       </View>
                     )}
                   </View>
                   <Text style={[styles.masteryPercent, { color: statusColor }]}>
                     {Math.round(skill.mastery_level)}%
                   </Text>
                </View>

                <View style={styles.progressBg}>
                   <View style={[styles.progressFill, { width: `${skill.mastery_level}%`, backgroundColor: statusColor }]} />
                </View>

                <View style={styles.skillFooter}>
                   <Text style={styles.statusLabel}>{getStatusLabel(skill.mastery_level)}</Text>
                   <Text style={styles.lastPracticed}>Last: {new Date(skill.last_practiced).toLocaleDateString()}</Text>
                </View>
              </View>
            );
          })}
        </View>
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
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[16],
    backgroundColor: theme.colors.neutral.cream,
  },
  headerTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
  },
  exportButton: {
    padding: theme.spacing[8],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  proBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.warning.amber,
    borderWidth: 2,
    borderColor: theme.colors.neutral.cream,
  },
  scrollContent: {
    paddingBottom: theme.spacing[48],
  },
  chartSection: {
    marginVertical: theme.spacing[24],
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.spacing[16],
    paddingHorizontal: theme.spacing[24],
    marginBottom: theme.spacing[32],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendColor: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    textTransform: 'uppercase',
  },
  listSection: {
    paddingHorizontal: theme.spacing[24],
  },
  skillCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[12],
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  skillHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  skillNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skillName: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  decayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.danger.roseLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing[8],
  },
  decayText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 9,
    color: theme.colors.danger.rose,
    textTransform: 'uppercase',
  },
  masteryPercent: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.bold,
  },
  progressBg: {
    height: 6,
    backgroundColor: theme.colors.neutral.border,
    borderRadius: 3,
    marginBottom: theme.spacing[8],
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  skillFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  lastPracticed: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.primary.inkMuted,
  },
});
