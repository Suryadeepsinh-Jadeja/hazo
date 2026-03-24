import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Keyboard, Linking } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay } from 'react-native-reanimated';
import { ChevronLeft, ArrowUp } from 'lucide-react-native';
import { theme } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import Config from 'react-native-config';
import api from '../../lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_ACTIONS = [
  "I didn't understand today's topic",
  "Give me a harder problem",
  "I'm feeling overwhelmed",
  "Explain like I'm 10",
  "What should I focus on?"
];

const MARKDOWN_LINK_OR_URL_RE = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s]+)/g;
const BOLD_RE = /(\*\*[^*]+\*\*)/g;

const TypingDot = ({ delay }: { delay: number }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    scale.value = withDelay(delay, withRepeat(withSequence(
      withTiming(1.3, { duration: 400 }),
      withTiming(1, { duration: 400 })
    ), -1, true));

    opacity.value = withDelay(delay, withRepeat(withSequence(
      withTiming(1, { duration: 400 }),
      withTiming(0.4, { duration: 400 })
    ), -1, true));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.typingDot, animatedStyle]} />;
};

const TypingIndicator = () => (
  <View style={styles.typingContainer}>
    <Text style={styles.hazoRole}>HAZO</Text>
    <View style={styles.dotsRow}>
      <TypingDot delay={0} />
      <TypingDot delay={150} />
      <TypingDot delay={300} />
    </View>
  </View>
);

export const MentorScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { goalId, topicTitle = "Goal Intake" } = route.params || {};
  const { session } = useAuthStore();
  const token = session?.access_token;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);

  const formatMentorError = (error: unknown) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'I could not start the mentor chat right now. Please try again in a moment.';
  };

  const openMessageLink = async (url: string) => {
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await Linking.openURL(normalizedUrl);
  };

  const renderBoldText = (text: string, isUser: boolean, keyPrefix: string) => {
    const parts = text.split(BOLD_RE);

    return parts
      .filter((part) => part.length > 0)
      .map((part, index) => {
        const isBold = part.startsWith('**') && part.endsWith('**');
        const content = isBold ? part.slice(2, -2) : part;

        return (
          <Text
            key={`${keyPrefix}-bold-${index}`}
            style={isBold ? [styles.textBold, isUser ? styles.textUser : styles.textAi] : undefined}
          >
            {content}
          </Text>
        );
      });
  };

  const renderFormattedText = (text: string, isUser: boolean) => {
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let matchIndex = 0;

    for (const match of text.matchAll(MARKDOWN_LINK_OR_URL_RE)) {
      const fullMatch = match[0];
      const matchStart = match.index ?? 0;

      if (matchStart > lastIndex) {
        nodes.push(...renderBoldText(text.slice(lastIndex, matchStart), isUser, `segment-${matchIndex}`));
      }

      const markdownLabel = match[2];
      const markdownUrl = match[3];
      const rawUrl = match[4];
      const linkLabel = markdownLabel || rawUrl || fullMatch;
      const linkUrl = markdownUrl || rawUrl || fullMatch;

      nodes.push(
        <Text
          key={`link-${matchIndex}`}
          style={[styles.textLink, isUser ? styles.textUser : styles.textAi]}
          onPress={() => {
            openMessageLink(linkUrl).catch((error) => {
              console.warn('Failed to open mentor link:', error);
            });
          }}
        >
          {linkLabel}
        </Text>
      );

      lastIndex = matchStart + fullMatch.length;
      matchIndex += 1;
    }

    if (lastIndex < text.length) {
      nodes.push(...renderBoldText(text.slice(lastIndex), isUser, `segment-tail-${matchIndex}`));
    }

    return nodes.length > 0 ? nodes : text;
  };

  const applySsePayload = (
    payload: string,
    assistantMessageId: string,
    currentContent: string,
  ) => {
    let nextContent = currentContent;
    let isDone = false;

    const lines = payload.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data: ')) {
        continue;
      }

      try {
        const data = JSON.parse(line.replace('data: ', ''));
        if (data.error) {
          throw new Error(data.error);
        }
        if (typeof data.delta === 'string' && data.delta.length > 0) {
          nextContent += data.delta;
          setMessages(prev => prev.map(m => (
            m.id === assistantMessageId ? { ...m, content: nextContent } : m
          )));
        }
        if (data.done) {
          isDone = true;
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
      }
    }

    return { nextContent, isDone };
  };

  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      if (!goalId || !token) {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
        return;
      }

      try {
        setIsLoadingHistory(true);
        setHistoryLoadError(null);
        const response = await api.get(`/api/v1/mentor/history/${goalId}`);
        const historyMessages = Array.isArray(response.data) ? response.data : [];
        const mappedMessages: Message[] = historyMessages
          .filter((item) => typeof item?.content === 'string' && item.content.trim().length > 0)
          .map((item, index) => ({
            id: `${item.created_at || 'history'}-${index}`,
            role: (item.role === 'user' ? 'user' : 'assistant') as Message['role'],
            content: item.content,
          }))
          .reverse();

        if (isMounted) {
          setMessages(mappedMessages);
        }
      } catch (error) {
        if (isMounted) {
          const message = formatMentorError(error);
          setHistoryLoadError(message);
          console.warn('Failed to load mentor history:', message);
        }
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [goalId, token]);

  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() || isStreaming || rateLimited || !token || !goalId) return;

    Keyboard.dismiss();
    setInputText('');

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend.trim() };
    const newMessages = [userMsg, ...messages]; // Inverted FlatList matches reversed array
    setMessages(newMessages);

    await streamResponse(textToSend.trim(), newMessages);
  };

  const streamResponse = async (message: string, currentMessages: Message[]) => {
    setIsStreaming(true);
    setRateLimited(false);
    let assistantMessageId = (Date.now() + 1).toString();

    // Create a blank assistant message in state
    setMessages(prev => [{ id: assistantMessageId, role: 'assistant', content: '' }, ...prev]);

    const apiBaseUrl = Config.API_URL || Config.PUBLIC_API_URL || 'http://localhost:8000';
    const url = `${apiBaseUrl}/api/v1/mentor/chat`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ 
          goal_id: goalId, 
          message, 
          history: currentMessages.slice(0, 10).reverse() // send chronological past history
        })
      });

      if (response.status === 429) {
        setMessages(prev => prev.filter(m => m.id !== assistantMessageId)); // remove empty assistant message
        setRateLimited(true);
        setIsStreaming(false);
        return;
      }

      if (!response.ok) {
        let detail = `Mentor request failed (${response.status}).`;
        try {
          const errorPayload = await response.json();
          const errorDetail = errorPayload?.detail;
          if (typeof errorDetail === 'string') {
            detail = errorDetail;
          } else if (errorDetail?.detail && typeof errorDetail.detail === 'string') {
            detail = errorDetail.detail;
          }
        } catch {
          try {
            const errorText = await response.text();
            if (errorText) {
              detail = errorText;
            }
          } catch {
            // ignore body parse failures
          }
        }
        throw new Error(detail);
      }

      let accumulatedContent = '';
      const responseBody = response.body as any;

      if (!responseBody?.getReader) {
        const rawPayload = await response.text();
        if (!rawPayload.trim()) {
          throw new Error('Mentor returned an empty response.');
        }
        const { nextContent } = applySsePayload(rawPayload, assistantMessageId, accumulatedContent);
        accumulatedContent = nextContent;
        return;
      }

      const reader = responseBody.getReader();
      const decoder = new TextDecoder('utf-8');

      let done = false;
      let buffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (!value) {
          continue;
        }

        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventPayload of events) {
          const { nextContent, isDone } = applySsePayload(eventPayload, assistantMessageId, accumulatedContent);
          accumulatedContent = nextContent;
          if (isDone) {
            done = true;
            break;
          }
        }
      }

      if (buffer.trim()) {
        const { nextContent } = applySsePayload(buffer, assistantMessageId, accumulatedContent);
        accumulatedContent = nextContent;
      }
    } catch (error) {
      const friendlyError = formatMentorError(error);
      console.warn('Mentor stream failed:', friendlyError);
      setMessages(prev => prev.map(m => (
        m.id === assistantMessageId
          ? {
              ...m,
              content: `I couldn't start the mentor chat right now.\n\n${friendlyError}`,
            }
          : m
      )));
    } finally {
      setIsStreaming(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message, index: number }) => {
    const isUser = item.role === 'user';
    const previousMessage = messages[index + 1]; // Inverted FlatList: index+1 is older in time
    const isSameSpeaker = previousMessage?.role === item.role;

    return (
      <View style={[
        styles.messageWrapper, 
        isSameSpeaker ? styles.messageSameSpeaker : styles.messageNewSpeaker,
        !isUser && styles.messageAiBlock
      ]}>
        {/* Draw AI Header if new speaking turn */}
        {!isUser && !isSameSpeaker && (
           <Text style={styles.hazoRole}>HAZO</Text>
        )}
        
        <View style={[styles.messageBubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
          <Text style={[styles.messageText, isUser ? styles.textUser : styles.textAi]}>
            {renderFormattedText(item.content, isUser)}
          </Text>
        </View>

        {/* Separator rule below human-to-AI transitions (meaning before the Human message in inverted logic) */}
        {isUser && previousMessage?.role === 'assistant' && (
           <View style={styles.exchangeSeparator} />
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Heavy Header Navbar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ChevronLeft color={theme.colors.primary.ink} size={28} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>AI Mentor</Text>
          <Text style={styles.headerSubtitle}>{topicTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* API 429 Premium Gateway Banner */}
      {rateLimited && (
        <View style={styles.rateLimitBanner}>
          <Text style={styles.rateLimitText}>You have used your 5 free messages today. Upgrade to Pro for unlimited access.</Text>
          <TouchableOpacity style={styles.upgradeButton}>
            <Text style={styles.upgradeText}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Core Chat Scroll/List */}
      {isLoadingHistory ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.hazoRoleEmpty}>HAZO</Text>
          <Text style={styles.welcomeAiText}>Loading your previous mentor chat...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.hazoRoleEmpty}>HAZO</Text>
          <Text style={styles.welcomeAiText}>Hello {session?.user?.user_metadata?.name || 'there'}. I'm your AI Mentor. Let me know what you'd like to work on today, or ask me a question.</Text>
          {historyLoadError && <Text style={styles.historyErrorText}>{historyLoadError}</Text>}
          
          <View style={styles.chipsContainer}>
             {QUICK_ACTIONS.map((action, i) => (
               <TouchableOpacity key={i} style={styles.actionChip} onPress={() => handleSend(action)} disabled={isStreaming || rateLimited}>
                 <Text style={styles.actionChipText}>{action}</Text>
               </TouchableOpacity>
             ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages} 
          keyExtractor={item => item.id}
          inverted
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={isStreaming ? <TypingIndicator /> : null}
        />
      )}

      {/* Editor Output Interface */}
      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          placeholder="Ask me anything..."
          placeholderTextColor={theme.colors.primary.inkMuted}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity 
          style={[styles.sendButton, (!inputText.trim() || isStreaming || rateLimited) && styles.sendButtonDisabled]}
          onPress={() => handleSend()}
          disabled={!inputText.trim() || isStreaming || rateLimited}
        >
          <ArrowUp color={theme.colors.neutral.white} size={20} strokeWidth={3} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream, // #FAF8F3
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: theme.spacing[64],
    paddingBottom: theme.spacing[16],
    paddingHorizontal: theme.spacing[16],
    backgroundColor: theme.colors.neutral.cream,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.border,
  },
  backButton: {
    padding: theme.spacing[8],
  },
  headerTitles: {
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.primary.ink,
  },
  headerSubtitle: {
    fontFamily: theme.typography.fontMono,
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.primary.inkMuted,
    marginTop: 4,
  },
  rateLimitBanner: {
    backgroundColor: theme.colors.danger.roseLight,
    padding: theme.spacing[16],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rateLimitText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.danger.rose,
    flex: 1,
    marginRight: theme.spacing[16],
  },
  upgradeButton: {
    backgroundColor: theme.colors.danger.rose,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.sm,
  },
  upgradeText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  emptyContainer: {
    flex: 1,
    padding: theme.spacing[24],
    justifyContent: 'center',
  },
  hazoRoleEmpty: {
    fontFamily: theme.typography.fontMono,
    fontSize: 9,
    color: theme.colors.accent.coral,
    letterSpacing: 1.8, 
    textTransform: 'uppercase',
    marginBottom: theme.spacing[16],
  },
  welcomeAiText: {
    fontFamily: theme.typography.fontBody,
    fontSize: 22,
    lineHeight: 34,
    color: theme.colors.primary.inkLight,
    marginBottom: theme.spacing[48],
  },
  historyErrorText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.warning.amberDark,
    marginTop: -theme.spacing[24],
    marginBottom: theme.spacing[24],
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[12],
  },
  actionChip: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.neutral.borderMid,
    backgroundColor: theme.colors.neutral.white,
  },
  actionChipText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
  },
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[24],
  },
  hazoRole: {
    fontFamily: theme.typography.fontMono,
    fontSize: 9,
    color: theme.colors.accent.coral,
    letterSpacing: 1.8, // maps precisely to ~0.18em for 10pt
    textTransform: 'uppercase',
    marginBottom: theme.spacing[8],
  },
  messageWrapper: {
    width: '100%',
  },
  messageNewSpeaker: {
    marginBottom: 28,
  },
  messageSameSpeaker: {
    marginBottom: 8,
  },
  messageAiBlock: {
    alignItems: 'flex-start',
    width: '100%',
    paddingRight: theme.spacing[32], 
  },
  messageBubble: {},
  bubbleAi: {
    backgroundColor: 'transparent',
    padding: 0,
  },
  bubbleUser: {
    backgroundColor: theme.colors.neutral.creampaper, // #F2EFE7
    borderWidth: 1,
    borderColor: theme.colors.neutral.border, // #E4DFD6
    borderRadius: theme.borderRadius.md, // 12px
    padding: theme.spacing[12],
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  messageText: {},
  textAi: {
    fontFamily: theme.typography.fontBody,
    fontSize: 15,
    color: theme.colors.primary.inkLight, // #2E2B27
    lineHeight: 26, 
  },
  textUser: {
    fontFamily: theme.typography.fontBody,
    fontSize: 14,
    color: theme.colors.primary.ink,
    lineHeight: 22,
  },
  textBold: {
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.primary.ink,
  },
  textLink: {
    color: theme.colors.accent.coral,
    textDecorationLine: 'underline',
  },
  exchangeSeparator: {
    height: 1,
    width: '50%',
    backgroundColor: theme.colors.neutral.border,
    alignSelf: 'flex-start',
    marginVertical: 32,
    opacity: 0.5,
  },
  typingContainer: {
    alignItems: 'flex-start',
    marginBottom: 28,
    marginTop: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary.inkLight,
  },
  inputArea: {
    flexDirection: 'row',
    padding: theme.spacing[16],
    paddingBottom: Platform.OS === 'ios' ? theme.spacing[32] : theme.spacing[16],
    backgroundColor: theme.colors.neutral.cream,
    borderTopWidth: 1,
    borderColor: theme.colors.neutral.border,
    alignItems: 'flex-end', 
  },
  input: {
    flex: 1,
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[16],
    paddingTop: 12, 
    paddingBottom: 12,
    minHeight: 44,
    maxHeight: 120,
    marginRight: theme.spacing[12],
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accent.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.neutral.borderMid,
  },
});
