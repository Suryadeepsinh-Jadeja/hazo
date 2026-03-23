import { create } from 'zustand';
import { buildGoalVisualThemeMap, GoalVisualTheme } from '../lib/goalVisuals';

// Goal interface placeholder 
export interface Goal {
  id?: string;
  _id?: string;
  title: string;
  [key: string]: any;
}

interface GoalState {
  activeGoalId: string | null;
  goals: Goal[];
  goalThemes: Record<string, GoalVisualTheme>;
  setActiveGoalId: (id: string | null) => void;
  setGoals: (goals: Goal[]) => void;
}

export const useGoalStore = create<GoalState>((set) => ({
  activeGoalId: null,
  goals: [],
  goalThemes: {},
  setActiveGoalId: (id) => set({ activeGoalId: id }),
  setGoals: (goals) =>
    set({
      goals,
      goalThemes: buildGoalVisualThemeMap(goals),
    }),
}));
