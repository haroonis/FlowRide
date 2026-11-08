import type { CapacitorConfig } from '@capacitor/cli';

// The app is a native shell around the live FlowRide website, so one codebase
// serves the web, iPhone and Android. Set FLOWRIDE_URL when building to point at
// your deployment, e.g. FLOWRIDE_URL=https://flowride.example.org npx cap sync
const url = process.env.FLOWRIDE_URL ?? 'https://flowride.example.org';

const config: CapacitorConfig = {
  appId: 'org.flowride.app',
  appName: 'FlowRide',
  webDir: 'www', // only used for the bundled offline/error screen
  server: {
    url,
    cleartext: url.startsWith('http://'), // allows local testing against http://10.0.2.2:3000
    errorPath: 'offline.html',
  },
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#059669', showSpinner: false },
    StatusBar: { style: 'LIGHT', backgroundColor: '#ffffff', overlaysWebView: false },
  },
};

export default config;
