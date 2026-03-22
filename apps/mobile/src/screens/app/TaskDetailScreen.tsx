import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Calendar, CheckCircle2, ChevronLeft, Trash2 } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';

import api from '../../lib/api';
import { theme } from '../../constants/theme';

const MOCK_DETAIL = {
  _id: 'mock-1',
  raw_input: 'Read advanced routing patterns for Next.js',
  due_date: new Date().toISOString(),
  priority: 'high',
  status: 'pending',
};

export const TaskDetailScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { taskId, task: initialTask } = route.params || {};
  const resolvedTaskId = taskId || initialTask?._id;

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [savingDone, setSavingDone] = useState(false);

  useEffect(() => {
    if (initialTask) {
      setTask(initialTask);
      setLoading(false);
      return;
    }

    fetchTask();
  }, [initialTask, resolvedTaskId]);

  const fetchTask = async () => {
    if (!resolvedTaskId) {
      setTask(initialTask || MOCK_DETAIL);
      setLoading(false);
      return;
    }

    try {
      const res = await api.get(`/api/v1/tasks/${resolvedTaskId}`);
      setTask(res.data);
    } catch {
      setTask(initialTask || MOCK_DETAIL);
    } finally {
      setLoading(false);
    }
  };

  const updateTask = async (updates: any) => {
    if (!resolvedTaskId) {
      return;
    }

    const previousTask = task;
    setTask((current: any) => ({ ...current, ...updates }));
    try {
      await api.put(`/api/v1/tasks/${resolvedTaskId}`, updates);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      setTask(previousTask);
    }
  };

  const handleMarkDone = async () => {
    if (!task || task.status === 'done' || !resolvedTaskId) {
      return;
    }

    setSavingDone(true);
    const previousTask = task;
    setTask({ ...task, status: 'done' });
    try {
      await api.post(`/api/v1/tasks/${resolvedTaskId}/complete`);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      setTask(previousTask);
    } finally {
      setSavingDone(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Task', 'This cannot be undone. Delete this task?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (resolvedTaskId) {
              await api.delete(`/api/v1/tasks/${resolvedTaskId}`);
            }
          } catch {}
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          navigation.goBack();
        },
      },
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
            <Text style={styles.dateText}>
              {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}
            </Text>
          </TouchableOpacity>

          <View style={styles.priorityRow}>
            {['low', 'medium', 'high'].map((priority) => (
              <TouchableOpacity
                key={priority}
                style={[styles.pChip, task.priority === priority && styles.pChipActive]}
                onPress={() => updateTask({ priority })}
              >
                <Text
                  style={[
                    styles.pChipText,
                    task.priority === priority && styles.pChipTextActive,
                  ]}
                >
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </Text>
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

        <View style={styles.statusSection}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>
              {task.status === 'done' ? 'Completed' : 'Pending'}
            </Text>
            <Text style={styles.statusSubtext}>
              {task.status === 'done'
                ? 'This task is already marked done.'
                : 'Keep it simple: one task, one finish line.'}
            </Text>

            <TouchableOpacity
              style={[styles.doneButton, task.status === 'done' && styles.doneButtonDisabled]}
              onPress={handleMarkDone}
              disabled={task.status === 'done' || savingDone}
            >
              <CheckCircle2 color={theme.colors.neutral.white} size={18} />
              <Text style={styles.doneButtonText}>
                {savingDone ? 'Saving...' : task.status === 'done' ? 'Done' : 'Mark Done'}
              </Text>
            </TouchableOpacity>
          </View>
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
    marginBottom: theme.spacing[32],
    flexWrap: 'wrap',
    gap: theme.spacing[16],
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[12],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  dateText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    marginLeft: theme.spacing[8],
  },
  priorityRow: {
    flexDirection: 'row',
    gap: theme.spacing[8],
  },
  pChip: {
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
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
  statusSection: {
    marginTop: theme.spacing[8],
  },
  sectionTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[12],
  },
  statusCard: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[20],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  statusLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.primary.ink,
  },
  statusSubtext: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginTop: theme.spacing[8],
    lineHeight: 20,
  },
  doneButton: {
    marginTop: theme.spacing[16],
    backgroundColor: theme.colors.primary.ink,
    borderRadius: theme.borderRadius.sm,
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: theme.spacing[8],
  },
  doneButtonDisabled: {
    backgroundColor: theme.colors.primary.inkMuted,
  },
  doneButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
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
    marginLeft: theme.spacing[8],
  },
});
