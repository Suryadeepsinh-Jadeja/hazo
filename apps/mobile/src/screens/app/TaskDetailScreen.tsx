import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ChevronLeft, Calendar, Trash2, RotateCcw, CheckSquare, Square } from 'lucide-react-native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';

const MOCK_DETAIL = {
  _id: 'mock-1',
  raw_input: 'Read advanced routing patterns for Next.js',
  due_date: new Date().toISOString(),
  priority: 'high',
  linked_goal_id: 'goal-1',
  ai_subtasks: [
    { subtask_id: 's1', title: 'Find official App Router docs', status: 'done' },
    { subtask_id: 's2', title: 'Read Layouts & Templates section', status: 'pending' },
    { subtask_id: 's3', title: 'Implement a small demo repository', status: 'pending' },
  ],
};

export const TaskDetailScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { taskId } = route.params || {};

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  useEffect(() => {
    fetchTask();
  }, [taskId]);

  const fetchTask = async () => {
    try {
      const res = await api.get(`/api/v1/tasks/${taskId}`);
      setTask(res.data);
    } catch {
      setTask(MOCK_DETAIL);
    } finally {
      setLoading(false);
    }
  };

  const updateTask = async (updates: any) => {
    setTask({ ...task, ...updates });
    try {
      await api.put(`/api/v1/tasks/${taskId}`, updates);
    } catch (e) {
      console.warn('Silent sync error');
    }
  };

  const toggleSubtask = async (subtaskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'pending' ? 'done' : 'pending';
    const newSubtasks = task.ai_subtasks.map((s: any) => 
      s.subtask_id === subtaskId ? { ...s, status: newStatus } : s
    );
    setTask({ ...task, ai_subtasks: newSubtasks });

    try {
      await api.post(`/api/v1/tasks/${taskId}/subtasks/${subtaskId}/toggle`);
    } catch {
      // Mocked updates persist locally in state.
    }
  };

  const handleRegenerate = async () => {
    setRegenLoading(true);
    try {
      const res = await api.post(`/api/v1/tasks/${taskId}/regenerate-subtasks`);
      setTask({ ...task, ai_subtasks: res.data.ai_subtasks });
    } catch {
      setTask({ ...task, ai_subtasks: [{ subtask_id: 'mock-new', title: 'New generated AI step', status: 'pending' }] });
    } finally {
      setRegenLoading(false);
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete Task", "This cannot be undone. Delete this task?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.delete(`/api/v1/tasks/${taskId}`); } catch {}
        navigation.goBack();
      }}
    ]);
  };

  const handleDateChange = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      updateTask({ due_date: selectedDate.toISOString() });
    }
  };

  const openDatePicker = () => {
    const currentValue = task?.due_date ? new Date(task.due_date) : new Date();

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: currentValue,
        mode: 'date',
        onChange: handleDateChange,
      });
      return;
    }

    setShowDatePicker(true);
  };

  if (loading || !task) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accent.coral} />
      </View>
    );
  }

  const completedCount = task.ai_subtasks?.filter((s:any) => s.status === 'done').length || 0;
  const totalSubtasks = task.ai_subtasks?.length || 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft color={theme.colors.primary.ink} size={28} />
        </TouchableOpacity>
        <Text style={styles.headerText}>Task Detail</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <TextInput
          style={styles.titleInput}
          value={task.raw_input}
          onChangeText={(text) => setTask({ ...task, raw_input: text })}
          onEndEditing={() => updateTask({ raw_input: task.raw_input })}
          multiline
        />

        <View style={styles.metaRow}>
          <TouchableOpacity style={styles.datePickerBtn} onPress={openDatePicker}>
             <Calendar color={theme.colors.primary.inkMuted} size={16} />
             <Text style={styles.dateText}>{task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}</Text>
          </TouchableOpacity>

          <View style={styles.priorityRow}>
            {['low', 'medium', 'high'].map(p => (
              <TouchableOpacity key={p} style={[styles.pChip, task.priority === p && styles.pChipActive]} onPress={() => updateTask({ priority: p })}>
                <Text style={[styles.pChipText, task.priority === p && styles.pChipTextActive]}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {Platform.OS === 'ios' && showDatePicker && (
          <DateTimePicker
            value={task.due_date ? new Date(task.due_date) : new Date()}
            mode="date"
            display="default"
            onChange={handleDateChange}
          />
        )}

        <View style={styles.subtasksSection}>
          <View style={styles.subtasksHeaderRow}>
            <Text style={styles.sectionTitle}>AI Subtasks</Text>
            {totalSubtasks > 0 && (
              <Text style={styles.progressText}>{completedCount}/{totalSubtasks} completed</Text>
            )}
          </View>

          {/* Progress Bar inside detail */}
          {totalSubtasks > 0 && (
            <View style={styles.progressBarBg}>
               <View style={[styles.progressBarFill, { width: `${(completedCount / totalSubtasks) * 100}%` }]} />
            </View>
          )}

          {task.ai_subtasks?.map((sub: any) => (
            <TouchableOpacity key={sub.subtask_id} style={styles.subtaskRow} onPress={() => toggleSubtask(sub.subtask_id, sub.status)}>
              {sub.status === 'done' ? (
                <CheckSquare color={theme.colors.positive.sage} size={22} />
              ) : (
                <Square color={theme.colors.neutral.borderMid} size={22} />
              )}
              <Text style={[styles.subtaskText, sub.status === 'done' && styles.subtaskTextDone]}>{sub.title}</Text>
            </TouchableOpacity>
          ))}

          {completedCount === 0 && (
            <TouchableOpacity style={styles.regenButton} onPress={handleRegenerate} disabled={regenLoading}>
              <RotateCcw color={theme.colors.primary.inkMuted} size={16} />
              <Text style={styles.regenText}>{regenLoading ? 'Regenerating...' : 'Regenerate Subtasks'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
           <Trash2 color={theme.colors.danger.rose} size={20} />
           <Text style={styles.deleteButtonText}>Delete Task</Text>
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
  headerText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.primary.ink,
  },
  content: {
    padding: theme.spacing[24],
    paddingBottom: theme.spacing[120],
  },
  titleInput: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[24],
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[48],
    flexWrap: 'wrap',
    gap: theme.spacing[16],
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  dateText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    marginLeft: 8,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    backgroundColor: theme.colors.neutral.white,
  },
  pChipActive: {
    backgroundColor: theme.colors.primary.ink,
    borderColor: theme.colors.primary.ink,
  },
  pChipText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  pChipTextActive: {
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.medium,
  },
  subtasksSection: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[20],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  subtasksHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: theme.spacing[12],
  },
  sectionTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.primary.ink,
  },
  progressText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: theme.colors.neutral.border,
    borderRadius: 2,
    marginBottom: theme.spacing[20],
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: theme.colors.positive.sage,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.spacing[16],
  },
  subtaskText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    flex: 1,
    marginLeft: theme.spacing[12],
    lineHeight: 22,
  },
  subtaskTextDone: {
    textDecorationLine: 'line-through',
    color: theme.colors.primary.inkMuted,
  },
  regenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[12],
    borderWidth: 1,
    borderColor: theme.colors.neutral.borderMid,
    borderStyle: 'dashed',
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing[8],
  },
  regenText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginLeft: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: theme.colors.neutral.cream,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutral.border,
    padding: theme.spacing[24],
    paddingBottom: theme.spacing[48],
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.danger.roseLight,
    paddingVertical: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
  },
  deleteButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.danger.rose,
    fontWeight: theme.typography.fontWeights.semibold,
    marginLeft: 8,
  },
});
