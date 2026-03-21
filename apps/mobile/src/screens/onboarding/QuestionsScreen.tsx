import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { theme } from '../../constants/theme';
import api from '../../lib/api';

type Message = { id: string, text: string, isUser: boolean, isTyping?: boolean };

const DEFAULT_QUESTIONS = [
  "What is your target timeline?",
  "What is your prior knowledge or experience in this field?",
  "How many hours can you dedicate daily?",
  "What is your budget for learning materials?",
  "Any specific external materials you want to use? (Optional)"
];

export const QuestionsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { sessionId, questions: backendQuestions } = route.params || {};

  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [inputText, setInputText] = useState('');
  const [inputType, setInputType] = useState<'text' | 'numeric' | 'budget'>('text');
  
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    askNextQuestion();
  }, [currentQIndex]);

  const askNextQuestion = () => {
    const isCompleted = currentQIndex >= 6;
    if (isCompleted) {
      finalizeOnboarding();
      return;
    }

    // Typing indicator delay
    const typingMsg = { id: `typing-${currentQIndex}`, text: '...', isUser: false, isTyping: true };
    setMessages(prev => [...prev, typingMsg]);

    setTimeout(async () => {
      let qText = '';
      // Use backend questions if available, else fall back to defaults
      const questionList = backendQuestions?.length >= 5
        ? backendQuestions.map((q: any) => typeof q === 'string' ? q : q.label || q.question)
        : DEFAULT_QUESTIONS;

      if (currentQIndex < 5) {
        qText = questionList[currentQIndex] || DEFAULT_QUESTIONS[currentQIndex];
        
        if (currentQIndex === 2) setInputType('numeric');
        else if (currentQIndex === 3) setInputType('budget');
        else setInputType('text');
      } else {
        // Fetch custom AI Question 6 via POST
        try {
          const answers: Record<string, string> = {};
          const userMsgs = messages.filter(m => m.isUser);
          userMsgs.forEach((m, idx) => {
            answers[`q${idx + 1}`] = m.text;
          });
          const res = await api.post('/api/v1/goals/onboard/q6', { session_id: sessionId, answers });
          qText = res.data.question || "Lastly, what do you feel is your biggest obstacle right now?";
        } catch {
          qText = "Lastly, what do you feel is your biggest obstacle right now?";
        }
        setInputType('text');
      }

      setMessages(prev => {
        const filtered = prev.filter(m => !m.isTyping);
        return [...filtered, { id: `q-${currentQIndex}`, text: qText, isUser: false }];
      });

    }, 600);
  };

  const handleSend = (textOverride?: string) => {
    const textToSend = textOverride !== undefined ? textOverride : inputText;
    if (!textToSend.trim() && currentQIndex !== 4) return; // Q5 is optional
    
    setMessages(prev => [...prev, { id: `a-${currentQIndex}`, text: textToSend.trim() || 'Skipped', isUser: true }]);
    setInputText('');
    
    setCurrentQIndex(prev => prev + 1);
  };

  const finalizeOnboarding = async () => {
    try {
      // Build all_answers dict keyed by question field names
      const userAnswers = messages.filter(m => m.isUser).map(m => m.text);
      const allAnswers: Record<string, string> = {};
      userAnswers.forEach((a, idx) => {
        allAnswers[`q${idx + 1}`] = a;
      });
      await api.post('/api/v1/goals/onboard/complete', { session_id: sessionId, all_answers: allAnswers });
    } catch (e) {
      // Non-fatal: roadmap generation may still work
      console.warn('Error submitting onboarding answers:', e);
    }
    navigation.navigate('Generating', { sessionId });
  };

  const renderInputArea = () => {
    if (inputType === 'budget') {
      return (
        <View style={styles.chipRow}>
          <TouchableOpacity style={styles.chip} onPress={() => handleSend('Free only')}>
            <Text style={styles.chipText}>Free only</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chip} onPress={() => handleSend('Open to paid')}>
            <Text style={styles.chipText}>Open to paid</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="Type your answer..."
          placeholderTextColor={theme.colors.neutral.borderMid}
          value={inputText}
          onChangeText={setInputText}
          keyboardType={inputType === 'numeric' ? 'numeric' : 'default'}
        />
        {(inputText.trim().length > 0 || currentQIndex === 4) && (
          <TouchableOpacity style={styles.sendButton} onPress={() => handleSend()}>
            <Text style={styles.sendButtonText}>{inputText ? 'Send' : 'Skip'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <Animated.View style={[styles.bubbleWrap, item.isUser ? styles.bubbleUserWrap : styles.bubbleAiWrap]} entering={FadeInDown.springify().damping(20).delay(200)}>
            {!item.isUser && (
              <View style={styles.bubbleAvatar}>
                 <Text style={styles.avatarText}>M</Text>
              </View>
            )}
            <View style={[styles.bubble, item.isUser ? styles.bubbleUser : styles.bubbleAi]}>
              {item.isTyping ? (
                 <ActivityIndicator size="small" color={theme.colors.primary.inkMuted} style={styles.typingIndicator} />
              ) : (
                item.isUser ? (
                  <Text style={styles.bubbleUserText}>{item.text}</Text>
                ) : (
                  <Text style={styles.bubbleAiText}>{item.text}</Text>
                )
              )}
            </View>
          </Animated.View>
        )}
      />
      {!messages.find(m => m.isTyping) && renderInputArea()}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
  },
  listContent: {
    padding: theme.spacing[16],
    paddingBottom: theme.spacing[32],
  },
  bubbleWrap: {
    width: '100%',
    marginBottom: theme.spacing[12],
    flexDirection: 'row',
  },
  bubbleAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.accent.coralLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    alignSelf: 'flex-end',
    marginBottom: 4,
  },
  avatarText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.accent.coralDark,
    fontWeight: theme.typography.fontWeights.bold,
  },
  bubbleUserWrap: {
    justifyContent: 'flex-end',
  },
  bubbleAiWrap: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[12],
  },
  bubbleAi: {
    backgroundColor: theme.colors.neutral.white,
    borderRadius: theme.borderRadius.md,
    borderBottomLeftRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  bubbleUser: {
    backgroundColor: theme.colors.primary.ink,
    borderRadius: theme.borderRadius.md,
    borderBottomRightRadius: 0,
  },
  bubbleAiText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
  },
  bubbleUserText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.neutral.white,
  },
  typingIndicator: {
    marginVertical: theme.spacing[4],
  },
  inputContainer: {
    flexDirection: 'row',
    padding: theme.spacing[16],
    backgroundColor: theme.colors.neutral.white,
    borderTopWidth: 1,
    borderColor: theme.colors.neutral.border,
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    minHeight: 40,
  },
  sendButton: {
    marginLeft: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[12],
    backgroundColor: theme.colors.accent.coral,
    borderRadius: theme.borderRadius.xs,
  },
  sendButtonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.medium,
  },
  chipRow: {
    flexDirection: 'row',
    padding: theme.spacing[16],
    justifyContent: 'center',
    gap: theme.spacing[12],
    backgroundColor: theme.colors.neutral.white,
    borderTopWidth: 1,
    borderColor: theme.colors.neutral.border,
  },
  chip: {
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[20],
    backgroundColor: theme.colors.accent.coralLight,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.accent.coral,
  },
  chipText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.accent.coralDark,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
