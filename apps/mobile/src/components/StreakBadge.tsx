import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence } from 'react-native-reanimated';
import { Flame } from 'lucide-react-native';
import { theme } from '../constants/theme';

export interface StreakBadgeProps {
  count: number;
  size?: 'sm' | 'md' | 'lg';
}

export const StreakBadge = ({ count, size = 'md' }: StreakBadgeProps) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    // Pop animation on count increase
    if (count > 0) {
      scale.value = withSequence(
        withSpring(1.18, { damping: 10, stiffness: 200 }),
        withSpring(1, { damping: 12, stiffness: 200 })
      );
    }
  }, [count]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const sizing = {
    sm: { height: 28, fontSize: 11, paddingH: 8, iconSize: 12 },
    md: { height: 34, fontSize: 13, paddingH: 12, iconSize: 16 },
    lg: { height: 40, fontSize: 15, paddingH: 16, iconSize: 18 },
  }[size];

  return (
    <Animated.View style={[
      styles.container, 
      { height: sizing.height, paddingHorizontal: sizing.paddingH },
      animatedStyle
    ]}>
      <Text style={styles.prefixEmoji}>🔥</Text>
      <Text style={[styles.text, { fontSize: sizing.fontSize }]}>
        {count}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF6E3', // amberLight specific request
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: '#E8D5A3',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  prefixEmoji: {
    marginRight: 4,
  },
  text: {
    fontFamily: theme.typography.fontMono,
    fontWeight: theme.typography.fontWeights.bold,
    color: '#C07B00', // warm amber specific request
  },
});
