import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { ChevronLeft, Flame, Send } from 'lucide-react-native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

const MOCK_ROOM_DATA = {
  name: 'Google SDE Prep',
  memberCount: 520,
  activeRatio: 0.72, // 72%
  feed: [
    { id: 'p1', displayName: 'Alice Chen', message: 'Anyone wrapping their head around DP on trees today?', timestamp: '10 mins ago' },
    { id: 'p2', displayName: 'Mark Johnson', message: 'Just finished the 14-day sliding window sprint. Huge confidence boost! 🔥', timestamp: '1 hour ago' },
    { id: 'p3', displayName: 'Sarah K.', message: 'Don\'t forget tomorrow is the mock interview swap.', timestamp: '4 hours ago' }
  ],
  leaderboard: [
    { id: 'l1', displayName: 'SystemDesignPro', streak: 45 },
    { id: 'l2', displayName: 'Mark Johnson', streak: 31 },
    { id: 'l3', displayName: 'David W.', streak: 28 },
    { id: 'l4', displayName: 'Alice Chen', streak: 14 }
  ]
};

export const RoomFeedScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { roomId } = route.params || {};
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'feed' | 'leaderboard'>('feed');
  const [inputText, setInputText] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRoom = async () => {
      try {
        const res = await api.get(`/api/v1/community/rooms/${roomId}`);
        setData(res.data);
      } catch {
        setData(MOCK_ROOM_DATA); // Fallback to local mock array if unconnected
      } finally {
        setLoading(false);
      }
    };
    fetchRoom();
  }, [roomId]);

  const handlePost = () => {
    if (user?.plan !== 'pro') {
      Alert.alert('Pro Required', 'Posting to Community Channels is a Hazo Pro feature.');
      return;
    }
    if (!inputText.trim()) return;
    
    // Optimistic UI updates
    const newPost = {
      id: Date.now().toString(),
      displayName: user?.name || 'You',
      message: inputText.trim(),
      timestamp: 'Just now'
    };
    setData({ ...data, feed: [newPost, ...data.feed] });
    setInputText('');
  };

  if (loading || !data) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.accent.coral} />
      </View>
    );
  }

  const activePercent = Math.round(data.activeRatio * 100);

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      {/* Header Layer */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
             <ChevronLeft color={theme.colors.primary.ink} size={28} />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            <Text style={styles.roomName} numberOfLines={1}>{data.name}</Text>
            <Text style={styles.memberCount}>{data.memberCount.toLocaleString()} members</Text>
          </View>
        </View>

        {/* Collective Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressLabelRow}>
            <Text style={styles.progressLabel}>Collective Daily Tasks Completed</Text>
            <Text style={styles.progressPercent}>{activePercent}%</Text>
          </View>
          <View style={styles.progressBg}>
             <View style={[styles.progressFill, { width: `${activePercent}%` }]} />
          </View>
        </View>

        {/* Tab Switcher */}
        <View style={styles.tabRow}>
           <TouchableOpacity 
              style={[styles.tabBtn, activeTab === 'feed' && styles.tabBtnActive]}
              onPress={() => setActiveTab('feed')}
           >
              <Text style={[styles.tabText, activeTab === 'feed' && styles.tabTextActive]}>Feed</Text>
           </TouchableOpacity>
           <TouchableOpacity 
              style={[styles.tabBtn, activeTab === 'leaderboard' && styles.tabBtnActive]}
              onPress={() => setActiveTab('leaderboard')}
           >
              <Text style={[styles.tabText, activeTab === 'leaderboard' && styles.tabTextActive]}>Leaderboard</Text>
           </TouchableOpacity>
        </View>
      </View>

      {/* Body Area */}
      {activeTab === 'feed' ? (
        <ScrollView style={styles.feedScroll} contentContainerStyle={styles.scrollContent}>
           {data.feed.map((post: any) => (
             <View key={post.id} style={styles.postCard}>
                <View style={styles.postHeader}>
                   <Text style={styles.postAuthor}>{post.displayName}</Text>
                   <Text style={styles.postTime}>{post.timestamp}</Text>
                </View>
                <Text style={styles.postMessage}>{post.message}</Text>
             </View>
           ))}
        </ScrollView>
      ) : (
        <ScrollView style={styles.feedScroll} contentContainerStyle={styles.scrollContent}>
           {data.leaderboard.map((user: any, index: number) => (
             <View key={user.id} style={styles.leaderboardRow}>
                <View style={styles.rankCircle}>
                   <Text style={styles.rankText}>{index + 1}</Text>
                </View>
                <Text style={styles.leaderName}>{user.displayName}</Text>
                <View style={styles.streakBadge}>
                   <Flame color={theme.colors.accent.coralDark} size={14} />
                   <Text style={styles.streakCount}>{user.streak}</Text>
                </View>
             </View>
           ))}
        </ScrollView>
      )}

      {/* Input area isolated for feed only */}
      {activeTab === 'feed' && (
        <View style={styles.inputArea}>
          <TextInput
            style={styles.chatInput}
            placeholder="Share your progress..."
            placeholderTextColor={theme.colors.primary.inkMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={300}
          />
          <TouchableOpacity 
             style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]} 
             onPress={handlePost}
             disabled={!inputText.trim()}
          >
             <Send color={theme.colors.neutral.white} size={18} />
          </TouchableOpacity>
        </View>
      )}

    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.cream,
  },
  header: {
    backgroundColor: theme.colors.neutral.white,
    paddingTop: theme.spacing[64],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.border,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[16],
    marginBottom: theme.spacing[20],
  },
  backButton: {
    padding: theme.spacing[4],
  },
  headerTitles: {
    flex: 1,
    marginLeft: theme.spacing[8],
  },
  roomName: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.bold,
  },
  memberCount: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
  },
  progressContainer: {
    paddingHorizontal: theme.spacing[24],
    marginBottom: theme.spacing[16],
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  progressPercent: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.positive.sageDark,
    fontWeight: theme.typography.fontWeights.bold,
  },
  progressBg: {
    height: 6,
    backgroundColor: theme.colors.neutral.borderMid,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.positive.sage,
    borderRadius: 3,
  },
  tabRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutral.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: theme.colors.accent.coral,
  },
  tabText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    fontWeight: theme.typography.fontWeights.medium,
  },
  tabTextActive: {
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  feedScroll: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing[16],
  },
  postCard: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[12],
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  postAuthor: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.bold,
  },
  postTime: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.primary.inkMuted,
  },
  postMessage: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    lineHeight: 22,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing[8],
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  rankCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing[16],
  },
  rankText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    fontWeight: theme.typography.fontWeights.bold,
  },
  leaderName: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.medium,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF6E3',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: '#E8D5A3',
  },
  streakCount: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: '#C07B00',
    fontWeight: theme.typography.fontWeights.bold,
    marginLeft: 4,
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.colors.neutral.white,
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[12],
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutral.border,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  chatInput: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    borderWidth: 1,
    borderColor: theme.colors.neutral.borderMid,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[16],
    paddingTop: theme.spacing[12],
    paddingBottom: theme.spacing[12],
    maxHeight: 120,
    minHeight: 46,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.colors.accent.coral,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: theme.spacing[12],
  },
  sendBtnDisabled: {
    backgroundColor: theme.colors.neutral.borderMid,
  },
});
