import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, CheckCircle, Target, LogOut, Clock, Upload } from 'lucide-react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import DocumentPicker, { types as documentTypes } from 'react-native-document-picker';

import { AvailabilityImportReviewModal } from '../../components/AvailabilityImportReviewModal';
import { WeeklyAvailabilityEditor } from '../../components/WeeklyAvailabilityEditor';
import { theme } from '../../constants/theme';
import { registerForPushNotifications, scheduleDailyReminder, cancelDailyReminder } from '../../lib/notifications';
import {
  availabilityEquals,
  buildEmptyAvailability,
  normalizeAvailability,
  WeeklyAvailability,
} from '../../lib/availability';
import { AvailabilityExtractionResult, users } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

const APP_VERSION = '1.0.0 (Build 42)';

export const ProfileScreen = () => {
  const queryClient = useQueryClient();
  const { user, signOut } = useAuthStore();

  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [streakAlertEnabled, setStreakAlertEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [activeAvail, setActiveAvail] = useState<WeeklyAvailability>(buildEmptyAvailability);
  const [savedAvail, setSavedAvail] = useState<WeeklyAvailability>(buildEmptyAvailability);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<AvailabilityExtractionResult | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['userStats'],
    queryFn: users.getStats,
  });

  const { data: profile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: users.getProfile,
  });

  const prefMutation = useMutation({
    mutationFn: async (prefs: Record<string, unknown>) => users.updatePreferences(prefs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userProfile'] }),
  });

  const availMutation = useMutation({
    mutationFn: users.updateAvailability,
    onSuccess: (updatedProfile) => {
      const normalized = normalizeAvailability(updatedProfile.availability);
      setSavedAvail(normalized);
      setActiveAvail(normalized);
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    },
  });

  useEffect(() => {
    if (!profile) {
      return;
    }

    const normalized = normalizeAvailability(profile.availability);
    setActiveAvail(normalized);
    setSavedAvail(normalized);
    setReminderEnabled(!!profile.preferred_reminder_time);

    if (profile.preferred_reminder_time) {
      const [h, m] = profile.preferred_reminder_time.split(':');
      const date = new Date();
      date.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
      setReminderTime(date);
    }
  }, [profile]);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((name: string) => name[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'HZ';

  const availabilityDirty = !availabilityEquals(activeAvail, savedAvail);

  const handleToggleReminder = async (value: boolean) => {
    setReminderEnabled(value);
    if (value) {
      await registerForPushNotifications();
      const timeStr = `${reminderTime.getHours().toString().padStart(2, '0')}:${reminderTime
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
      prefMutation.mutate({ preferred_reminder_time: timeStr });
      scheduleDailyReminder(timeStr);
    } else {
      prefMutation.mutate({ preferred_reminder_time: null, push_token: null });
      cancelDailyReminder();
    }
  };

  const handleTimeChange = (_event: any, date?: Date) => {
    setShowTimePicker(false);
    if (!date) {
      return;
    }

    setReminderTime(date);
    const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
    prefMutation.mutate({ preferred_reminder_time: timeStr });
    if (reminderEnabled) {
      scheduleDailyReminder(timeStr);
    }
  };

  const openReminderTimePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: reminderTime,
        mode: 'time',
        is24Hour: false,
        onChange: handleTimeChange,
      });
      return;
    }

    setShowTimePicker(true);
  };

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
        error?.response?.data?.detail || 'Try another file or adjust the schedule manually.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleApplyImportedDraft = () => {
    if (!importResult) {
      return;
    }

    setActiveAvail(normalizeAvailability(importResult.availability));
    setImportResult(null);
  };

  const handleSaveAvailability = () => {
    availMutation.mutate(activeAvail, {
      onError: (error: any) => {
        Alert.alert(
          'Could not save schedule',
          error?.response?.data?.detail || 'Please try again in a moment.'
        );
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.name || 'Hazo User'}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={[styles.planBadge, profile?.plan === 'pro' && styles.planBadgePro]}>
            <Text style={styles.planText}>{profile?.plan?.toUpperCase() || 'FREE'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Flame color={theme.colors.accent.coral} size={24} />
          <Text style={styles.statNumber}>{stats?.streak_count || 0}</Text>
          <Text style={styles.statLabel}>Day Streak</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <CheckCircle color={theme.colors.positive.sage} size={24} />
          <Text style={styles.statNumber}>{stats?.total_topics_done || 0}</Text>
          <Text style={styles.statLabel}>Topics Done</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Target color={theme.colors.active?.indigo || '#4F46E5'} size={24} />
          <Text style={styles.statNumber}>{stats?.active_goals_count || 0}</Text>
          <Text style={styles.statLabel}>Active Goals</Text>
        </View>
      </View>

      <WeeklyAvailabilityEditor
        availability={activeAvail}
        onChange={setActiveAvail}
        title="My Schedule"
        subtitle="Edit your week manually, or import a timetable and review the extracted free slots before saving."
      />

      <TouchableOpacity
        style={[styles.importButton, uploading && styles.importButtonDisabled]}
        onPress={handleUploadTimetable}
        disabled={uploading}
      >
        <Upload color={theme.colors.accent.coralDark} size={18} />
        <Text style={styles.importButtonText}>{uploading ? 'Reading timetable...' : 'Upload timetable photo or PDF'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.saveButton, (!availabilityDirty || availMutation.isPending) && styles.saveButtonDisabled]}
        onPress={handleSaveAvailability}
        disabled={!availabilityDirty || availMutation.isPending}
      >
        <Text style={styles.saveButtonText}>
          {availMutation.isPending ? 'Saving schedule...' : availabilityDirty ? 'Save Schedule Changes' : 'Schedule Saved'}
        </Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <Text style={styles.settingText}>Daily Reminder</Text>
            {reminderEnabled && (
              <TouchableOpacity style={styles.timeTag} onPress={openReminderTimePicker}>
                <Clock color={theme.colors.primary.inkMuted} size={14} />
                <Text style={styles.timeTagText}>
                  {reminderTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <Switch
            value={reminderEnabled}
            onValueChange={handleToggleReminder}
            trackColor={{ true: theme.colors.accent.coralLight, false: theme.colors.neutral.borderMid }}
            thumbColor={reminderEnabled ? theme.colors.accent.coral : theme.colors.neutral.white}
          />
        </View>
        {Platform.OS === 'ios' && showTimePicker && (
          <DateTimePicker value={reminderTime} mode="time" display="default" onChange={handleTimeChange} />
        )}

        <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
          <View style={styles.settingLeft}>
            <Text style={styles.settingText}>Streak Alerts</Text>
            <Text style={styles.settingSubtext}>Don&apos;t let your flame die out</Text>
          </View>
          <Switch
            value={streakAlertEnabled}
            onValueChange={setStreakAlertEnabled}
            trackColor={{ true: theme.colors.positive.sageLight, false: theme.colors.neutral.borderMid }}
            thumbColor={streakAlertEnabled ? theme.colors.positive.sage : theme.colors.neutral.white}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        {profile?.plan !== 'pro' && (
          <TouchableOpacity style={styles.proBanner}>
            <View>
              <Text style={styles.proBannerTitle}>Upgrade to Pro</Text>
              <Text style={styles.proBannerSub}>Unlimited Mentor chats & Skill exports</Text>
            </View>
            <View style={styles.proBannerBadge}>
              <Text style={styles.proBannerBadgeText}>PRO</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.signOutButton} onPress={() => signOut()}>
          <LogOut color={theme.colors.danger.rose} size={20} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.versionText}>Hazo v{APP_VERSION}</Text>

      <AvailabilityImportReviewModal
        visible={!!importResult}
        result={importResult}
        onApply={handleApplyImportedDraft}
        onClose={() => setImportResult(null)}
        applyLabel="Use Imported Draft"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  scrollContent: {
    padding: theme.spacing[24],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[64],
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[20],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[24],
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.accent.coralLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing[16],
    borderWidth: 2,
    borderColor: theme.colors.accent.coral,
  },
  avatarText: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.accent.coralDark,
    fontWeight: theme.typography.fontWeights.bold,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.bold,
  },
  userEmail: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginBottom: theme.spacing[8],
  },
  planBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.neutral.borderMid,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  planBadgePro: {
    backgroundColor: theme.colors.warning.amber,
  },
  planText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.bold,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[32],
    paddingVertical: theme.spacing[16],
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: theme.colors.neutral.border,
  },
  statNumber: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xl,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.bold,
    marginTop: theme.spacing[8],
  },
  statLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
  },
  importButton: {
    borderWidth: 1,
    borderColor: theme.colors.accent.coral,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[16],
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing[8],
    marginTop: -theme.spacing[8],
    marginBottom: theme.spacing[12],
  },
  importButtonDisabled: {
    opacity: 0.7,
  },
  importButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.accent.coralDark,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  saveButton: {
    backgroundColor: theme.colors.primary.ink,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
    marginBottom: theme.spacing[32],
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
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
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[16],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.border,
  },
  settingLeft: {
    flex: 1,
  },
  settingText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.medium,
  },
  settingSubtext: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginTop: 4,
  },
  timeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  timeTagText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.ink,
    marginLeft: 4,
  },
  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.warning.amberLight,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[16],
  },
  proBannerTitle: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.warning.amberDark,
    fontWeight: theme.typography.fontWeights.bold,
  },
  proBannerSub: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    marginTop: 4,
  },
  proBannerBadge: {
    backgroundColor: theme.colors.warning.amber,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  proBannerBadgeText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.bold,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[16],
    backgroundColor: theme.colors.danger.roseLight,
    borderRadius: theme.borderRadius.md,
  },
  signOutText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.danger.rose,
    fontWeight: theme.typography.fontWeights.semibold,
    marginLeft: theme.spacing[12],
  },
  versionText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.neutral.borderMid,
    textAlign: 'center',
    marginTop: theme.spacing[16],
  },
});
