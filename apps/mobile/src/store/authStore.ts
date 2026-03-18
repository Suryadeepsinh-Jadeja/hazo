import { create } from 'zustand';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, getCurrentSession } from '../lib/supabase';
import api from '../lib/api';

interface AuthState {
  user: any | null; // Mapped to UserDB type from API
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: any | null) => void;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  syncUserToBackend: (sbUser: SupabaseUser) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  
  setSession: (session) => {
    set({ session });
    if (session?.user) {
      get().syncUserToBackend(session.user);
    }
  },

  syncUserToBackend: async (sbUser) => {
    try {
      const { data } = await api.post('/api/v1/auth/sync', {
        supabase_id: sbUser.id,
        email: sbUser.email,
        name: sbUser.user_metadata?.name || 'User',
      });
      get().setUser(data);
    } catch (error) {
      console.warn('Failed to sync user with backend:', error);
    }
  },

  signOut: async () => {
    set({ isLoading: true });
    try {
      await supabase.auth.signOut();
    } finally {
      set({ user: null, session: null, isAuthenticated: false, isLoading: false });
    }
  },

  initialize: async () => {
    try {
      const session = await getCurrentSession();
      set({ session });
      if (session?.user) {
        await get().syncUserToBackend(session.user);
      }
    } catch (error) {
      console.warn('Auth initialization error:', error);
    } finally {
      set({ isLoading: false });
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      get().setSession(session);
    });
  },
}));
