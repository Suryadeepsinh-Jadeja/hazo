import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus } from 'lucide-react-native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { RoomCard, CommunityRoom } from '../../components/RoomCard';
import { toast } from '../../lib/toast';

const MOCK_ROOMS: CommunityRoom[] = [
  { id: '1', name: 'GATE CSE 2026 Aspirants', domain: 'Computer Science', memberCount: 1400, targetDate: 'Feb 2026', userJoined: false },
  { id: '2', name: 'Google SDE Prep', domain: 'Interviews', memberCount: 520, targetDate: 'Q3 2026', userJoined: true },
  { id: '3', name: 'IELTS Band 8+ Circle', domain: 'Language', memberCount: 89, targetDate: 'Ongoing', userJoined: false },
];

export const CommunityScreen = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();

  const { data: rooms, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['communityRooms'],
    queryFn: async () => {
      try {
        const res = await api.get('/api/v1/community/rooms');
        return res.data;
      } catch {
        // Fallback to strict mock matching interface
        return MOCK_ROOMS;
      }
    }
  });

  const handleCreateRoom = () => {
    if (user?.plan !== 'pro') {
      Alert.alert(
        "Pro Feature", 
        "Creating custom community cohorts requires Hazo Pro.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upgrade", style: "default" }
        ]
      );
      return;
    }
    // Launch room creation modal logic...
    toast.show('Creation portal opening soon!', 'info');
  };

  const handleJoin = (roomId: string) => {
    // In prod: await api.post(`/api/v1/community/rooms/${roomId}/join`)
    toast.show('Welcome to the group!', 'success');
  };

  const handlePressRoom = (roomId: string) => {
    navigation.navigate('RoomFeedScreen', { roomId });
  };

  const filteredRooms = rooms?.filter((room: any) => {
    const name = room.name || '';
    const domain = room.domain || '';
    return (
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      domain.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Community</Text>
        <TouchableOpacity style={styles.createButton} onPress={handleCreateRoom}>
          <Plus color={theme.colors.accent.coral} size={20} />
          {user?.plan !== 'pro' && <View style={styles.proBadge} />}
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search color={theme.colors.primary.inkMuted} size={18} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search rooms or domains..."
            placeholderTextColor={theme.colors.primary.inkMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {filteredRooms?.map((room: any) => (
          <RoomCard 
            key={room.id || room._id} 
            room={{
              id: room.id || room._id,
              name: room.name,
              domain: room.domain,
              memberCount: room.memberCount || room.member_count || 0,
              targetDate: room.targetDate || room.target_date || 'Ongoing',
              userJoined: room.userJoined,
            }} 
            onJoin={handleJoin} 
            onPress={handlePressRoom} 
          />
        ))}

        {!isLoading && filteredRooms?.length === 0 && (
          <Text style={styles.emptyText}>No communities match your search parameters.</Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[16],
    backgroundColor: theme.colors.neutral.cream,
  },
  headerTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
  },
  createButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  proBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.warning.amber,
    borderWidth: 2,
    borderColor: theme.colors.neutral.cream,
  },
  searchContainer: {
    paddingHorizontal: theme.spacing[24],
    marginBottom: theme.spacing[16],
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.borderMid,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[12],
    height: 46,
  },
  searchInput: {
    flex: 1,
    marginLeft: theme.spacing[8],
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[120],
  },
  emptyText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    textAlign: 'center',
    marginTop: theme.spacing[32],
  },
});
