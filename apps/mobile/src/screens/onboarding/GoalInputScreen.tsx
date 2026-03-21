import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import api from '../../lib/api';

const PLACEHOLDERS = [
  "Get a job at Google as SDE",
  "Prepare for GATE CSE 2026",
  "Learn web development from scratch",
  "Score 8 bands in IELTS"
];

export const GoalInputScreen = () => {
  const navigation = useNavigation<any>();
  const [goalText, setGoalText] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleNext = async () => {
    if (goalText.length < 10) return;
    setLoading(true);
    try {
      const res = await api.post('/api/v1/goals/onboard/start', { goal_text: goalText });
      const { session_id, domain, questions } = res.data;
      navigation.navigate('Questions', { sessionId: session_id, goalText, domain, questions });
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Could not reach the server';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <View style={styles.content}>
        <Text style={styles.title}>What do you want to achieve?</Text>
        
        <TextInput
          style={styles.input}
          placeholder={PLACEHOLDERS[placeholderIndex]}
          placeholderTextColor={theme.colors.neutral.borderMid}
          multiline
          maxLength={200}
          value={goalText}
          onChangeText={setGoalText}
          autoFocus
        />
        
        <Text style={styles.charCount}>
          {goalText.length} / 200{goalText.length > 0 && goalText.length < 10 && " (min 10 chars)"}
        </Text>
      </View>

      <TouchableOpacity 
        style={[styles.button, (goalText.length < 10 || loading) && styles.buttonDisabled]} 
        onPress={handleNext}
        disabled={goalText.length < 10 || loading}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.neutral.white} style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Analysing your goal...</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Build my roadmap →</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    padding: theme.spacing[24],
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    marginTop: theme.spacing[32],
  },
  title: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[24],
  },
  input: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  charCount: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    marginTop: theme.spacing[8],
    alignSelf: 'flex-end',
  },
  button: {
    backgroundColor: theme.colors.accent.coral,
    paddingVertical: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginBottom: theme.spacing[16],
  },
  buttonDisabled: {
    backgroundColor: theme.colors.accent.coralLight,
  },
  buttonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
