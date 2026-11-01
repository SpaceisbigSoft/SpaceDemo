// The app frame (plan 4.2): title bar, left navigation, the game card and the current page.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { FixBatchState, GameStatus, LibraryState } from '../shared/api.js';
import { FixIcon, LibraryIcon, LogoMark, PlayersIcon, SettingsIcon } from './icons.js';
import { PlayersPage } from './pages/PlayersPage.js';
import { LibraryPage } from './pages/LibraryPage.js';
import { FixPage } from './pages/FixPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { DetailsPage } from './pages/DetailsPage.js';
import { WatchDialog } from './WatchDialog.js';

export type PageId = 'library' | 'fix' | 'players' | 'settings' | 'details';

const PAGES: { id: PageId; label: string; Icon: () => ReactElement }[] = [
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  { id: 'fix', label: 'Fix & convert', Icon: FixIcon },
  { id: 'players', label: 'Players', Icon: PlayersIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export function App() {
  const [page, setPage] = useState<PageId>('library');
  const [game, setGame] = useState<GameStatus | undefined>();
  const [looking, setLooking] = useState(true);
  const [library, setLibrary] = useState<LibraryState | undefined>();
  const [detailsKey, setDetailsKey] = useState<string | undefined>();
  const openDetails = (key: string) => { setDetailsKey(key); setPage('details'); };
  const [fixBatch, setFixBatch] = useState<FixBatchState | undefined>();
  useEffect(() => {
    void window.spacedemo.getFixBatch().then(setFixBatch);
    return window.spacedemo.onFixBatch(setFixBatch);
  }, []);
  const fixAll = (keys: string[]) => { void window.spacedemo.fixDemos(keys); setPage('fix'); };
  const [watchKey, setWatchKey] = useState<string | undefined>();
  const watchDemo = library?.demos.find((d) => d.key === watchKey);
  const navPage: PageId = page === 'details' ? 'library' : page;

  useEffect(() => {
    void window.spacedemo.getLibrary().then(setLibrary);
    return window.spacedemo.onLibraryChanged(setLibrary);
  }, []);

  const lookForGame = useCallback(async () => {
    setLooking(true);
    try {
      setGame(await window.spacedemo.findGame());
    } finally {
      setLooking(false);
    }
  }, []);

  useEffect(() => { void lookForGame(); }, [lookForGame]);

  // Light or dark: the app says which; the page's colours follow <html data-theme>.
  useEffect(() => {
    const apply = (dark: boolean) => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; };
    void window.spacedemo.getTheme().then((s) => apply(s.dark));
    return window.spacedemo.onThemeChanged((s) => apply(s.dark));
  }, []);

  const current = PAGES.find((p) => p.id === navPage)!;
  const detailsDemo = library?.demos.find((d) => d.key === detailsKey);

  return (
    <div className="app">
      <header className="titlebar">
        <LogoMark size={16} />
        <strong>SpaceDemo</strong>
        <span aria-hidden="true">·</span>
        <span data-testid="titlebar-page">{current.label}{page === 'details' && detailsDemo ? ` › ${detailsDemo.name}` : ''}</span>
        {library?.scan && <span className="titlebar-progress">· reading demos {library.scan.done}/{library.scan.total}</span>}
        {fixBatch?.running && <span className="titlebar-progress">· fixing {fixBatch.items.filter((i) => i.state !== 'waiting' && i.state !== 'fixing').length}/{fixBatch.items.length}</span>}
      </header>
      <div className="frame">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <LogoMark />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="brand-name">SpaceDemo</span>
              <span className="brand-tag">old demos, original voice</span>
            </div>
          </div>
          {PAGES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className="nav-item"
              aria-current={navPage === id ? 'page' : undefined}
              onClick={() => setPage(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
          <GameCard game={game} looking={looking} onOpen={() => setPage('settings')} />
        </nav>
        <main className={`page${page === 'library' ? ' page-fixed' : ''}`} data-testid={`page-${page}`}>
          {page === 'library' && <LibraryPage library={library} onOpen={openDetails} onWatch={setWatchKey} onFixAll={fixAll} fixing={!!fixBatch?.running} />}
          {page === 'details' && <DetailsPage demo={detailsDemo} onBack={() => setPage('library')} onWatch={setWatchKey} onOpen={openDetails} />}
          {page === 'fix' && <FixPage batch={fixBatch} library={library} onWatch={setWatchKey} />}
          {page === 'players' && <PlayersPage />}
          {page === 'settings' && <SettingsPage game={game} looking={looking} onLookAgain={lookForGame} />}
        </main>
      </div>
      {watchDemo && <WatchDialog demo={watchDemo} onClose={() => setWatchKey(undefined)} />}
    </div>
  );
}

function GameCard({ game, looking, onOpen }: { game?: GameStatus; looking: boolean; onOpen: () => void }) {
  let state: ReactElement;
  if (looking && !game) state = <span className="state">Looking…</span>;
  else if (game?.found) {
    state = (
      <>
        <span className="state ok">Found{game.version ? ` · ${game.version}` : ''}</span>
        {(game.library ?? game.gameDir) && <span className="where">{game.library ?? game.gameDir}</span>}
      </>
    );
  } else state = <span className="state bad">Not found · open Settings</span>;
  return (
    <button type="button" className="game-card" data-testid="game-card" onClick={onOpen}>
      <span className="label">Counter-Strike 1.6</span>
      {state}
    </button>
  );
}
