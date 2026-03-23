import {AppRegistry} from 'react-native';
import notifee from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';
import {handleBackgroundNotificationEvent} from './src/lib/notifications';

notifee.onBackgroundEvent(handleBackgroundNotificationEvent);

AppRegistry.registerComponent(appName, () => App);
