import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { GoalCard } from '../../components/GoalCard';
import { useGoalStore } from '../../store/goalStore';

export const GoalsScreen = () => {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { activeGoalId, setActiveGoalId, setGoals } = useGoalStore();

  const { data: goals, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['goals'],
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: async () => {
      const res = await api.get('/api/v1/goals');
      return res.data;
    }
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      await api.delete(`/api/v1/goals/${goalId}`);
    },
    onSuccess: (_, deletedGoalId) => {
      const remainingGoals = (goals || []).filter((goal: any) => goal._id !== deletedGoalId);
      setGoals(remainingGoals);

      if (activeGoalId === deletedGoalId) {
        setActiveGoalId(remainingGoals[0]?._id || null);
      }

      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['todayTask'] });
      queryClient.invalidateQueries({ queryKey: ['mentorHistory'] });
    },
  });

  useEffect(() => {
    if (!goals?.length) {
      if (activeGoalId) {
        setActiveGoalId(null);
      }
      return;
    }

    setGoals(goals);

    const hasSelectedGoal = goals.some((goal: any) => goal._id === activeGoalId);
    if (!hasSelectedGoal) {
      setActiveGoalId(goals[0]._id);
    }
  }, [activeGoalId, goals, setActiveGoalId, setGoals]);

  const handleAddGoal = () => {
    // Navigates directly into the onboarding stack to establish a new goal
    navigation.navigate('OnboardingStack');
  };

  const handleDeleteGoal = (goal: any) => {
    Alert.alert(
      'Delete Goal',
      `Delete "${goal.title}"? Your roadmap will be removed from the app, but this won't affect your other goals.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteGoalMutation.mutate(goal._id),
        },
      ]
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>What do you want to achieve?</Text>
      <Text style={styles.emptySubtitle}>Hazo works backwards from your big goal to construct daily habits.</Text>
      <TouchableOpacity style={styles.addButtonBig} onPress={handleAddGoal}>
        <Text style={styles.addButtonBigText}>Add my first goal →</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Goals</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddGoal}>
          <Plus color={theme.colors.neutral.white} size={24} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {(!goals || goals.length === 0) && !isLoading ? (
          renderEmpty()
        ) : (
          <View style={styles.listContainer}>
            {goals?.sort((a: any, b: any) => {
              // Active first, then paused, then completed
              const order: Record<string, number> = { active: 1, paused: 2, completed: 3 };
              return order[a.status] - order[b.status];
            }).map((goal: any) => (
              <GoalCard 
                key={goal._id} 
                goal={goal} 
                deleting={deleteGoalMutation.isPending && deleteGoalMutation.variables === goal._id}
                onPress={() => {
                  setActiveGoalId(goal._id);
                  navigation.navigate('RoadmapScreen', { goalId: goal._id });
                }}
                onDelete={() => handleDeleteGoal(goal)}
              />
            ))}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[16],
  },
  headerTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accent.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: theme.spacing[120],
  },
  listContainer: {
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[16],
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[32],
    marginTop: theme.spacing[64],
  },
  emptyTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: 24,
    color: theme.colors.primary.ink,
    textAlign: 'center',
    marginBottom: theme.spacing[12],
  },
  emptySubtitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    textAlign: 'center',
    marginBottom: theme.spacing[32],
    lineHeight: 24,
  },
  addButtonBig: {
    backgroundColor: theme.colors.primary.ink,
    paddingVertical: theme.spacing[16],
    paddingHorizontal: theme.spacing[32],
    borderRadius: theme.borderRadius.sm,
  },
  addButtonBigText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
