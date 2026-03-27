import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DocumentPicker, { types as documentTypes } from 'react-native-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, ArrowRight } from 'lucide-react-native';

import { AvailabilityImportReviewModal } from '../../components/AvailabilityImportReviewModal';
import { WeeklyAvailabilityEditor } from '../../components/WeeklyAvailabilityEditor';
import { theme } from '../../constants/theme';
import {
  availabilityEquals,
  availabilityHasAnyBlocks,
  buildEmptyAvailability,
  normalizeAvailability,
  WeeklyAvailability,
} from '../../lib/availability';
import { AvailabilityExtractionResult, goals, users } from '../../lib/api';

export const AvailabilitySetupScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const { sessionId, answerMap } = route.params || {};

  const [availability, setAvailability] = useState<WeeklyAvailability>(buildEmptyAvailability);
  const [savedAvailability, setSavedAvailability] = useState<WeeklyAvailability>(buildEmptyAvailability);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<AvailabilityExtractionResult | null>(null);

  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['userProfile'],
    queryFn: users.getProfile,
  });

  useEffect(() => {
    if (!profile) {
      return;
    }

    const normalized = normalizeAvailability(profile.availability);
    setAvailability(normalized);
    setSavedAvailability(normalized);
  }, [profile]);

  const hasAvailability = availabilityHasAnyBlocks(availability);
  const availabilityChanged = !availabilityEquals(availability, savedAvailability);

  const handleUploadTimetable = async () => {
    try {
      setUploading(true);
      const pickedFile = await DocumentPicker.pickSingle({
        type: [documentTypes.images, documentTypes.pdf],
        copyTo: 'cachesDirectory',
        presentationStyle: 'fullScreen',
      });

      const extraction = await users.extractAvailability({
        uri: pickedFile.fileCopyUri || pickedFile.uri,
        type: pickedFile.type,
        name: pickedFile.name,
      });

      setImportResult(extraction);
    } catch (error: any) {
      if (DocumentPicker.isCancel(error)) {
        return;
      }

      Alert.alert(
        'Could not import timetable',
        error?.response?.data?.detail || 'Try another photo/PDF or set your schedule manually.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleApplyImportedDraft = () => {
    if (!importResult) {
      return;
    }

    const normalized = normalizeAvailability(importResult.availability);
    setAvailability(normalized);
    setImportResult(null);
  };

  const handleContinue = async () => {
    if (!hasAvailability) {
      Alert.alert(
        'Add your free time first',
        'Before Hazo generates your roadmap, add at least one time block or import a timetable.'
      );
      return;
    }

    if (!sessionId) {
      Alert.alert('Missing onboarding session', 'Please go back and restart onboarding.');
      return;
    }

    try {
      setSubmitting(true);

      if (availabilityChanged) {
        await users.updateAvailability(availability);
        setSavedAvailability(availability);
        queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      }

      await goals.onboard.complete(sessionId, answerMap || {});
      navigation.navigate('Generating', { sessionId });
    } catch (error: any) {
      Alert.alert(
        'Could not continue',
        error?.response?.data?.detail || 'Please try again in a moment.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (isProfileLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accent.coral} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>Step 3 of 3</Text>
        <Text style={styles.title}>When are you actually free during the week?</Text>
        <Text style={styles.subtitle}>
          Hazo will use this to shape your daily plan. Add your slots manually, or upload a timetable and review the extracted free windows.
        </Text>

        <TouchableOpacity
          style={[styles.uploadCard, uploading && styles.uploadCardDisabled]}
          onPress={handleUploadTimetable}
          disabled={uploading}
        >
          <View style={styles.uploadIconWrap}>
            <Upload color={theme.colors.accent.coralDark} size={20} />
          </View>
          <View style={styles.uploadTextWrap}>
            <Text style={styles.uploadTitle}>{uploading ? 'Reading your timetable...' : 'Upload timetable photo or PDF'}</Text>
            <Text style={styles.uploadSubtitle}>Import a class schedule, coaching routine, or weekly timetable, then review before applying.</Text>
          </View>
        </TouchableOpacity>

        <WeeklyAvailabilityEditor
          availability={availability}
          onChange={setAvailability}
          title="Weekly Availability"
          subtitle="Tap a day to add or refine as many free blocks as you need."
        />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, (submitting || !hasAvailability) && styles.primaryButtonDisabled]}
          onPress={handleContinue}
          disabled={submitting || !hasAvailability}
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.neutral.white} />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>Build My Roadmap</Text>
              <ArrowRight color={theme.colors.neutral.white} size={18} />
            </>
          )}
        </TouchableOpacity>
      </View>

      <AvailabilityImportReviewModal
        visible={!!importResult}
        result={importResult}
        onApply={handleApplyImportedDraft}
        onClose={() => setImportResult(null)}
        applyLabel="Use Imported Draft"
      />
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
    paddingTop: theme.spacing[40],
    paddingBottom: theme.spacing[120],
  },
  eyebrow: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    letterSpacing: 0.6,
    color: theme.colors.accent.coralDark,
    marginBottom: theme.spacing[8],
  },
  title: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[12],
  },
  subtitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.inkMuted,
    lineHeight: 24,
    marginBottom: theme.spacing[24],
  },
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[24],
  },
  uploadCardDisabled: {
    opacity: 0.7,
  },
  uploadIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.accent.coralLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[16],
  },
  uploadTextWrap: {
    flex: 1,
  },
  uploadTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: 4,
  },
  uploadSubtitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[16],
    paddingBottom: theme.spacing[24],
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutral.border,
    backgroundColor: theme.colors.neutral.cream,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary.ink,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[16],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
