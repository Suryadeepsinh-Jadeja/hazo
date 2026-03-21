import notifee, { TriggerType, TimestampTrigger, EventType, RepeatFrequency, AuthorizationStatus } from '@notifee/react-native';
import { getMessaging, getToken, requestPermission, AuthorizationStatus as FBAuthStatus } from '@react-native-firebase/messaging';
import api from './api';

/**
 * Requests permissions, retrieves FCM token, and saves it to the backend.
 */
export async function registerForPushNotifications() {
  try {
    // Request local notification permission first
    const notifeeAuth = await notifee.requestPermission();

    // Guard: Firebase may not be initialized in dev/emulator
    let fcmToken: string | null = null;
    try {
      const fbMessaging = getMessaging();
      const messagingAuth = await requestPermission(fbMessaging);
      const enabled =
        messagingAuth === FBAuthStatus.AUTHORIZED ||
        messagingAuth === FBAuthStatus.PROVISIONAL ||
        notifeeAuth.authorizationStatus === AuthorizationStatus.AUTHORIZED;

      if (enabled) {
        fcmToken = await getToken(fbMessaging);
      }
    } catch (firebaseErr) {
      // Firebase not configured — fall back to local-only notifications
      console.info('Firebase not available, using local notifications only.');
    }

    if (fcmToken) {
      await api.put('/api/v1/users/me/preferences', { push_token: fcmToken });
    }
  } catch (error) {
    console.warn('Failed to register or sync push preferences', error);
  }
}

/**
 * Schedules a daily recurring local notification via Notifee.
 * time format must be "HH:MM" in 24h
 */
export async function scheduleDailyReminder(time: string) {
  try {
    const [hours, minutes] = time.split(':').map(Number);
    
    const now = new Date();
    const triggerDate = new Date();
    triggerDate.setHours(hours, minutes, 0, 0);
    
    // If the time has already passed today, schedule for tomorrow
    if (triggerDate <= now) {
      triggerDate.setDate(triggerDate.getDate() + 1);
    }

    // Ensure channel exists (required for Android)
    const channelId = await notifee.createChannel({
      id: 'daily-reminder',
      name: 'Daily Reminder',
    });

    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerDate.getTime(),
      repeatFrequency: RepeatFrequency.DAILY,
    };

    // Cancel existing previous scheduled items gently
    await notifee.cancelTriggerNotifications();

    await notifee.createTriggerNotification(
      {
        title: 'Time to learn! 🚀',
        body: 'Your daily Stride task is waiting for you.',
        android: {
          channelId,
          pressAction: { id: 'default' },
        },
        data: { screen: 'Today' }
      },
      trigger,
    );
  } catch (err) {
    console.warn('Could not schedule reminder constraint:', err);
  }
}

/**
 * Optional function to disable local schedule
 */
export async function cancelDailyReminder() {
  await notifee.cancelTriggerNotifications();
}

/**
 * Handle notification tap in Foreground/Background logic
 */
export function handleNotificationTap(navigation: any) {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      const screen = detail.notification?.data?.screen as string;
      if (screen) {
        navigation.navigate(screen);
      }
    }
  });
}
