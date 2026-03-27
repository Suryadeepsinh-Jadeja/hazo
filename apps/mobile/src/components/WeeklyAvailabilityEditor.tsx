import React, { useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { X } from 'lucide-react-native';

import { theme } from '../constants/theme';
import {
  DISPLAY_DAYS,
  WEEKDAYS,
  WeeklyAvailability,
  Weekday,
  TimeBlock,
  formatTimeLabel,
  formatTimeValue,
  getDefaultBlock,
  sortBlocks,
  summarizeBlocks,
  timeStringToDate,
  validateBlocks,
} from '../lib/availability';

type TimeField = 'start' | 'end';

interface WeeklyAvailabilityEditorProps {
  availability: WeeklyAvailability;
  onChange: (availability: WeeklyAvailability) => void;
  title?: string;
  subtitle?: string;
}

export const WeeklyAvailabilityEditor = ({
  availability,
  onChange,
  title = 'My Schedule',
  subtitle = 'Set exact learning windows for each day, with as many blocks as you need.',
}: WeeklyAvailabilityEditorProps) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [draftBlocks, setDraftBlocks] = useState<TimeBlock[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [editingBlockField, setEditingBlockField] = useState<{ blockIndex: number; field: TimeField } | null>(null);
  const [iosPickerValue, setIosPickerValue] = useState(new Date());

  const closeDayEditor = () => {
    setModalVisible(false);
    setAvailabilityError(null);
    setEditingBlockField(null);
    setDraftBlocks([]);
  };

  const openDayEditor = (dayIndex: number) => {
    const selectedDay = WEEKDAYS[dayIndex] as Weekday;
    setSelectedDayIdx(dayIndex);
    setDraftBlocks(availability[selectedDay] ? [...availability[selectedDay]] : []);
    setAvailabilityError(null);
    setEditingBlockField(null);
    setModalVisible(true);
  };

  const updateDraftBlock = (blockIndex: number, field: TimeField, value: string) => {
    setAvailabilityError(null);
    setDraftBlocks((current) =>
      current.map((block, index) =>
        index === blockIndex
          ? {
              ...block,
              [field]: value,
            }
          : block
      )
    );
  };

  const openTimePicker = (blockIndex: number, field: TimeField) => {
    const currentBlock = draftBlocks[blockIndex];
    const fallback = field === 'start' ? '19:00' : '21:00';
    const pickerValue = timeStringToDate(currentBlock?.[field] || fallback);

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: 'time',
        is24Hour: false,
        onChange: (_event, selectedDate) => {
          if (!selectedDate) {
            return;
          }
          updateDraftBlock(blockIndex, field, formatTimeValue(selectedDate));
        },
      });
      return;
    }

    setEditingBlockField({ blockIndex, field });
    setIosPickerValue(pickerValue);
  };

  const handleIosTimeChange = (_event: any, selectedDate?: Date) => {
    if (!selectedDate || !editingBlockField) {
      return;
    }

    setIosPickerValue(selectedDate);
    updateDraftBlock(editingBlockField.blockIndex, editingBlockField.field, formatTimeValue(selectedDate));
  };

  const addDraftBlock = () => {
    setAvailabilityError(null);
    setDraftBlocks((current) => [...current, getDefaultBlock(current)]);
  };

  const removeDraftBlock = (blockIndex: number) => {
    setAvailabilityError(null);
    setDraftBlocks((current) => current.filter((_, index) => index !== blockIndex));
    setEditingBlockField(null);
  };

  const clearDraftBlocks = () => {
    setAvailabilityError(null);
    setEditingBlockField(null);
    setDraftBlocks([]);
  };

  const saveDayAvailability = () => {
    const selectedDay = WEEKDAYS[selectedDayIdx] as Weekday;
    const validationError = validateBlocks(draftBlocks);

    if (validationError) {
      setAvailabilityError(validationError);
      return;
    }

    onChange({
      ...availability,
      [selectedDay]: sortBlocks(draftBlocks),
    });
    closeDayEditor();
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>

      <View style={styles.scheduleGrid}>
        {WEEKDAYS.map((day, idx) => {
          const blocks = availability[day] || [];
          const hasBlocks = blocks.length > 0;

          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayCard, hasBlocks && styles.dayCardActive]}
              onPress={() => openDayEditor(idx)}
            >
              <Text style={[styles.dayCardLabel, hasBlocks && styles.dayCardLabelActive]}>{DISPLAY_DAYS[idx]}</Text>
              <Text style={[styles.dayCardBlocks, hasBlocks && styles.dayCardBlocksActive]}>
                {summarizeBlocks(blocks)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {WEEKDAYS.every((day) => availability[day].length === 0) && (
        <Text style={styles.noScheduleFallback}>No schedule set yet. Tap a day to add your free time.</Text>
      )}

      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Set {DISPLAY_DAYS[selectedDayIdx]} Schedule</Text>
              <TouchableOpacity onPress={closeDayEditor}>
                <X color={theme.colors.primary.inkMuted} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody}>
              {draftBlocks.length > 0 ? (
                draftBlocks.map((block, index) => (
                  <View key={`${block.start}-${block.end}-${index}`} style={styles.blockCard}>
                    <View style={styles.blockCardHeader}>
                      <Text style={styles.blockLabel}>Block {index + 1}</Text>
                      <TouchableOpacity onPress={() => removeDraftBlock(index)}>
                        <Text style={styles.removeTextModal}>Remove</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.blockTimeRow}>
                      <TouchableOpacity style={styles.timeChip} onPress={() => openTimePicker(index, 'start')}>
                        <Text style={styles.timeChipLabel}>Start</Text>
                        <Text style={styles.timeChipValue}>{formatTimeLabel(block.start)}</Text>
                      </TouchableOpacity>

                      <Text style={styles.timeConnector}>to</Text>

                      <TouchableOpacity style={styles.timeChip} onPress={() => openTimePicker(index, 'end')}>
                        <Text style={styles.timeChipLabel}>End</Text>
                        <Text style={styles.timeChipValue}>{formatTimeLabel(block.end)}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyBlockText}>No learning blocks scheduled for this day yet.</Text>
              )}

              {Platform.OS === 'ios' && editingBlockField && (
                <View style={styles.pickerCard}>
                  <Text style={styles.pickerLabel}>
                    Editing {editingBlockField.field} time for block {editingBlockField.blockIndex + 1}
                  </Text>
                  <DateTimePicker
                    value={iosPickerValue}
                    mode="time"
                    display="spinner"
                    onChange={handleIosTimeChange}
                  />
                </View>
              )}

              {availabilityError && <Text style={styles.availabilityError}>{availabilityError}</Text>}
            </ScrollView>

            <TouchableOpacity style={styles.secondaryModalBtn} onPress={addDraftBlock}>
              <Text style={styles.secondaryModalText}>+ Add Time Block</Text>
            </TouchableOpacity>

            {draftBlocks.length > 0 && (
              <TouchableOpacity style={styles.clearDayBtn} onPress={clearDraftBlocks}>
                <Text style={styles.clearDayText}>Clear Day</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionModalBtn} onPress={saveDayAvailability}>
              <Text style={styles.actionModalText}>Save Day</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: theme.spacing[32],
  },
  sectionTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[8],
  },
  sectionSubtitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginBottom: theme.spacing[16],
  },
  scheduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[8],
  },
  dayCard: {
    width: '23%',
    aspectRatio: 1,
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCardActive: {
    backgroundColor: theme.colors.active?.indigo || '#4F46E5',
    borderColor: theme.colors.active?.indigo || '#4F46E5',
  },
  dayCardLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    fontWeight: theme.typography.fontWeights.medium,
  },
  dayCardLabelActive: {
    color: theme.colors.neutral.white,
  },
  dayCardBlocks: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.primary.inkMuted,
    opacity: 0.6,
    marginTop: 4,
  },
  dayCardBlocksActive: {
    color: theme.colors.neutral.white,
    opacity: 0.9,
  },
  noScheduleFallback: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.accent.coral,
    fontStyle: 'italic',
    marginTop: theme.spacing[12],
    alignSelf: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 23, 20, 0.5)',
    justifyContent: 'center',
    padding: theme.spacing[24],
  },
  modalContent: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[24],
    maxHeight: '85%',
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[24],
  },
  modalTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
  },
  modalScroll: {
    maxHeight: 360,
    marginBottom: theme.spacing[16],
  },
  modalBody: {
    gap: theme.spacing[12],
  },
  blockCard: {
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[16],
    backgroundColor: theme.colors.neutral.cream,
  },
  blockCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  blockLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  blockTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeChip: {
    flex: 1,
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[10],
  },
  timeChipLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    marginBottom: 4,
  },
  timeChipValue: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  timeConnector: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginHorizontal: theme.spacing[10],
  },
  removeTextModal: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.danger.rose,
    fontWeight: theme.typography.fontWeights.medium,
  },
  emptyBlockText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    textAlign: 'center',
    paddingVertical: theme.spacing[16],
  },
  pickerCard: {
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[12],
    backgroundColor: theme.colors.neutral.white,
  },
  pickerLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginBottom: theme.spacing[8],
  },
  availabilityError: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.danger.rose,
  },
  secondaryModalBtn: {
    borderWidth: 1,
    borderColor: theme.colors.accent.coral,
    paddingVertical: theme.spacing[12],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  secondaryModalText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.accent.coralDark,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  clearDayBtn: {
    paddingVertical: theme.spacing[12],
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  clearDayText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.danger.rose,
    fontWeight: theme.typography.fontWeights.medium,
  },
  actionModalBtn: {
    backgroundColor: theme.colors.accent.coral,
    paddingVertical: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
  },
  actionModalText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
