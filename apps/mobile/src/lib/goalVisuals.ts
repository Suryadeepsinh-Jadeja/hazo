export interface GoalVisualTheme {
  id: string;
  gradient: [string, string];
  accent: string;
  accentSoft: string;
  accentMuted: string;
  onAccent: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  pillBg: string;
  pillText: string;
  pattern: 'orb' | 'beam' | 'rings' | 'arc' | 'spark' | 'leaf';
}

const THEMES: GoalVisualTheme[] = [
  {
    id: 'ember',
    gradient: ['#D6674A', '#281814'],
    accent: '#D6674A',
    accentSoft: '#F3C5B7',
    accentMuted: '#F8E3DB',
    onAccent: '#FFF8F3',
    surface: '#FFF7F2',
    surfaceAlt: '#FBE6DE',
    border: '#E4B4A5',
    pillBg: '#FDE7DE',
    pillText: '#A84A32',
    pattern: 'orb',
  },
  {
    id: 'lagoon',
    gradient: ['#0B7A75', '#0E1F2D'],
    accent: '#0B7A75',
    accentSoft: '#9EDFD5',
    accentMuted: '#E1F5F1',
    onAccent: '#F4FFFD',
    surface: '#F5FEFC',
    surfaceAlt: '#DDF5F1',
    border: '#A9DDD6',
    pillBg: '#DDF7F2',
    pillText: '#0C615D',
    pattern: 'beam',
  },
  {
    id: 'royal',
    gradient: ['#4F46E5', '#1D1748'],
    accent: '#4F46E5',
    accentSoft: '#B9B5FF',
    accentMuted: '#ECEBFF',
    onAccent: '#F9F8FF',
    surface: '#F8F7FF',
    surfaceAlt: '#E8E6FF',
    border: '#C8C2FF',
    pillBg: '#ECEAFF',
    pillText: '#4138C8',
    pattern: 'rings',
  },
  {
    id: 'citrus',
    gradient: ['#E49B1F', '#3E2B0E'],
    accent: '#D48700',
    accentSoft: '#F5D58D',
    accentMuted: '#FFF1D4',
    onAccent: '#FFFDF8',
    surface: '#FFFBF2',
    surfaceAlt: '#FDF0D4',
    border: '#E8C785',
    pillBg: '#FFF0C9',
    pillText: '#A26200',
    pattern: 'arc',
  },
  {
    id: 'berry',
    gradient: ['#B93E6A', '#2E1622'],
    accent: '#B93E6A',
    accentSoft: '#F0B2C8',
    accentMuted: '#FCEAF0',
    onAccent: '#FFF7FA',
    surface: '#FFF8FB',
    surfaceAlt: '#F9E0E8',
    border: '#E7B4C4',
    pillBg: '#FDE4EC',
    pillText: '#8E2E51',
    pattern: 'spark',
  },
  {
    id: 'forest',
    gradient: ['#4B8B3B', '#162514'],
    accent: '#4B8B3B',
    accentSoft: '#B6DDAA',
    accentMuted: '#EEF8E9',
    onAccent: '#F9FFF7',
    surface: '#F8FFF5',
    surfaceAlt: '#E4F3DF',
    border: '#B8D5AE',
    pillBg: '#E9F7E3',
    pillText: '#3A6C2F',
    pattern: 'leaf',
  },
];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

export const getGoalVisualTheme = (goalKey?: string | null): GoalVisualTheme => {
  if (!goalKey) {
    return THEMES[0];
  }

  return THEMES[hashString(goalKey) % THEMES.length];
};
