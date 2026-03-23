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

export interface GoalThemeCandidate {
  _id?: string;
  id?: string;
  title?: string | null;
  status?: string | null;
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

const normalizeHex = (value: string) => value.replace('#', '');

const mixHex = (start: string, end: string, amount: number) => {
  const safeAmount = Math.max(0, Math.min(1, amount));
  const startHex = normalizeHex(start);
  const endHex = normalizeHex(end);

  const startR = parseInt(startHex.slice(0, 2), 16);
  const startG = parseInt(startHex.slice(2, 4), 16);
  const startB = parseInt(startHex.slice(4, 6), 16);

  const endR = parseInt(endHex.slice(0, 2), 16);
  const endG = parseInt(endHex.slice(2, 4), 16);
  const endB = parseInt(endHex.slice(4, 6), 16);

  const mixed = (from: number, to: number) =>
    Math.round(from + (to - from) * safeAmount)
      .toString(16)
      .padStart(2, '0');

  return `#${mixed(startR, endR)}${mixed(startG, endG)}${mixed(startB, endB)}`;
};

const getGoalKey = (goal?: GoalThemeCandidate | null) =>
  goal?._id || goal?.id || goal?.title || null;

const createThemeVariant = (
  baseTheme: GoalVisualTheme,
  variantIndex: number
): GoalVisualTheme => {
  const mixTarget = variantIndex % 2 === 1 ? '#FFFFFF' : '#000000';
  const depthStep = Math.floor((variantIndex - 1) / 2);
  const mixAmount = 0.1 + depthStep * 0.06;

  return {
    ...baseTheme,
    id: `${baseTheme.id}-${variantIndex}`,
    gradient: [
      mixHex(baseTheme.gradient[0], mixTarget, Math.min(0.28, mixAmount)),
      mixHex(baseTheme.gradient[1], mixTarget, Math.min(0.22, mixAmount * 0.9)),
    ],
    accent: mixHex(baseTheme.accent, mixTarget, Math.min(0.22, mixAmount)),
    accentSoft: mixHex(baseTheme.accentSoft, mixTarget, Math.min(0.26, mixAmount * 1.1)),
    accentMuted: mixHex(baseTheme.accentMuted, mixTarget, Math.min(0.18, mixAmount * 0.8)),
    surface: mixHex(baseTheme.surface, mixTarget, Math.min(0.12, mixAmount * 0.5)),
    surfaceAlt: mixHex(baseTheme.surfaceAlt, mixTarget, Math.min(0.16, mixAmount * 0.65)),
    border: mixHex(baseTheme.border, mixTarget, Math.min(0.2, mixAmount * 0.8)),
    pillBg: mixHex(baseTheme.pillBg, mixTarget, Math.min(0.18, mixAmount * 0.7)),
    pillText: mixHex(baseTheme.pillText, mixTarget, Math.min(0.14, mixAmount * 0.55)),
  };
};

const getThemeForIndex = (index: number): GoalVisualTheme => {
  if (index < THEMES.length) {
    return THEMES[index];
  }

  const baseTheme = THEMES[index % THEMES.length];
  const variantIndex = Math.floor(index / THEMES.length);
  return createThemeVariant(baseTheme, variantIndex);
};

export const getGoalVisualTheme = (goalKey?: string | null): GoalVisualTheme => {
  if (!goalKey) {
    return THEMES[0];
  }

  return THEMES[hashString(goalKey) % THEMES.length];
};

export const buildGoalVisualThemeMap = (
  goals: GoalThemeCandidate[] = []
): Record<string, GoalVisualTheme> => {
  const themeMap: Record<string, GoalVisualTheme> = {};

  const activeGoals = goals
    .filter((goal) => goal?.status === 'active')
    .filter((goal): goal is GoalThemeCandidate => Boolean(getGoalKey(goal)))
    .sort((left, right) => hashString(getGoalKey(left)!) - hashString(getGoalKey(right)!));

  activeGoals.forEach((goal, index) => {
    const key = getGoalKey(goal);
    if (!key) {
      return;
    }
    themeMap[key] = getThemeForIndex(index);
  });

  goals.forEach((goal) => {
    const key = getGoalKey(goal);
    if (!key || themeMap[key]) {
      return;
    }

    themeMap[key] = getGoalVisualTheme(key);
  });

  return themeMap;
};
