import React, { useEffect } from 'react';
import { ViewStyle, StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing } from 'react-native-reanimated';
import { theme } from '../constants/theme';

export interface SkeletonLoaderProps {
  width: number | string;
  height: number | string;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonLoader = ({ 
  width, 
  height, 
  borderRadius = theme.borderRadius.sm,
  style 
}: SkeletonLoaderProps) => {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 750, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View 
      style={[
        { 
          width, 
          height, 
          borderRadius, 
          backgroundColor: '#E4DFD6' // Using the specific border color requested by prompt as shimmer base
        }, 
        animatedStyle,
        style
      ]} 
    />
  );
};
