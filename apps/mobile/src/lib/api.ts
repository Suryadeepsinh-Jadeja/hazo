import axios from 'axios';
import { supabase } from './supabase';
import Config from 'react-native-config';

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
  }
);

export const goals = {
  getGoals: async () => {
    console.warn("MOCK: endpoint not implemented yet");
    return [];
  },
};

export const tasks = {
  getTasks: async () => {
    console.warn("MOCK: endpoint not implemented yet");
    return [];
  },
};

export const mentor = {
  getMessages: async () => {
    console.warn("MOCK: endpoint not implemented yet");
    return [];
  },
};

export const skills = {
  getSkills: async () => {
    console.warn("MOCK: endpoint not implemented yet");
    return [];
  },
};

export default api;
