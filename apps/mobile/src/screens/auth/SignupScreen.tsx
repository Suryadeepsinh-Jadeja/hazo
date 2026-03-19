import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import { signUpWithEmail } from '../../lib/supabase';
import { toast } from '../../lib/toast';

export const SignupScreen = () => {
  const navigation = useNavigation<any>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async () => {
    if (!name || !email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await signUpWithEmail(email, password, name);
      if (error) throw error;

      if (data.session) {
        toast.show('Account created successfully.', 'success');
        return;
      }

      toast.show('Account created. Please check your email to verify, then log in.', 'success');
      navigation.navigate('Login');
    } catch (err: any) {
      setError(err.message || 'Signup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      
      {error && <Text style={styles.errorText}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Full Name"
        placeholderTextColor={theme.colors.neutral.borderMid}
        value={name}
        onChangeText={setName}
      />
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
        onPress={handleSignup} 
        disabled={loading}
      >
        {loading ? <ActivityIndicator color={theme.colors.neutral.white} /> : <Text style={styles.buttonText}>Sign Up</Text>}
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account? </Text>
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.footerLink}>Log In</Text>
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
    marginBottom: theme.spacing[32],
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
