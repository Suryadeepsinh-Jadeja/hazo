import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import { signInWithEmail, signInWithGoogle } from '../../lib/supabase';

export const LoginScreen = () => {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error } = await signInWithEmail(email, password);
      if (error) throw error;
      navigation.reset({ index: 0, routes: [{ name: 'App' }] });
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
      navigation.reset({ index: 0, routes: [{ name: 'App' }] });
    } catch (err: any) {
      setError(err.message || 'Google login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back</Text>
      
      {error && <Text style={styles.errorText}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={theme.colors.neutral.borderMid}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={theme.colors.neutral.borderMid}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity 
        style={[styles.button, loading && styles.buttonDisabled]} 
        onPress={handleLogin} 
        disabled={loading}
      >
        {loading ? <ActivityIndicator color={theme.colors.neutral.white} /> : <Text style={styles.buttonText}>Log In</Text>}
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.googleButton} 
        onPress={handleGoogleLogin} 
        disabled={loading}
      >
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account? </Text>
        <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.footerLink}>Sign Up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.cream,
    padding: theme.spacing[24],
    justifyContent: 'center',
  },
  title: {
    fontFamily: theme.typography.fontDisplay,
    fontSize: theme.typography.fontSizes.xxl,
    color: theme.colors.primary.ink,
    marginBottom: theme.spacing[32],
    textAlign: 'center',
  },
  errorText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.danger.rose,
    marginBottom: theme.spacing[16],
    textAlign: 'center',
  },
  input: {
    fontFamily: theme.typography.fontBody,
    backgroundColor: theme.colors.neutral.white,
    borderColor: theme.colors.neutral.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[16],
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary.ink,
  },
  button: {
    backgroundColor: theme.colors.accent.coral,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginBottom: theme.spacing[16],
  },
  buttonDisabled: {
    backgroundColor: theme.colors.accent.coralLight,
  },
  buttonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.neutral.white,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  googleButton: {
    backgroundColor: theme.colors.neutral.white,
    borderColor: theme.colors.neutral.borderMid,
    borderWidth: 1,
    padding: theme.spacing[16],
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginBottom: theme.spacing[32],
  },
  googleButtonText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.primary.ink,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.medium,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  footerText: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.primary.inkMuted,
    fontSize: theme.typography.fontSizes.base,
  },
  footerLink: {
    fontFamily: theme.typography.fontBody,
    color: theme.colors.accent.coral,
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});
