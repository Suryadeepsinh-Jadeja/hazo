export const colors = {
  primary: {
    ink: '#1A1714',
    inkLight: '#2E2B27',
    inkMuted: '#5C5750',
  },
  accent: {
    coral: '#D4614A',
    coralLight: '#FAF0EC',
    coralDark: '#B04C38',
  },
  positive: {
    sage: '#2D6A4F',
    sageLight: '#EAF4EF',
  },
  warning: {
    amber: '#C07B00',
    amberLight: '#FDF6E3',
  },
  danger: {
    rose: '#B03A3A',
    roseLight: '#FBF0F0',
  },
  neutral: {
    cream: '#FAF8F3',
    creampaper: '#F2EFE7',
    white: '#FFFFFF',
    border: '#E4DFD6',
    borderMid: '#D4CFC5',
  },
};

export const typography = {
  fontDisplay: 'PlayfairDisplay-Bold',
  fontBody: 'Lora-Regular',
  fontMono: 'DMMono-Regular',
  fontSizes: {
    xs: 11,
    sm: 12,
    base: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    xxxl: 36,
  },
  fontWeights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};

export const spacing = {
  '4': 4,
  '8': 8,
  '12': 12,
  '16': 16,
  '20': 20,
  '24': 24,
  '32': 32,
  '48': 48,
  '64': 64,
};

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const shadows = {
  xs: { shadowColor: colors.primary.ink, shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  sm: { shadowColor: colors.primary.ink, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  md: { shadowColor: colors.primary.ink, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  lg: { shadowColor: colors.primary.ink, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  coral: { shadowColor: colors.accent.coral, shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
};

export const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
};

export default theme;
