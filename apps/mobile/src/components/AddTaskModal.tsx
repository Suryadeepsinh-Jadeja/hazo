import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Dimensions, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { theme } from '../constants/theme';
import api from '../lib/api';

const { height } = Dimensions.get('window');

const DUE_DATES = ['Today', 'Tomorrow', 'This week', 'Custom'];
const PRIORITIES = ['Low', 'Medium', 'High'];

export interface AddTaskModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddTaskModal = ({ visible, onClose, onSuccess }: AddTaskModalProps) => {
  const [taskText, setTaskText] = useState('');
  const [loading, setLoading] = useState(false);
  const [dueDate, setDueDate] = useState('Today');
  const [priority, setPriority] = useState('Medium');
  
  const translateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.poly(4)) });
    }
  }, [visible]);

  const handleClose = () => {
    translateY.value = withTiming(height, { duration: 250 }, () => {
      runOnJS(onClose)();
    });
  };

  const getDueDateISO = (label: string): string | undefined => {
    const now = new Date();
    if (label === 'Today') {
      now.setHours(23, 59, 59, 0);
      return now.toISOString();
    }
    if (label === 'Tomorrow') {
      now.setDate(now.getDate() + 1);
      now.setHours(23, 59, 59, 0);
      return now.toISOString();
    }
    if (label === 'This week') {
      const daysUntilSunday = 7 - now.getDay();
      now.setDate(now.getDate() + (daysUntilSunday || 7));
      now.setHours(23, 59, 59, 0);
      return now.toISOString();
    }
    return undefined; // Custom — no date
  };

  const handleSubmit = async () => {
     if (!taskText.trim()) return;
     setLoading(true);
     try {
       await api.post('/api/v1/tasks', {
         raw_input: taskText,
         due_date: getDueDateISO(dueDate),
         priority: priority.toLowerCase(),
       });
       onSuccess();
       handleClose();
       resetForm();
     } catch (e: any) {
       const msg = e?.response?.data?.detail || e?.message || 'Could not create task';
       Alert.alert('Error', msg);
     } finally {
       setLoading(false);
     }
  };

  const resetForm = () => {
    setTaskText('');
    setDueDate('Today');
    setPriority('Medium');
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }]
  }));

  if (!visible && translateY.value === height) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
       <View style={styles.overlay}>
         <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
         <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
           <Animated.View style={[styles.sheet, animatedStyle]}>
             <View style={styles.dragHandle} />
             
             <TextInput
               style={styles.input}
               placeholder="What needs to get done?"
               placeholderTextColor={theme.colors.neutral.borderMid}
               value={taskText}
               onChangeText={setTaskText}
               multiline
               autoFocus
             />

             <Text style={styles.label}>Due Date</Text>
             <View style={styles.chipRow}>
               {DUE_DATES.map(date => (
                 <TouchableOpacity 
                   key={date} 
                   style={[styles.chip, dueDate === date && styles.chipActive]}
                   onPress={() => setDueDate(date)}
                 >
                   <Text style={[styles.chipText, dueDate === date && styles.chipTextActive]}>{date}</Text>
                 </TouchableOpacity>
               ))}
             </View>

             <Text style={styles.label}>Priority</Text>
             <View style={styles.chipRow}>
               {PRIORITIES.map(p => (
                 <TouchableOpacity 
                   key={p} 
                   style={[styles.chip, priority === p && styles.chipActive]}
                   onPress={() => setPriority(p)}
                 >
                   <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p}</Text>
                 </TouchableOpacity>
               ))}
             </View>

             <TouchableOpacity 
               style={[styles.submitButton, (!taskText.trim() || loading) && styles.submitDisabled]} 
               onPress={handleSubmit} 
               disabled={loading || !taskText.trim()}
             >
                {loading ? (
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <ActivityIndicator color={theme.colors.neutral.white} style={{marginRight: 8}}/>
                    <Text style={styles.submitText}>Breaking into steps...</Text>
                  </View>
                ) : (
                  <Text style={styles.submitText}>Let AI break this down</Text>
                )}
             </TouchableOpacity>
           </Animated.View>
         </KeyboardAvoidingView>
       </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 23, 20, 0.4)',
  },
  sheet: {
    backgroundColor: theme.colors.neutral.white,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing[24],
    paddingBottom: Platform.OS === 'ios' ? 48 : 24,
    shadowColor: theme.colors.primary.ink,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.neutral.borderMid,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing[24],
  },
  input: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: theme.spacing[24],
  },
  label: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: theme.spacing[12],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[8],
    marginBottom: theme.spacing[24],
  },
  chip: {
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[16],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    backgroundColor: theme.colors.neutral.white,
  },
  chipActive: {
    backgroundColor: theme.colors.accent.coralLight,
    borderColor: theme.colors.accent.coral,
  },
  chipText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  chipTextActive: {
    color: theme.colors.accent.coralDark,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  submitButton: {
    backgroundColor: theme.colors.primary.ink,
    paddingVertical: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginTop: theme.spacing[8],
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
