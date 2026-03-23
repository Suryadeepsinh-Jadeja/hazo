import React, { useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Plus,
  Trash2,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { AddTaskModal } from '../../components/AddTaskModal';

type TaskStatus = 'pending' | 'done' | 'abandoned' | 'overdue';
type TaskPriority = 'low' | 'medium' | 'high';

interface TaskItem {
  _id: string;
  raw_input: string;
  due_date?: string | null;
  priority?: TaskPriority;
  status: TaskStatus;
}

interface TaskSection {
  key: string;
  title: string;
  tint: string;
  tasks: TaskItem[];
}

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfToday = () => {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
};

const endOfTomorrow = () => {
  const date = endOfToday();
  date.setDate(date.getDate() + 1);
  return date;
};

const formatSectionDate = (date: Date) =>
  date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const formatDueText = (task: TaskItem) => {
  if (!task.due_date) {
    return 'No due date';
  }

  const dueDate = new Date(task.due_date);
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const tomorrowEnd = endOfTomorrow();

  if (dueDate < todayStart) {
    return 'Yesterday';
  }

  if (dueDate >= todayStart && dueDate <= todayEnd) {
    return 'Today';
  }

  if (dueDate > todayEnd && dueDate <= tomorrowEnd) {
    return 'Tomorrow';
  }

  return formatSectionDate(dueDate);
};

const getSectionTint = (key: string) => {
  switch (key) {
    case 'past':
      return theme.colors.accent.coral;
    case 'today':
      return theme.colors.active.indigo;
    case 'tomorrow':
      return theme.colors.warning.amber;
    case 'upcoming':
      return theme.colors.primary.ink;
    case 'no-date':
      return theme.colors.primary.inkMuted;
    default:
      return theme.colors.primary.ink;
  }
};

const getPriorityTone = (priority?: TaskPriority) => {
  switch (priority) {
    case 'high':
      return theme.colors.danger.rose;
    case 'medium':
      return theme.colors.warning.amber;
    case 'low':
    default:
      return theme.colors.positive.sage;
  }
};

const buildSections = (tasks: TaskItem[]): { activeSections: TaskSection[]; completedTasks: TaskItem[] } => {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const tomorrowEnd = endOfTomorrow();

  const groups: Record<string, TaskItem[]> = {
    past: [],
    today: [],
    tomorrow: [],
    upcoming: [],
    'no-date': [],
  };

  const completedTasks: TaskItem[] = [];

  tasks.forEach((task) => {
    if (task.status === 'done') {
      completedTasks.push(task);
      return;
    }

    if (!task.due_date) {
      groups['no-date'].push(task);
      return;
    }

    const dueDate = new Date(task.due_date);
    if (dueDate < todayStart) {
      groups.past.push(task);
      return;
    }

    if (dueDate >= todayStart && dueDate <= todayEnd) {
      groups.today.push(task);
      return;
    }

    if (dueDate > todayEnd && dueDate <= tomorrowEnd) {
      groups.tomorrow.push(task);
      return;
    }

    groups.upcoming.push(task);
  });

  const sectionConfig = [
    { key: 'past', title: 'Past' },
    { key: 'today', title: 'Today' },
    { key: 'tomorrow', title: 'Tomorrow' },
    { key: 'upcoming', title: 'Upcoming' },
    { key: 'no-date', title: 'No date' },
  ];

  const activeSections = sectionConfig
    .map((section) => ({
      key: section.key,
      title: section.title,
      tint: getSectionTint(section.key),
      tasks: groups[section.key].sort((left, right) => {
        const leftTime = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      }),
    }))
    .filter((section) => section.tasks.length > 0);

  completedTasks.sort((left, right) => {
    const leftTime = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER;
    return rightTime - leftTime;
  });

  return { activeSections, completedTasks };
};

export const TasksScreen = () => {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();

  const [modalVisible, setModalVisible] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  const {
    data: tasks = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<TaskItem[]>({
    queryKey: ['tasks'],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const response = await api.get('/api/v1/tasks');
      return response.data;
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (task: TaskItem) => api.post(`/api/v1/tasks/${task._id}/complete`),
    onSuccess: () => {
      ReactNativeHapticFeedback.trigger('impactMedium');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => api.delete(`/api/v1/tasks/${taskId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const { activeSections, completedTasks } = useMemo(() => buildSections(tasks), [tasks]);

  const handleComplete = (task: TaskItem) => {
    if (task.status === 'done' || completeMutation.isPending) {
      return;
    }

    completeMutation.mutate(task);
  };

  const handleDelete = (taskId: string) => {
    Alert.alert('Delete Task', 'Remove this task from your list?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(taskId),
      },
    ]);
  };

  const renderRightActions = (taskId: string) => (
    <View style={styles.swipeRight}>
      <Trash2 color={theme.colors.neutral.white} size={20} />
      <Text style={styles.swipeText}>Delete</Text>
    </View>
  );

  const renderTaskRow = (task: TaskItem, done = false) => {
    const isCompleting = completeMutation.isPending && completeMutation.variables?._id === task._id;
    const priorityColor = getPriorityTone(task.priority);

    return (
      <Swipeable
        key={task._id}
        renderRightActions={() => renderRightActions(task._id)}
        onSwipeableOpen={(direction) => {
          if (direction === 'right') {
            handleDelete(task._id);
          }
        }}
      >
        <TouchableOpacity
          style={styles.taskRow}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('TaskDetailScreen', { taskId: task._id, task })}
        >
          <TouchableOpacity
            style={[styles.checkboxButton, done && styles.checkboxButtonDone]}
            activeOpacity={0.85}
            onPress={() => handleComplete(task)}
            disabled={done || isCompleting}
          >
            {done || isCompleting ? (
              <CheckCircle2 color={done ? theme.colors.positive.sageDark : theme.colors.accent.coral} size={20} />
            ) : (
              <Circle color={priorityColor} size={18} />
            )}
          </TouchableOpacity>

          <View style={styles.taskTextWrap}>
            <Text style={[styles.taskTitle, done && styles.taskTitleDone]} numberOfLines={2}>
              {task.raw_input}
            </Text>
            <View style={styles.taskMetaRow}>
              <Text style={[styles.taskMeta, done && styles.taskMetaDone]}>{formatDueText(task)}</Text>
              <View style={[styles.priorityPill, { backgroundColor: `${priorityColor}18` }]}>
                <View style={[styles.priorityPillDot, { backgroundColor: priorityColor }]} />
                <Text style={[styles.priorityPillText, { color: priorityColor }]}>
                  {(task.priority || 'low').toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isLoading || isRefetching} onRefresh={refetch} tintColor={theme.colors.accent.coral} />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Tasks</Text>
            <Text style={styles.headerSubtitle}>Simple lists, grouped by when they need your attention.</Text>
          </View>
        </View>

        {activeSections.length === 0 && completedTasks.length === 0 && !isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing on your plate.</Text>
            <Text style={styles.emptyBody}>Add a task and it will appear in the right date section automatically.</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => setModalVisible(true)}>
              <Text style={styles.emptyButtonText}>Add a task</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {activeSections.map((section) => (
          <View key={section.key} style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: section.tint }]}>{section.title}</Text>
            <View style={styles.sectionTasks}>
              {section.tasks.map((task) => renderTaskRow(task))}
            </View>
          </View>
        ))}

        {completedTasks.length > 0 && (
          <View style={styles.completedCard}>
            <TouchableOpacity
              style={styles.completedHeader}
              activeOpacity={0.85}
              onPress={() => setCompletedExpanded((current) => !current)}
            >
              <Text style={styles.completedTitle}>Completed ({completedTasks.length})</Text>
              {completedExpanded ? (
                <ChevronUp color={theme.colors.primary.inkMuted} size={22} />
              ) : (
                <ChevronDown color={theme.colors.primary.inkMuted} size={22} />
              )}
            </TouchableOpacity>

            {completedExpanded ? (
              <View style={styles.sectionTasks}>
                {completedTasks.map((task) => renderTaskRow(task, true))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} activeOpacity={0.9} onPress={() => setModalVisible(true)}>
        <Plus color={theme.colors.neutral.white} size={28} />
      </TouchableOpacity>

      <AddTaskModal visible={modalVisible} onClose={() => setModalVisible(false)} onSuccess={refetch} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[20],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[120],
  },
  header: {
    marginBottom: theme.spacing[16],
  },
  headerTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: 28,
    color: theme.colors.primary.ink,
    lineHeight: 34,
  },
  headerSubtitle: {
    marginTop: theme.spacing[4],
    maxWidth: 300,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    lineHeight: 22,
  },
  sectionCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    paddingHorizontal: theme.spacing[16],
    paddingTop: theme.spacing[16],
    paddingBottom: theme.spacing[4],
    marginBottom: theme.spacing[12],
  },
  sectionTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: 16,
    marginBottom: theme.spacing[6],
  },
  sectionTasks: {
    gap: 0,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing[10],
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutral.border,
  },
  checkboxButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[10],
    backgroundColor: theme.colors.neutral.white,
    marginTop: 1,
  },
  checkboxButtonDone: {
    backgroundColor: theme.colors.positive.sageLight,
  },
  taskTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: 15,
    lineHeight: 20,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.medium,
  },
  taskTitleDone: {
    color: theme.colors.primary.inkMuted,
    textDecorationLine: 'line-through',
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[6],
    marginTop: theme.spacing[6],
  },
  taskMeta: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  taskMetaDone: {
    color: theme.colors.neutral.borderMid,
  },
  priorityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[2],
  },
  priorityPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: theme.spacing[6],
  },
  priorityPillText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 11,
    fontWeight: theme.typography.fontWeights.bold,
    letterSpacing: 0.5,
  },
  completedCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    paddingHorizontal: theme.spacing[16],
    paddingTop: theme.spacing[16],
    paddingBottom: theme.spacing[8],
    marginBottom: theme.spacing[12],
  },
  completedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: theme.spacing[12],
  },
  completedTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: 18,
    color: theme.colors.primary.ink,
  },
  emptyCard: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    padding: theme.spacing[24],
    alignItems: 'flex-start',
    marginBottom: theme.spacing[16],
  },
  emptyTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: 24,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[10],
  },
  emptyBody: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    lineHeight: 24,
    marginBottom: theme.spacing[20],
  },
  emptyButton: {
    backgroundColor: theme.colors.accent.coral,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[20],
    paddingVertical: theme.spacing[12],
  },
  emptyButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  fab: {
    position: 'absolute',
    right: theme.spacing[24],
    bottom: theme.spacing[32],
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: theme.colors.accent.coral,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  swipeRight: {
    backgroundColor: theme.colors.danger.rose,
    borderRadius: theme.borderRadius.xl,
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginBottom: theme.spacing[2],
    paddingRight: theme.spacing[24],
  },
  swipeText: {
    marginTop: theme.spacing[4],
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
