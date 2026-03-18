export const theme = {
  colors: {
    primary: {
      ink: '#1A1714',
      inkMuted: '#5C5750',
      inkLight: '#2E2B27',
    },
    neutral: {
      cream: '#FAF8F3',
      white: '#FFFFFF',
      creampaper: '#F2EFE7',
      border: '#E4DFD6',
      borderMid: '#D4CFC5',
    },
    accent: {
      coral: '#D4614A',
      coralDark: '#B34A36',
      coralLight: '#F5D3CD',
    },
    danger: {
      rose: '#E15050',
      roseLight: '#FCECEC',
    },
    warning: {
      amber: '#C07B00',
      amberDark: '#9E6500',
      amberLight: '#FDF6E3',
    },
    positive: {
      sage: '#5E8B65',
      sageDark: '#3A5C41',
      sageLight: '#EAF2EC',
    },
    active: {
      indigo: '#4F46E5',
    }
  },
  spacing: {
    2: 2, 4: 4, 6: 6, 8: 8, 10: 10, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64, 100: 100, 120: 120
  },
  typography: {
    fontDisplay: 'System', // Fallback until Lora added natively
    fontBody: 'System',
    fontMono: 'System',
    fontSizes: {
      xs: 12, sm: 14, base: 16, md: 16, lg: 18, xl: 20, xxl: 24, xxxl: 32
    },
    fontWeights: {
      normal: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
    }
  },
  borderRadius: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 20, full: 9999
  }
};
