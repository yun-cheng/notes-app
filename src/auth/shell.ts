const KEY = 'notes-app:shell';

/**
 * True inside the native app, which opens the site with ?shell=native. Remembered, because
 * later loads of the app (from its own cache) don't carry the parameter.
 */
export function isNativeShell(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('shell') === 'native') {
      localStorage.setItem(KEY, 'native');
      params.delete('shell');
      const rest = params.toString();
      history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    }
    return localStorage.getItem(KEY) === 'native';
  } catch {
    return false;
  }
}
