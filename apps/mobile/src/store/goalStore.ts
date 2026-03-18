import { create } from 'zustand';

// Goal interface placeholder 
export interface Goal {
  id: string;
  title: string;
  [key: string]: any;
}

interface GoalState {
  activeGoalId: string | null;
  goals: Goal[];
  setActiveGoalId: (id: string | null) => void;
  setGoals: (goals: Goal[]) => void;
}

export const useGoalStore = create<GoalState>((set) => ({
  activeGoalId: null,
  goals: [],
  setActiveGoalId: (id) => set({ activeGoalId: id }),
  setGoals: (goals) => set({ goals }),
}));
