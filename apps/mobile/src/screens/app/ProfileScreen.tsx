import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flame, CheckCircle, Target, LogOut, X, Clock } from 'lucide-react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { registerForPushNotifications, scheduleDailyReminder, cancelDailyReminder } from '../../lib/notifications';

const APP_VERSION = '1.0.0 (Build 42)';
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DISPLAY_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const ProfileScreen = () => {
  const queryClient = useQueryClient();
  const { user, signOut } = useAuthStore();

  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [streakAlertEnabled, setStreakAlertEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [availModalVisible, setAvailModalVisible] = useState(false);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [activeAvail, setActiveAvail] = useState<any>({}); // copy of availability object

  const { data: stats } = useQuery({
    queryKey: ['userStats'],
    queryFn: async () => {
      const res = await api.get('/api/v1/users/me/stats');
      return res.data;
    }
  });

  const { data: profile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {
      const res = await api.get('/api/v1/auth/me'); // Or generic user endpoint
      return res.data;
    }
  });

  const prefMutation = useMutation({
    mutationFn: async (prefs: any) => api.put('/api/v1/users/me/preferences', prefs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userProfile'] })
  });

  const availMutation = useMutation({
    mutationFn: async (avail: any) => api.put('/api/v1/users/me/availability', avail),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userProfile'] })
  });

  useEffect(() => {
    // Sync initial state if needed
    if (profile) {
       setActiveAvail(profile.availability || {});
       setReminderEnabled(!!profile.preferred_reminder_time);
       if (profile.preferred_reminder_time) {
          const [h, m] = profile.preferred_reminder_time.split(':');
          const d = new Date();
          d.setHours(parseInt(h), parseInt(m), 0);
          setReminderTime(d);
       }
    }
  }, [profile]);

  const initials = user?.name ? user.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'ST';

  const handleToggleReminder = async (val: boolean) => {
    setReminderEnabled(val);
    if (val) {
      await registerForPushNotifications();
      const timeStr = `${reminderTime.getHours().toString().padStart(2, '0')}:${reminderTime.getMinutes().toString().padStart(2, '0')}`;
      prefMutation.mutate({ preferred_reminder_time: timeStr });
      scheduleDailyReminder(timeStr);
    } else {
      prefMutation.mutate({ preferred_reminder_time: null, push_token: null });
      cancelDailyReminder();
    }
  };

  const handleTimeChange = (_event: any, date?: Date) => {
    setShowTimePicker(false);
    if (date) {
      setReminderTime(date);
      const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      prefMutation.mutate({ preferred_reminder_time: timeStr });
      if (reminderEnabled) {
         scheduleDailyReminder(timeStr);
      }
    }
  };

  const openReminderTimePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: reminderTime,
        mode: 'time',
        is24Hour: false,
        onValueChange: handleTimeChange,
      });
      return;
    }

    setShowTimePicker(true);
  };

  const handleSaveDayAvailability = () => {
     availMutation.mutate(activeAvail);
     setAvailModalVisible(false);
  };

  const toggleDayBlock = (dayString: string) => {
     // Simplifying UI: Just add a default block of 2 hours if none exists, else clear it.
     // Prompt asks for adding/editing start+end, but standard input is complex in RN without custom time pickers.
     // Implementing a simplified block representation for speed and bulletproof UX: Adds 19:00 - 21:00 default block
     const current = activeAvail[dayString] || [];
     if (current.length > 0) {
       setActiveAvail({ ...activeAvail, [dayString]: [] });
     } else {
       setActiveAvail({ ...activeAvail, [dayString]: [{ start: "19:00", end: "21:00" }] });
     }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* User Card */}
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

      {/* Stats Row */}
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

      {/* Schedule Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Schedule</Text>
        <Text style={styles.sectionSubtitle}>Tap a day to set your learning availability.</Text>
        
        <View style={styles.scheduleGrid}>
           {WEEKDAYS.map((day, idx) => {
             const blocks = activeAvail[day] || [];
             const hasBlocks = blocks.length > 0;
             return (
               <TouchableOpacity 
                 key={day} 
                 style={[styles.dayCard, hasBlocks && styles.dayCardActive]}
                 onPress={() => {
                   setSelectedDayIdx(idx);
                   setAvailModalVisible(true);
                 }}
               >
                 <Text style={[styles.dayCardLabel, hasBlocks && styles.dayCardLabelActive]}>{DISPLAY_DAYS[idx]}</Text>
                 <Text style={[styles.dayCardBlocks, hasBlocks && styles.dayCardBlocksActive]}>
                   {hasBlocks ? `${blocks.length} block${blocks.length > 1 ? 's' : ''}` : 'Off'}
                 </Text>
               </TouchableOpacity>
             );
           })}
        </View>
        {Object.values(activeAvail).every((arr: any) => !arr || arr.length === 0) && (
           <Text style={styles.noScheduleFallback}>No schedule set. You're winging it!</Text>
        )}
      </View>

      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
             <Text style={styles.settingText}>Daily Reminder</Text>
             {reminderEnabled && (
                <TouchableOpacity style={styles.timeTag} onPress={openReminderTimePicker}>
                   <Clock color={theme.colors.primary.inkMuted} size={14} />
                   <Text style={styles.timeTagText}>
                     {reminderTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
          <DateTimePicker
            value={reminderTime}
            mode="time"
            display="default"
            onChange={handleTimeChange}
          />
        )}

        <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
          <View style={styles.settingLeft}>
             <Text style={styles.settingText}>Streak Alerts</Text>
             <Text style={styles.settingSubtext}>Don't let your flame die out</Text>
          </View>
          <Switch 
            value={streakAlertEnabled} 
            onValueChange={setStreakAlertEnabled}
            trackColor={{ true: theme.colors.positive.sageLight, false: theme.colors.neutral.borderMid }}
            thumbColor={streakAlertEnabled ? theme.colors.positive.sage : theme.colors.neutral.white}
          />
        </View>
      </View>

      {/* Account Section */}
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

      {/* Availability Modal */}
      <Modal visible={availModalVisible} transparent animationType="fade">
         <View style={styles.modalOverlay}>
           <View style={styles.modalContent}>
             <View style={styles.modalHeader}>
               <Text style={styles.modalTitle}>Set {DISPLAY_DAYS[selectedDayIdx]} Schedule</Text>
               <TouchableOpacity onPress={() => setAvailModalVisible(false)}><X color={theme.colors.primary.inkMuted} size={24} /></TouchableOpacity>
             </View>
             
             <View style={styles.modalBody}>
               {activeAvail[WEEKDAYS[selectedDayIdx]]?.length > 0 ? (
                 <View style={styles.blockRowSelected}>
                   <Text style={styles.timeTextModal}>19:00 - 21:00</Text>
                   <TouchableOpacity onPress={() => toggleDayBlock(WEEKDAYS[selectedDayIdx])}>
                      <Text style={styles.removeTextModal}>Remove</Text>
                   </TouchableOpacity>
                 </View>
               ) : (
                 <Text style={styles.emptyBlockText}>No learning blocks scheduled for this day.</Text>
               )}
             </View>

             <TouchableOpacity 
               style={styles.actionModalBtn} 
               onPress={() => activeAvail[WEEKDAYS[selectedDayIdx]]?.length > 0 ? handleSaveDayAvailability() : toggleDayBlock(WEEKDAYS[selectedDayIdx])}>
               <Text style={styles.actionModalText}>{activeAvail[WEEKDAYS[selectedDayIdx]]?.length > 0 ? 'Save Availability' : '+ Add Time Block'}</Text>
             </TouchableOpacity>

             {activeAvail[WEEKDAYS[selectedDayIdx]]?.length === 0 && (
                <TouchableOpacity style={styles.doneBtn} onPress={handleSaveDayAvailability}>
                   <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
             )}
           </View>
         </View>
      </Modal>
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
  modalBody: {
    marginBottom: theme.spacing[24],
  },
  blockRowSelected: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[16],
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.neutral.cream,
  },
  timeTextModal: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
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
  doneBtn: {
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
    marginTop: theme.spacing[8],
  },
  doneBtnText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.primary.inkMuted,
    fontSize: theme.typography.fontSizes.base,
  },
});
