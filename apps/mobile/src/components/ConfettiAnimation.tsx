import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, runOnJS } from 'react-native-reanimated';
import { theme } from '../constants/theme';

const { width } = Dimensions.get('window');

// 24 Pieces
const NUM_PIECES = 24;
const COLORS = ['#D4614A', '#2D6A4F', '#C07B00', '#1A1714', '#FAF8F3'];

interface ConfettiPieceProps {
  index: number;
}

const ConfettiPiece = React.memo(({ index }: ConfettiPieceProps) => {
  const progress = useSharedValue(0);

  // Randomize initial velocities and target positions
  const angle = (index * (360 / NUM_PIECES)) + (Math.random() * 20 - 10);
  const rad = (angle * Math.PI) / 180;
  
  // Random speeds and gravities
  const distance = 100 + Math.random() * 200;
  const targetX = Math.cos(rad) * distance;
  // Make y curve slightly more downwards (gravity)
  const targetY = Math.sin(rad) * distance + 100 + Math.random() * 100;
  
  const rotation = Math.random() * 360;
  const targetRotation = rotation + (Math.random() > 0.5 ? 360 : -360) * 2;
  
  const isRect = Math.random() > 0.5;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { 
      duration: 1200 + Math.random() * 300, 
      easing: Easing.bezier(0.25, 1, 0.5, 1) 
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const x = targetX * progress.value;
    // Parabola for Y to simulate throwing / gravity
    const y = targetY * progress.value * progress.value; 

    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${rotation + (targetRotation - rotation) * progress.value}deg` },
        { scale: Math.max(0, 1 - Math.pow(progress.value, 3)) } // Fade and shrink out at end
      ],
      opacity: 1 - Math.pow(progress.value, 2.5),
    };
  });

  return (
    <Animated.View style={[
      {
         position: 'absolute',
         backgroundColor: color,
         width: isRect ? 4 : 6,
         height: isRect ? 10 : 6,
         left: '50%',
         top: '50%',
      },
      animatedStyle
    ]} />
  );
});

export interface ConfettiAnimationProps {
  visible: boolean;
  onComplete?: () => void;
}

export const ConfettiAnimation = ({ visible, onComplete }: ConfettiAnimationProps) => {
  useEffect(() => {
    if (visible && onComplete) {
      const timer = setTimeout(() => {
        onComplete();
      }, 1500); // Wait for longest animation to finish
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
       {Array.from({ length: NUM_PIECES }).map((_, i) => (
         <ConfettiPiece key={i} index={i} />
       ))}
    </View>
  );
};
