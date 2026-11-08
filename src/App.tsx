import { useEffect, useState } from 'react';
import { Ticket } from 'lucide-react';
import { usePath, linkProps, navigate } from './router';
import { initNative } from './native';
import { loadSaved } from './store';
import { Logo } from './ui';
import Home from './pages/Home';
import EventPage from './pages/EventPage';
import MyRides from './pages/MyRides';
import ManageLink from './pages/ManageLink';
import Privacy from './pages/Privacy';
import Admin from './pages/Admin';

export default function App() {
  const path = usePath();
  const [count, setCount] = useState(loadSaved().length);
  useEffect(() => setCount(loadSaved().length), [path]);
  useEffect(() => initNative(() => {
    if (window.location.pathname === '/') return false;
    history.length > 1 ? history.back() : navigate('/');
    return true;
  }), []);

  let page;
  let m: RegExpMatchArray | null;
  if (path === '/') page = <Home />;
  else if ((m = path.match(/^\/e\/([\w-]+)\/?$/))) page = <EventPage id={m[1]} />;
  else if (path === '/me') page = <MyRides />;
  else if ((m = path.match(/^\/m\/([\w.-]+)$/))) page = <ManageLink token={m[1]} />;
  else if (path === '/privacy') page = <Privacy />;
  else if (path === '/organisers') page = <Admin />;
  else page = <div className="py-20 text-center"><h1 className="text-2xl font-bold">Page not found</h1><a {...linkProps('/')} className="mt-4 inline-block font-semibold text-brand">Back to events</a></div>;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Logo />
          <nav className="flex items-center gap-1 text-sm font-semibold">
            <a {...linkProps('/me')} className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 ${path === '/me' ? 'text-brand' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Ticket className="h-4 w-4" /> My rides
              {count > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{count}</span>}
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{page}</main>
      <footer className="safe-bottom border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} FlowRide · Built in Manchester</span>
          <span className="flex gap-4">
            <a {...linkProps('/privacy')} className="hover:text-brand">Privacy</a>
            <a {...linkProps('/organisers')} className="hover:text-brand">Organisers</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
