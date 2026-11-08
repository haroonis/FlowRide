import { useEffect, useState } from 'react';

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.dispatchEvent(new Event('flowride:navigate'));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    window.addEventListener('flowride:navigate', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('flowride:navigate', on); };
  }, []);
  return path;
}

/** <a> that navigates client-side but still works as a normal link (open in new tab etc). */
export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: { metaKey: boolean; ctrlKey: boolean; preventDefault(): void }) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
