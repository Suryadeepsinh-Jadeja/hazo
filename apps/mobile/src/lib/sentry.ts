import * as Sentry from '@sentry/react-native';
import Config from 'react-native-config';

export const initSentry = () => {
  const dsn = Config.SENTRY_DSN || '';
  if (!dsn) {
    console.warn('SENTRY_DSN not found. Sentry telemetry is disabled.');
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: 0.2, // capture 20% of transactions for performance
    debug: false,
  });
};

export const captureException = (error: any, context?: any) => {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
};
