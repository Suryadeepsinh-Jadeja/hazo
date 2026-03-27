import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';

import { theme } from '../constants/theme';

interface AvailabilityImportReviewModalProps {
  visible: boolean;
  result: {
    source_type: string;
    summary: string[];
    warnings: string[];
  } | null;
  onApply: () => void;
  onClose: () => void;
  applyLabel?: string;
}

export const AvailabilityImportReviewModal = ({
  visible,
  result,
  onApply,
  onClose,
  applyLabel = 'Use Imported Draft',
}: AvailabilityImportReviewModalProps) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Review Imported Schedule</Text>
              <Text style={styles.subtitle}>
                Hazo drafted this from your {result?.source_type === 'pdf' ? 'PDF' : 'image'} timetable. Double-check it before saving.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X color={theme.colors.primary.inkMuted} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            <Text style={styles.sectionTitle}>Detected Free Slots</Text>
            {(result?.summary || []).map((line) => (
              <View key={line} style={styles.summaryRow}>
                <Text style={styles.summaryText}>{line}</Text>
              </View>
            ))}

            {(result?.warnings || []).length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Things To Review</Text>
                {result?.warnings.map((warning) => (
                  <View key={warning} style={styles.warningRow}>
                    <Text style={styles.warningText}>{warning}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.primaryButton} onPress={onApply}>
            <Text style={styles.primaryButtonText}>{applyLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Keep Current Schedule</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 23, 20, 0.5)',
    justifyContent: 'center',
    padding: theme.spacing[24],
  },
  card: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[24],
    maxHeight: '82%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing[12],
    marginBottom: theme.spacing[16],
  },
  title: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[6],
  },
  subtitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    lineHeight: 20,
    maxWidth: 260,
  },
  body: {
    marginBottom: theme.spacing[16],
  },
  sectionTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[8],
    marginTop: theme.spacing[8],
  },
  summaryRow: {
    backgroundColor: theme.colors.neutral.cream,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing[12],
    marginBottom: theme.spacing[8],
  },
  summaryText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  warningRow: {
    backgroundColor: theme.colors.warning.amberLight,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing[12],
    marginBottom: theme.spacing[8],
  },
  warningText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.warning.amberDark,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent.coral,
    borderRadius: theme.borderRadius.sm,
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  secondaryButton: {
    marginTop: theme.spacing[8],
    paddingVertical: theme.spacing[12],
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
  },
});
