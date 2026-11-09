import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { CardsProvider, useCards } from '../state/CardsContext';
import { useNewNote } from './components';
import { Icon, type IconName } from './Icon';
import { CardPage, DayPage } from './pages/cards';
import { SettingsPage } from './pages/SettingsPage';
import { CalendarPage, NotesPage, SearchPage, TagsPage, TodayPage, UpcomingPage } from './pages/views';
import { cardPath } from './paths';
import { ToastProvider, useToast } from './Toast';

const MAIN_NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/today', label: 'Today', icon: 'today' },
  { to: '/upcoming', label: 'Upcoming', icon: 'upcoming' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/notes', label: 'Notes', icon: 'notes' },
  { to: '/search', label: 'Search', icon: 'search' },
];

function Sidebar() {
  const { index } = useCards();
  const newNote = useNewNote();
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">Notes</div>
      <button type="button" className="btn btn--primary sidebar__new" onClick={() => void newNote()}>
        New note
      </button>
      <nav aria-label="Main">
        {MAIN_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-item">
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <nav aria-label="Folders" className="sidebar__group">
        <h2>Folders</h2>
        {index.pinnedTags.map((t) => (
          <NavLink key={t.id} to={cardPath(t)} className="nav-item">
            <Icon name="tag" />
            <span>{t.title}</span>
            <span className="nav-item__count">{(index.backlinks.get(t.id) ?? []).filter((l) => l.kind === 'tag').length}</span>
          </NavLink>
        ))}
        <NavLink to="/tags" className="nav-item nav-item--quiet">
          <span className="nav-item__pad" />
          <span>All tags</span>
        </NavLink>
      </nav>
      <NavLink to="/settings" className="nav-item sidebar__foot">
        <Icon name="settings" />
        <span>Backup & settings</span>
      </NavLink>
    </aside>
  );
}

function Layout() {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        void navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

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
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Main">
        {MAIN_NAV.map((n) => (
          <NavLink key={n.to} to={n.to}>
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <CardsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="upcoming" element={<UpcomingPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="card/:id" element={<CardPage />} />
            <Route path="day/:date" element={<DayPage />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Route>
        </Routes>
      </CardsProvider>
    </ToastProvider>
  );
}
