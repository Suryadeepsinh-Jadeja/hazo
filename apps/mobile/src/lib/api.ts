import axios, { AxiosResponse } from 'axios';
import { supabase } from './supabase';
import Config from 'react-native-config';

// ─── Axios instance ──────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: Config.API_URL || 'http://localhost:8000',
});

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      console.warn('Unauthorized! Signing out and redirecting to login...');
    }
    return Promise.reject(error);
  },
);

// ─── TanStack Query staleTime constants ──────────────────────────────────────

export const STALE_TIMES = {
  todayCard: 30 * 60 * 1000,   // 30 minutes
  roadmap:   60 * 60 * 1000,   // 60 minutes
  skills:    10 * 60 * 1000,   // 10 minutes
  tasks:      2 * 60 * 1000,   //  2 minutes
} as const;

// ─── TypeScript interfaces ───────────────────────────────────────────────────

export interface OnboardStartResponse {
  session_id: string;
  goal_text: string;
  domain: string;
  questions: string[];
}

export interface OnboardQ6Response {
  question_6: string;
}

export interface OnboardCompleteResponse {
  status: string;
  goal_id?: string;
}

export interface OnboardStatusResponse {
  status: 'processing' | 'complete' | 'failed';
  goal_id?: string;
  error?: string;
}

export interface Resource {
  resource_id: string;
  type: string;
  title: string;
  url: string;
  source: string;
  is_free: boolean;
  verified_at?: string;
  is_broken: boolean;
}

export interface Topic {
  topic_id: string;
  title: string;
  day_index: number;
  estimated_minutes: number;
  ai_note: string;
  resources: Resource[];
  status: 'locked' | 'pending' | 'in_progress' | 'done' | 'skipped';
  completed_at?: string;
}

export interface DailyTaskCard {
  goal_id: string;
  goal_title: string;
  date: string;
  topics: Topic[];
  available_minutes: number;
  task_mode_count: number;
  phase_title: string;
  day_index: number;
  total_days: number;
}

export interface Subtask {
  subtask_id: string;
  title: string;
  estimated_minutes: number;
  status: 'pending' | 'done';
}

export interface Task {
  _id: string;
  raw_input: string;
  due_date?: string;
  priority: 'low' | 'medium' | 'high';
  estimated_minutes: number;
  ai_subtasks: Subtask[];
  status: 'pending' | 'done' | 'overdue';
}

export interface Skill {
  _id: string;
  name: string;
  mastery_level: number;
  domain: string;
  last_practiced?: string;
}

export interface CommunityRoom {
  _id: string;
  name: string;
  domain: string;
  member_count: number;
  is_private: boolean;
  invite_code?: string;
}

export interface RoomProgress {
  member_count: number;
  active_today: number;
  collective_progress_pct: number;
  top_streaks: { display_name: string; streak_count: number }[];
}

// ─── Goals API ───────────────────────────────────────────────────────────────

export const goals = {
  onboard: {
    start: async (goalText: string): Promise<OnboardStartResponse> => {
      const { data } = await api.post('/api/v1/goals/onboard/start', {
        goal_text: goalText,
      });
      return data;
    },

    q6: async (
      sessionId: string,
      answers: Record<string, string>,
    ): Promise<OnboardQ6Response> => {
      const { data } = await api.post('/api/v1/goals/onboard/q6', {
        session_id: sessionId,
        answers,
      });
      return data;
    },

    complete: async (
      sessionId: string,
      allAnswers: Record<string, string>,
    ): Promise<OnboardCompleteResponse> => {
      const { data } = await api.post('/api/v1/goals/onboard/complete', {
        session_id: sessionId,
        answers: allAnswers,
      });
      return data;
    },

    status: async (sessionId: string): Promise<OnboardStatusResponse> => {
      const { data } = await api.get(
        `/api/v1/goals/onboard/status/${sessionId}`,
      );
      return data;
    },
  },

  getToday: async (goalId: string): Promise<DailyTaskCard> => {
    const { data } = await api.get(`/api/v1/goals/${goalId}/today`);
    return data;
  },

  getGoal: async (goalId: string) => {
    const { data } = await api.get(`/api/v1/goals/${goalId}`);
    return data;
  },

  getGoals: async () => {
    const { data } = await api.get('/api/v1/goals');
    return data;
  },

  complete: async (
    goalId: string,
    topicId: string,
  ): Promise<{ status: string }> => {
    const { data } = await api.post(
      `/api/v1/goals/${goalId}/topics/${topicId}/complete`,
    );
    return data;
  },

  skip: async (
    goalId: string,
    topicId: string,
  ): Promise<{ status: string }> => {
    const { data } = await api.post(
      `/api/v1/goals/${goalId}/topics/${topicId}/skip`,
    );
    return data;
  },

  replan: async (goalId: string): Promise<{ status: string }> => {
    const { data } = await api.post(`/api/v1/goals/${goalId}/replan`);
    return data;
  },
};

// ─── Tasks API ───────────────────────────────────────────────────────────────

export const tasks = {
  create: async (input: string): Promise<Task> => {
    const { data } = await api.post('/api/v1/tasks', { raw_input: input });
    return data;
  },

  getTasks: async (): Promise<Task[]> => {
    const { data } = await api.get('/api/v1/tasks');
    return data;
  },
};

// ─── Skills API ──────────────────────────────────────────────────────────────

export const skills = {
  getGraph: async (goalId: string): Promise<Skill[]> => {
    const { data } = await api.get(`/api/v1/skills/${goalId}`);
    return data;
  },
};

// ─── Community API ───────────────────────────────────────────────────────────

export const community = {
  getRooms: async (domain?: string): Promise<CommunityRoom[]> => {
    const params = domain ? { domain } : {};
    const { data } = await api.get('/api/v1/community/rooms', { params });
    return data;
  },

  joinRoom: async (
    roomId: string,
  ): Promise<{ room: CommunityRoom; member_count: number }> => {
    const { data } = await api.post(
      `/api/v1/community/rooms/${roomId}/join`,
    );
    return data;
  },

  getRoomProgress: async (roomId: string): Promise<RoomProgress> => {
    const { data } = await api.get(
      `/api/v1/community/rooms/${roomId}/progress`,
    );
    return data;
  },
};

// ─── Mentor (SSE streaming) ──────────────────────────────────────────────────
// NOTE: mentor.chat uses SSE streaming via fetch in MentorScreen.tsx.
// Do NOT add it here — the MentorScreen implementation is already correct.

export const mentor = {
  getHistory: async (goalId: string) => {
    const { data } = await api.get(`/api/v1/mentor/history/${goalId}`);
    return data;
  },
};

export default api;
