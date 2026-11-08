// When FlowRide runs inside the iOS/Android app (Capacitor), the native bridge is injected
// as window.Capacitor. The website works the same either way; this just adds native touches.
type Cap = { isNativePlatform(): boolean; getPlatform(): string; Plugins: Record<string, any> };
const cap = (): Cap | undefined => (window as any).Capacitor;

export const isNativeApp = () => !!cap()?.isNativePlatform?.();

export async function shareLink(title: string, text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    const Share = cap()?.Plugins?.Share;
    if (isNativeApp() && Share) { await Share.share({ title, text, url, dialogTitle: title }); return 'shared'; }
    if (navigator.share) { await navigator.share({ title, text, url }); return 'shared'; }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (e: any) {
    return e?.name === 'AbortError' ? 'shared' : 'failed';
  }
}

export function initNative(goBack: () => boolean) {
  if (!isNativeApp()) return;
  document.documentElement.classList.add('native-app');
  const App = cap()!.Plugins.App;
  // Android hardware back button: go back in the site, exit only from the home screen.
  App?.addListener?.('backButton', () => { if (!goBack()) App.exitApp(); });
}
