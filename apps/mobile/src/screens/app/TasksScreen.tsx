import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Swipeable } from 'react-native-gesture-handler';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Trash2 } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { AddTaskModal } from '../../components/AddTaskModal';
import * as Haptics from 'expo-haptics';

const FILTERS = ['All', 'Today', 'Overdue', 'Done'];

const MOCK_TASKS = [
  { _id: '1', raw_input: 'Read advanced routing patterns', priority: 'high', status: 'pending', due_date: 'Today', ai_subtasks: [{}, {}] },
  { _id: '2', raw_input: 'Update goal intake', priority: 'medium', status: 'pending', due_date: 'Tomorrow', ai_subtasks: [{}, {}, {}] },
  { _id: '3', raw_input: 'Review PRs', priority: 'low', status: 'done', due_date: 'Yesterday', ai_subtasks: [{}] },
];

export const TasksScreen = () => {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('All');
  const [modalVisible, setModalVisible] = useState(false);

  const { data: tasks, isLoading, refetch } = useQuery({
    queryKey: ['tasks', activeFilter],
    queryFn: async () => {
      try {
        const res = await api.get(`/api/v1/tasks?filter=${activeFilter.toLowerCase()}`);
        return res.data;
      } catch {
        return MOCK_TASKS;
      }
    }
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/api/v1/tasks/${id}/complete`),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/v1/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const handleSwipeComplete = (id: string) => completeMutation.mutate(id);
  
  const handleSwipeDelete = (id: string) => {
    Alert.alert("Delete Task", "Are you sure you want to remove this task?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) }
    ]);
  };

  const getPriorityColor = (priority: string) => {
    if (priority === 'high') return theme.colors.danger.rose;
    if (priority === 'medium') return theme.colors.warning.amber;
    return theme.colors.positive.sage;
  };

  const renderRightActions = (id: string) => (
    <View style={styles.swipeRight}>
      <Trash2 color={theme.colors.neutral.white} size={24} />
      <Text style={styles.swipeText}>Delete</Text>
    </View>
  );

  const renderLeftActions = (id: string) => (
    <View style={styles.swipeLeft}>
      <Check color={theme.colors.neutral.white} size={24} />
      <Text style={styles.swipeText}>Done</Text>
    </View>
  );

  const renderTask = ({ item }: { item: any }) => {
    const isDone = item.status === 'done';
    const subtaskCount = item.ai_subtasks?.length || 0;
    const completedSubtasks = item.ai_subtasks?.filter((s:any) => s.status === 'done').length || 0;

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(item._id)}
        renderLeftActions={() => renderLeftActions(item._id)}
        onSwipeableOpen={(direction) => {
          if (direction === 'left') handleSwipeComplete(item._id);
          if (direction === 'right') handleSwipeDelete(item._id);
        }}
      >
        <TouchableOpacity 
          style={[styles.taskCard, isDone && { opacity: 0.6 }]} 
          onPress={() => navigation.navigate('TaskDetailScreen', { taskId: item._id })}
          activeOpacity={0.8}
        >
          <View style={styles.taskCardRow}>
            <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(item.priority) }]} />
            <Text style={[styles.taskTitle, isDone && styles.textStrikethrough]} numberOfLines={1}>
              {item.raw_input}
            </Text>
            {subtaskCount > 0 && (
              <View style={styles.progressChip}>
                <Text style={styles.progressChipText}>{completedSubtasks}/{subtaskCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.taskDueDate}>{item.due_date ? String(item.due_date) : 'No due date'}</Text>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No tasks here.</Text>
      <Text style={styles.emptySubtext}>Add something below to get started.</Text>
      <TouchableOpacity style={styles.emptyButton} onPress={() => setModalVisible(true)}>
        <Text style={styles.emptyButtonText}>+ Add a Task</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Tasks</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
          <Plus color={theme.colors.neutral.white} size={24} />
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map(f => (
            <TouchableOpacity 
              key={f} 
              style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
              onPress={() => setActiveFilter(f)}
            >
              <Text style={[styles.filterChipText, activeFilter === f && styles.filterChipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* List */}
      <View style={{ flex: 1 }}>
        <FlashList
          data={tasks || []}
          renderItem={renderTask}
          keyExtractor={(it: any) => it._id}
          estimatedItemSize={76}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
          ListEmptyComponent={isLoading ? null : renderEmpty}
        />
      </View>

      <AddTaskModal 
        visible={modalVisible} 
        onClose={() => setModalVisible(false)} 
        onSuccess={refetch} 
      />
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
    backgroundColor: theme.colors.neutral.cream,
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
  filterContainer: {
    marginBottom: theme.spacing[4],
  },
  filterScroll: {
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[16],
    gap: theme.spacing[8],
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    backgroundColor: theme.colors.neutral.white,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary.ink,
    borderColor: theme.colors.primary.ink,
  },
  filterChipText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  filterChipTextActive: {
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.medium,
  },
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[48],
  },
  taskCard: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[12],
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  taskCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: theme.spacing[12],
  },
  taskTitle: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.medium,
  },
  textStrikethrough: {
    textDecorationLine: 'line-through',
    color: theme.colors.primary.inkMuted,
  },
  progressChip: {
    backgroundColor: theme.colors.neutral.cream,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: theme.spacing[8],
  },
  progressChipText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.primary.inkMuted,
  },
  taskDueDate: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    marginTop: theme.spacing[8],
    marginLeft: 20, // aligns with title (8 + 12 gap)
  },
  swipeRight: {
    backgroundColor: theme.colors.danger.rose,
    justifyContent: 'center',
    alignItems: 'flex-end',
    width: '100%',
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[12],
    paddingRight: theme.spacing[24],
  },
  swipeLeft: {
    backgroundColor: theme.colors.positive.sage,
    justifyContent: 'center',
    alignItems: 'flex-start',
    width: '100%',
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[12],
    paddingLeft: theme.spacing[24],
  },
  swipeText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.sm,
    fontWeight: theme.typography.fontWeights.semibold,
    marginTop: 4,
  },
  emptyContainer: {
    paddingTop: theme.spacing[64],
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[8],
  },
  emptySubtext: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    marginBottom: theme.spacing[32],
  },
  emptyButton: {
    backgroundColor: theme.colors.primary.ink,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
  },
  emptyButtonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
