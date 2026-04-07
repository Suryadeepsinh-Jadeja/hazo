import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { theme } from '../../constants/theme';
import { goals, OnboardingQuestion } from '../../lib/api';

type Message = { id: string, text: string, isUser: boolean, isTyping?: boolean };
type QuestionConfig = OnboardingQuestion;

const DEFAULT_QUESTIONS: QuestionConfig[] = [
  { field_name: 'timeline', question_text: 'What is your target timeline for this goal?', input_type: 'text' },
  { field_name: 'dailyHours', question_text: 'On most days, how many hours can you dedicate to this goal?', input_type: 'numeric' },
  { field_name: 'priorKnowledge', question_text: 'What is your current level or prior experience in this area?', input_type: 'text' },
  { field_name: 'budget', question_text: 'Are you limited to free resources, or open to paid ones?', input_type: 'budget' },
  { field_name: 'existingMaterials', question_text: 'Any syllabus, books, courses, notes, or resources Hazo should consider? (Optional)', input_type: 'text' },
];

export const QuestionsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { sessionId, questions: backendQuestions } = route.params || {};

  const [messages, setMessages] = useState<Message[]>([]);
  const [questions, setQuestions] = useState<QuestionConfig[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [followupStage, setFollowupStage] = useState(0);
  const [inputText, setInputText] = useState('');
  const [inputType, setInputType] = useState<'text' | 'numeric' | 'budget'>('text');
  const [answerMap, setAnswerMap] = useState<Record<string, string>>({});
  
  const flatListRef = useRef<FlatList>(null);
  const questionConfigs = useMemo<QuestionConfig[]>(() => {
    if (backendQuestions?.length) {
      return backendQuestions.map((question: any, index: number) => {
        if (typeof question === 'string') {
          return {
            field_name: `q${index + 1}`,
            question_text: question,
            input_type: 'text',
          };
        }

        return {
          field_name: question.field_name || `q${index + 1}`,
          question_text: question.question_text || question.label || question.question || DEFAULT_QUESTIONS[index]?.question_text || `Question ${index + 1}`,
          input_type: question.input_type || DEFAULT_QUESTIONS[index]?.input_type || 'text',
        };
      });
    }

    return DEFAULT_QUESTIONS;
  }, [backendQuestions]);

  useEffect(() => {
    setQuestions(questionConfigs);
  }, [questionConfigs]);

  const removeTypingIndicator = () => {
    setMessages((prev) => prev.filter((message) => !message.isTyping));
  };

  const resolveInputType = (question?: QuestionConfig): 'text' | 'numeric' | 'budget' => {
    if (!question) {
      return 'text';
    }
    if (question.input_type) {
      return question.input_type;
    }
    if (question.field_name === 'budget') {
      return 'budget';
    }
    if (['dailyHours', 'timelineWeeks', 'hoursPerWeek'].includes(question.field_name)) {
      return 'numeric';
    }
    return 'text';
  };

  const askQuestion = (question: QuestionConfig, questionIndex: number) => {
    const typingMsg = { id: `typing-${questionIndex}-${Date.now()}`, text: '...', isUser: false, isTyping: true };
    setMessages((prev) => [...prev, typingMsg]);

    setTimeout(() => {
      removeTypingIndicator();
      setInputType(resolveInputType(question));
      setMessages((prev) => [
        ...prev,
        { id: `q-${questionIndex}-${question.field_name}`, text: question.question_text, isUser: false },
      ]);
    }, 600);
  };

  const advanceConversation = async (
    nextQuestionIndex: number,
    nextAnswers: Record<string, string>,
    availableQuestions: QuestionConfig[] = questions,
    completedFollowupStages: number = followupStage,
  ) => {
    if (nextQuestionIndex < availableQuestions.length) {
      askQuestion(availableQuestions[nextQuestionIndex], nextQuestionIndex);
      return;
    }

    if (!sessionId) {
      finalizeOnboarding();
      return;
    }

    if (completedFollowupStages < 2) {
      const typingMsg = { id: `typing-stage-${completedFollowupStages + 1}`, text: '...', isUser: false, isTyping: true };
      setMessages((prev) => [...prev, typingMsg]);
      try {
        const nextStage = (completedFollowupStages + 1) as 1 | 2;
        const res = await goals.onboard.followups(sessionId, nextAnswers, nextStage);
        const newQuestions = (res.questions || []).filter(
          (question) => question?.field_name && question?.question_text,
        );
        removeTypingIndicator();

        if (!newQuestions.length) {
          finalizeOnboarding();
          return;
        }

        const updatedQuestions = [...availableQuestions, ...newQuestions];
        setQuestions(updatedQuestions);
        setFollowupStage(nextStage);
        askQuestion(newQuestions[0], nextQuestionIndex);
        return;
      } catch (error: any) {
        removeTypingIndicator();
        Alert.alert(
          'Could not continue onboarding',
          error?.response?.data?.detail || 'Please try again in a moment.',
        );
        return;
      }
    }

    finalizeOnboarding();
  };

  useEffect(() => {
    if (!questions.length || messages.length > 0) {
      return;
    }

    advanceConversation(0, {});
  }, [questions]);

  const handleSend = (textOverride?: string) => {
    const textToSend = textOverride !== undefined ? textOverride : inputText;
    const currentQuestion = questions[currentQIndex];
    const isOptional = currentQuestion?.field_name === 'existingMaterials';
    if (!textToSend.trim() && !isOptional) return;

    const answer = textToSend.trim() || 'Skipped';
    const fieldName = currentQuestion?.field_name || `q${currentQIndex + 1}`;
    const nextAnswers = { ...answerMap, [fieldName]: answer };
    const nextQuestionIndex = currentQIndex + 1;

    setMessages(prev => [...prev, { id: `a-${currentQIndex}`, text: answer, isUser: true }]);
    setAnswerMap(nextAnswers);
    setInputText('');
    setCurrentQIndex(nextQuestionIndex);
    advanceConversation(nextQuestionIndex, nextAnswers);
  };

  const finalizeOnboarding = async () => {
    navigation.navigate('AvailabilitySetup', { sessionId, answerMap });
  };

  const renderInputArea = () => {
    const currentQuestion = questions[currentQIndex];
    const isOptional = currentQuestion?.field_name === 'existingMaterials';

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
        {(inputText.trim().length > 0 || isOptional) && (
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
