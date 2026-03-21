import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated as RNAnimated, Easing, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import { theme } from '../../constants/theme';
import api from '../../lib/api';

const MESSAGES = [
  "Analysing your goal...",
  "Designing your path...",
  "Finding the best resources...",
  "Building your schedule...",
  "Almost ready..."
];

export const GeneratingScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { sessionId } = route.params || {};
  
  const [msgIndex, setMsgIndex] = useState(0);
  const [rotateValue] = useState(new RNAnimated.Value(0));

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.timing(rotateValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    const msgInterval = setInterval(() => {
      setMsgIndex((prev) => (prev < MESSAGES.length - 1 ? prev + 1 : prev));
    }, 2500);

    let pollCount = 0;
    const pollInterval = setInterval(async () => {
      pollCount++;
      try {
        const res = await api.get(`/api/v1/goals/onboard/status/${sessionId}`);
        if (res.data?.status === 'complete' && res.data?.goal_id) {
          clearInterval(pollInterval);
          navigation.navigate('RoadmapPreview', { goalId: res.data.goal_id });
        } else if (res.data?.status === 'error') {
          clearInterval(pollInterval);
          Alert.alert('Error', res.data.error || 'Roadmap generation failed. Please try again.');
          navigation.goBack();
        }
      } catch {
        // After ~60 seconds of polling (24 tries × 2.5s), give up
        if (pollCount >= 24) {
          clearInterval(pollInterval);
          Alert.alert('Timeout', 'Roadmap generation is taking too long. Please try again.');
          navigation.goBack();
        }
      }
    }, 2500);

    return () => {
      clearInterval(msgInterval);
      clearInterval(pollInterval);
    };
  }, []);

  const spin = rotateValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.centerBox}>
        <RNAnimated.View style={{ transform: [{ rotate: spin }] }}>
          <Svg width={100} height={100} viewBox="0 0 100 100">
            <Circle
              cx={50}
              cy={50}
              r={40}
              stroke={theme.colors.neutral.border}
              strokeWidth={8}
              fill="none"
            />
            <Circle
              cx={50}
              cy={50}
              r={40}
              stroke={theme.colors.accent.coral}
              strokeWidth={8}
              fill="none"
              strokeDasharray="251"
              strokeDashoffset="188"
              strokeLinecap="round"
            />
          </Svg>
        </RNAnimated.View>

        <View style={styles.textWrapper}>
          <Animated.Text 
            key={MESSAGES[msgIndex]}
            entering={FadeIn.duration(400)}
            exiting={FadeOut.duration(400)}
            layout={Layout.springify()}
            style={styles.messageText}
          >
            {MESSAGES[msgIndex]}
          </Animated.Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerBox: {
    alignItems: 'center',
  },
  textWrapper: {
    marginTop: theme.spacing[32],
    height: 30, // reserved vertical space
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
  },
});
