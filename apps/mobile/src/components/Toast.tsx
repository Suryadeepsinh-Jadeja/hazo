import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { CheckCircle2, XCircle, Info } from 'lucide-react-native';
import { theme } from '../constants/theme';
import { toast, ToastConfig } from '../lib/toast';

const { width } = Dimensions.get('window');

export const GlobalToast = () => {
  const [activeToast, setActiveToast] = useState<ToastConfig | null>(null);
  const translateY = useSharedValue(-100);

  useEffect(() => {
    toast.setListener((config) => {
      if (config) {
        setActiveToast(config);
        translateY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.back(1.5)) });
      } else {
        translateY.value = withTiming(-100, { duration: 300 }, () => {
           runOnJS(setActiveToast)(null);
        });
      }
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: translateY.value === -100 ? 0 : 1, // Prevent visual bugs behind navbar
  }));

  if (!activeToast && translateY.value === -100) return null;

  const getVariantStyles = () => {
    const v = activeToast?.type || 'default';
    if (v === 'success') {
      return { 
        bg: theme.colors.positive.sageLight, 
        border: theme.colors.positive.sageDark, 
        text: theme.colors.positive.sageDark, 
        icon: <CheckCircle2 color={theme.colors.positive.sageDark} size={18} /> 
      };
    }
    if (v === 'error') {
      return { 
        bg: theme.colors.danger.roseLight, 
        border: theme.colors.danger.rose, 
        text: theme.colors.danger.rose, 
        icon: <XCircle color={theme.colors.danger.rose} size={18} /> 
      };
    }
    if (v === 'info') {
      return { 
        bg: theme.colors.neutral.creampaper, 
        border: theme.colors.primary.inkMuted, 
        text: theme.colors.primary.inkMuted, 
        icon: <Info color={theme.colors.primary.inkMuted} size={18} /> 
      };
    }
    // Default
    return { 
      bg: theme.colors.primary.ink, // #1A1714
      border: theme.colors.primary.ink, 
      text: theme.colors.neutral.white, 
      icon: null 
    };
  };

  const vStyles = getVariantStyles();

  return (
    <Animated.View style={[styles.container, animatedStyle, { 
       backgroundColor: vStyles.bg,
       borderColor: vStyles.border
    }]}>
      {vStyles.icon && <View style={styles.iconWrap}>{vStyles.icon}</View>}
      <Text style={[styles.message, { color: vStyles.text }]}>
        {activeToast?.message}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60, // below status bar
    alignSelf: 'center',
    width: Math.min(width - 32, 340),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[20],
    borderWidth: 1,
    borderRadius: theme.borderRadius.sm,
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    zIndex: 9999, // Super high to clear all stacks
  },
  iconWrap: {
    marginRight: theme.spacing[8],
  },
  message: {
    fontFamily: theme.typography.fontBody,
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.medium,
    lineHeight: 20,
    flexShrink: 1, // allows wrap if long
  },
});
