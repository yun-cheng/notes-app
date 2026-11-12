import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { AuthGate, useAccount } from '../auth/AuthContext';
import { PairPage } from '../auth/PairPage';
import { useSyncStatus } from '../state/CardsContext';
import { describeSync } from '../sync/engine';
import { useNewNote } from './components';
import { Icon, type IconName } from './Icon';
import { ConnectPage } from './pages/ai';
import { PublicPage } from './pages/public';
import { CardPage, DayPage } from './pages/cards';
import { ChangesPage } from './pages/changes';
import { HistoryPage } from './pages/history';
import { SettingsPage } from './pages/SettingsPage';
import { VaultPage, VaultsPage } from './pages/vaults';
import { EntrySheet, JournalPage, OldNoteRedirect } from './pages/journal';
import { TagsPage } from './pages/tags';
import { CalendarPage, SearchPage } from './pages/views';
import { CommandPalette } from './CommandPalette';
import { FilterPanel } from './FilterPanel';
import { journalPath, type SheetState } from './paths';
import { isMac, ShortcutsDialog } from './Shortcuts';
import { ToastProvider, useToast } from './Toast';
import { useUndo } from './useUndo';

/** The phone's tab bar. Today is a journal filter: open todos due by today. */
const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/journal', label: 'Journal', icon: 'notes' },
  { to: journalPath({ status: 'today' }), label: 'Today', icon: 'today' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/search', label: 'Search', icon: 'search' },
];

function TabBar() {
  const { pathname, search } = useLocation();
  const here = pathname + search;
  // The journal tab stays lit for any filter except the one that has its own tab.
  const active = (to: string) => (to === '/journal' ? pathname === '/journal' && !TABS.some((t) => t.to === here && t.to !== to) : here === to || pathname === to);
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((n) => (
        <Link key={n.to} to={n.to} className={active(n.to) ? 'active' : undefined} aria-current={active(n.to) ? 'page' : undefined}>
          <Icon name={n.icon} size={22} />
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Sidebar({ onCommands }: { onCommands: () => void }) {
  const newNote = useNewNote();
  const sync = useSyncStatus();
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">Notes</div>
      <button type="button" className="btn btn--primary sidebar__new" onClick={() => void newNote()}>
        New note
      </button>
      <button type="button" className="nav-item sidebar__commands" onClick={onCommands}>
        <Icon name="search" />
        <span>Search</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <FilterPanel />
      <p className="sidebar__sync" role="status">
        {describeSync(sync)}
      </p>
      <NavLink to="/settings" className="nav-item">
        <Icon name="settings" />
        <span>Backup & settings</span>
      </NavLink>
    </aside>
  );
}

function SessionBanner() {
  const { state } = useSyncStatus();
  const { signOut } = useAccount();
  if (state !== 'expired') return null;
  return (
    <div className="banner" role="alert">
      <span>Your session ended. Your notes are safe here, but they won't sync until you sign in again.</span>
      <button type="button" className="btn" onClick={() => void signOut()}>
        Sign in again
      </button>
    </div>
  );
}

function Layout() {
  const toast = useToast();
  const [commands, setCommands] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const undoing = useUndo();
  const undo = useRef(undoing);
  undo.current = undoing;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault();
        setCommands((open) => !open);
        return;
      }
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]');
      // Undo and redo for the whole app. A text box keeps its own, for what is typed in it.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !typing && !e.defaultPrevented) {
        const redo = (key === 'z' && e.shiftKey) || (!isMac && key === 'y' && !e.shiftKey);
        if (redo || (key === 'z' && !e.shiftKey)) {
          e.preventDefault();
          void (redo ? undo.current.redo() : undo.current.undo());
          return;
        }
      }
      // `/` opens it too, and `?` the list of shortcuts, when they aren't being typed into something.
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.dialog-backdrop')) return;
      if (e.key === '/' || e.key === '?') {
        e.preventDefault();
        if (e.key === '/') setCommands(true);
        else setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onFailure = (e: PromiseRejectionEvent) => {
      console.error(e.reason);
      toast("Something couldn't be saved. Try again, and download a backup if it keeps happening.", { sticky: true });
    };
    window.addEventListener('unhandledrejection', onFailure);
    return () => window.removeEventListener('unhandledrejection', onFailure);
  }, [toast]);

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh: () =>
        toast('A new version is ready', { sticky: true, action: { label: 'Reload', run: () => void update(true) } }),
    });
  }, [toast]);

  return (
    <div className="app">
      <Sidebar onCommands={() => setCommands(true)} />
      <main className="main">
        <SessionBanner />
        <Outlet />
      </main>
      <TabBar />
      {commands && <CommandPalette onClose={() => setCommands(false)} onShortcuts={() => setShortcuts(true)} />}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Routes>
        {/* A public link needs no account, so it sits outside sign-in. */}
        <Route path="s/:token" element={<PublicPage />} />
        <Route path="*" element={<SignedInApp />} />
      </Routes>
    </ToastProvider>
  );
}

function SignedInApp() {
  const location = useLocation();
  // A sheet opened from a page keeps that page underneath it.
  const background = (location.state as SheetState | null)?.background;
  return (
    <AuthGate>
      <Routes location={background ?? location}>
        <Route path="oauth/authorize" element={<ConnectPage />} />
        <Route path="pair" element={<PairPage />} />
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/journal" replace />} />
          <Route path="today" element={<Navigate to={journalPath({ status: 'today' })} replace />} />
          <Route path="upcoming" element={<Navigate to={journalPath({ status: 'upcoming' })} replace />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="journal" element={<JournalPage />}>
            <Route path=":id" element={<EntrySheet />} />
          </Route>
          <Route path="history" element={<ChangesPage />} />
          <Route path="notes/:id?" element={<OldNoteRedirect />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="vaults" element={<VaultsPage />} />
          <Route path="vault/:id" element={<VaultPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="card/:id" element={<CardPage />} />
          <Route path="card/:id/history" element={<HistoryPage />} />
          <Route path="day/:date" element={<DayPage />} />
          <Route path="day/:date/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/journal" replace />} />
        </Route>
      </Routes>
      {background && (
        <Routes>
          <Route path="journal/:id" element={<EntrySheet />} />
        </Routes>
      )}
    </AuthGate>
  );
}
