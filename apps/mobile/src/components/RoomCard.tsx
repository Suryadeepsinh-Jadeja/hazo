import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Users, Calendar } from 'lucide-react-native';
import { theme } from '../constants/theme';

export interface CommunityRoom {
  id: string;
  name: string;
  domain: string;
  memberCount: number;
  targetDate: string;
  userJoined?: boolean;
}

export interface RoomCardProps {
  room: CommunityRoom;
  onJoin: (roomId: string) => void;
  onPress: (roomId: string) => void;
}

export const RoomCard = ({ room, onJoin, onPress }: RoomCardProps) => {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(room.id)} activeOpacity={0.8}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={styles.name} numberOfLines={1}>{room.name}</Text>
          <View style={styles.domainBadge}>
            <Text style={styles.domainText}>{room.domain.toUpperCase()}</Text>
          </View>
        </View>
        
        {!room.userJoined && (
          <TouchableOpacity 
            style={styles.joinButton} 
            onPress={(e) => {
              e.stopPropagation(); // Prevent card tap
              onJoin(room.id);
            }}
          >
            <Text style={styles.joinText}>Join</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.footerRow}>
        <View style={styles.metaStat}>
          <Users color={theme.colors.primary.inkMuted} size={14} />
          <Text style={styles.metaText}>{room.memberCount.toLocaleString()} members</Text>
        </View>

        <View style={styles.metaStat}>
          <Calendar color={theme.colors.primary.inkMuted} size={14} />
          <Text style={styles.metaText}>Target: {room.targetDate}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    marginBottom: theme.spacing[12],
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[16],
  },
  titleWrap: {
    flex: 1,
    alignItems: 'flex-start',
    marginRight: theme.spacing[12],
  },
  name: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.semibold,
    marginBottom: theme.spacing[4],
  },
  domainBadge: {
    backgroundColor: theme.colors.neutral.cream,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  domainText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 9,
    color: theme.colors.primary.inkMuted,
    fontWeight: theme.typography.fontWeights.bold,
  },
  joinButton: {
    backgroundColor: theme.colors.accent.coral,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
  },
  joinText: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.bold,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[16],
  },
  metaStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 11,
    color: theme.colors.primary.inkMuted,
    marginLeft: 6,
  },
});
