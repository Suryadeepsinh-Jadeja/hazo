import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import Config from 'react-native-config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = Config.SUPABASE_URL || Config.PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey =
  Config.SUPABASE_ANON_KEY || Config.PUBLIC_SUPABASE_ANON_KEY || '';
const appRedirectUrl = 'stride://auth';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const signInWithEmail = async (email: string, password: string) => {
  return await supabase.auth.signInWithPassword({ email, password });
};

export const signUpWithEmail = async (email: string, password: string, name: string) => {
  return await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: appRedirectUrl,
    },
  });
};

const handleOAuthRedirect = async (url: string) => {
  if (!url.startsWith(appRedirectUrl)) {
    return;
  }

  const parsedUrl = new URL(url);
  const code = parsedUrl.searchParams.get('code');

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
    return;
  }

  const hash = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash;
  const hashParams = new URLSearchParams(hash);
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  if (accessToken && refreshToken) {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }
};

export const initializeOAuthDeepLinks = () => {
  Linking.getInitialURL()
    .then((initialUrl) => {
      if (initialUrl) {
        return handleOAuthRedirect(initialUrl);
      }
    })
    .catch((error) => {
      console.warn('Failed to process initial auth redirect:', error);
    });

  const subscription = Linking.addEventListener('url', ({ url }) => {
    handleOAuthRedirect(url).catch((error) => {
      console.warn('Failed to process auth redirect:', error);
    });
  });

  return () => {
    subscription.remove();
  };
};

export const signInWithGoogle = async () => {
  const response = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: appRedirectUrl,
      skipBrowserRedirect: true,
    },
  });

  if (response.error) {
    return response;
  }

  if (!response.data?.url) {
    return {
      data: response.data,
      error: new Error('Supabase did not return a Google sign-in URL.'),
    };
  }

  await Linking.openURL(response.data.url);

  return response;
};

export const signOut = async () => {
  return await supabase.auth.signOut();
};

export const getCurrentSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
};
