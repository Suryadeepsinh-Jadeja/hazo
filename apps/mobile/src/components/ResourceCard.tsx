import React from 'react';
import { Alert, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { FileText, PlayCircle, Code, Newspaper, BookOpen, ExternalLink } from 'lucide-react-native';
import { Linking } from 'react-native';
import { theme } from '../constants/theme';

// Based on the DB types
export interface Resource {
  resource_id?: string;
  type: 'video' | 'article' | 'notes' | 'problem' | 'course' | string;
  title: string;
  url: string;
  source: string;
  is_free: boolean;
}

export interface ResourceCardProps {
  resource: Resource;
  onPress?: () => void;
}

const normalizeUrl = (rawUrl: string) => {
  if (!rawUrl) {
    return '';
  }

  const trimmed = rawUrl.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
};

export const ResourceCard = ({ resource, onPress }: ResourceCardProps) => {

  const handlePress = async () => {
    if (onPress) {
      onPress();
    } else {
      const url = normalizeUrl(resource.url);

      if (!url) {
        Alert.alert('Link unavailable', 'This material does not have a valid link yet.');
        return;
      }

      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert('Could not open link', 'This material link could not be opened on your device.');
      }
    }
  };

  const IconComponent = () => {
    switch(resource.type) {
      case 'video': return <PlayCircle size={20} color={theme.colors.primary.inkMuted} />;
      case 'article': return <Newspaper size={20} color={theme.colors.primary.inkMuted} />;
      case 'problem': return <Code size={20} color={theme.colors.primary.inkMuted} />;
      case 'notes': return <FileText size={20} color={theme.colors.primary.inkMuted} />;
      default: return <BookOpen size={20} color={theme.colors.primary.inkMuted} />;
    }
  };

  return (
    <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.7}>
      <View style={styles.iconBox}>
        <IconComponent />
      </View>
      
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{resource.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.sourceText}>{resource.source.toUpperCase()}</Text>
          <View style={[styles.priceChip, !resource.is_free && styles.priceChipPaid]}>
            <Text style={[styles.priceText, !resource.is_free && styles.priceTextPaid]}>
              {resource.is_free ? 'FREE' : 'PAID'}
            </Text>
          </View>
        </View>
      </View>
      
      <ExternalLink size={16} color={theme.colors.neutral.borderMid} style={{marginLeft: 8}} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
    borderWidth: 1,
    borderColor: theme.colors.neutral.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[12],
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.neutral.cream,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing[12],
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.ink,
    fontWeight: theme.typography.fontWeights.medium,
    marginBottom: 6,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 10,
    color: theme.colors.primary.inkMuted,
    marginRight: theme.spacing[12],
    letterSpacing: 0.5,
  },
  priceChip: {
    backgroundColor: theme.colors.positive.sageLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priceChipPaid: {
    backgroundColor: theme.colors.accent.coralLight,
  },
  priceText: {
    fontFamily: theme.typography.fontMono,
    fontSize: 9,
    fontWeight: 'bold',
    color: theme.colors.positive.sageDark,
  },
  priceTextPaid: {
    color: theme.colors.accent.coralDark,
  },
});
