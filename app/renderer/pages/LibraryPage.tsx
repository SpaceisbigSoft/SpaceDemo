// Demo library (plan 4.3): the person's demo folders, read-only. Search, filters, sorting, drag-and-drop.
// Watch (4.5), Fix (4.6) and the details page (4.4) come in the next steps.
import { useMemo, useState, type DragEvent } from 'react';
import type { LibraryDemo, LibraryState } from '../../shared/api.js';
import { FolderIcon } from '../icons.js';
import { formatDate, formatLength, formatVersion, formatVoice, searchText, STATUS_TEXT } from '../format.js';

type Filter = 'all' | 'needs-fix' | 'plays' | 'voice' | 'map' | 'problem';
type SortKey = 'name' | 'map' | 'date' | 'length' | 'voice';

const FILTERS: { id: Filter; label: string; test: (d: LibraryDemo) => boolean; hideWhenEmpty?: boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'needs-fix', label: 'Needs fixing', test: (d) => d.status === 'needs-fix' || d.status === 'damaged' },
  { id: 'plays', label: 'Plays as is', test: (d) => d.status === 'plays', hideWhenEmpty: true },
  { id: 'voice', label: 'With voice', test: (d) => !!d.info && d.info.talkBursts > 0 },
  { id: 'map', label: 'Map problems', test: (d) => d.map?.kind === 'bad' || d.map?.kind === 'warn', hideWhenEmpty: true },
  { id: 'problem', label: "Can't use", test: (d) => d.status === 'unreadable' || d.status === 'not-cs', hideWhenEmpty: true },
];

const SORTS: Record<SortKey, (a: LibraryDemo, b: LibraryDemo) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  map: (a, b) => (a.info?.map ?? '').localeCompare(b.info?.map ?? '') || b.date - a.date,
  date: (a, b) => a.date - b.date,
  length: (a, b) => (a.info?.seconds ?? 0) - (b.info?.seconds ?? 0),
  voice: (a, b) => (a.info?.voiceSeconds ?? a.info?.talkBursts ?? 0) - (b.info?.voiceSeconds ?? b.info?.talkBursts ?? 0),
};

export function LibraryPage({ library }: { library?: LibraryState }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [map, setMap] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });
  const [dragging, setDragging] = useState(false);

  const demos = library?.demos ?? [];
  const folders = library?.folders ?? [];
  const maps = useMemo(() => [...new Set(demos.map((d) => d.info?.map).filter((m): m is string => !!m))].sort(), [demos]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter)!;
    const rows = demos.filter((d) => f.test(d) && (!map || d.info?.map === map) && (!q || q.split(/\s+/).every((w) => searchText(d).includes(w))));
    const cmp = SORTS[sort.key];
    return rows.sort((a, b) => (sort.desc ? -cmp(a, b) : cmp(a, b)));
  }, [demos, query, filter, map, sort]);

  const add = () => void window.spacedemo.addToLibrary();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => window.spacedemo.pathForFile(f)).filter(Boolean);
    if (paths.length) void window.spacedemo.addToLibrary(paths);
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragging) setDragging(true); },
    onDragLeave: (e: DragEvent) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop,
  };

  const sortButton = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <button
        type="button"
        className="th-sort"
        aria-label={`Sort by ${label.toLowerCase()}`}
        onClick={() => setSort(active ? { key, desc: !sort.desc } : { key, desc: key === 'date' || key === 'length' || key === 'voice' })}
      >
        {label}
        <span aria-hidden="true" className="sort-mark">{active ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    );
  };
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined);

  return (
    <div className={`library${dragging ? ' dragging' : ''}`} {...dropProps} data-testid="library">
      {dragging && <div className="drop-overlay" aria-hidden="true">Drop folders, demos or zips to add them</div>}
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <h1>Demo library</h1>
          <span className="page-sub" data-testid="library-summary">
            {folders.length === 0 ? 'No demo folders added yet.' : `${demos.length} demo${demos.length === 1 ? '' : 's'} in ${folders.length} folder${folders.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {folders.length > 0 && <button type="button" className="btn" onClick={() => void window.spacedemo.rescanLibrary()} disabled={!!library?.scan}>Read again</button>}
          <button type="button" className={`btn${folders.length === 0 ? ' primary' : ''}`} onClick={add}>Add folder…</button>
        </div>
      </div>

      {folders.length > 0 && (
        <ul className="folder-list" aria-label="Library folders">
          {folders.map((f) => (
            <li key={f}>
              <FolderIcon size={16} />
              <span className="mono">{f}</span>
              <button type="button" className="link-btn" onClick={() => void window.spacedemo.removeFromLibrary(f)} aria-label={`Remove ${f} from the library`}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {library?.scan && (
        <div className="progress" role="status" data-testid="library-progress">
          <span>Reading demos… {library.scan.done} of {library.scan.total}</span>
          <progress max={library.scan.total} value={library.scan.done} />
        </div>
      )}

      {folders.length === 0 ? (
        <section className="card empty" aria-labelledby="lib-empty-h">
          <span className="icon"><FolderIcon /></span>
          <h2 id="lib-empty-h">Add your old demos</h2>
          <p>Choose a folder with old Counter-Strike demos, or drag folders, .dem files or .zip files onto this window. Demos inside zips are read straight from the zip.</p>
          <button type="button" className="btn primary" onClick={add}>Add folder…</button>
        </section>
      ) : (
        <>
          <div className="toolbar">
            <label htmlFor="search" className="visually-hidden">Search demos</label>
            <input id="search" type="search" className="search" placeholder="Search demos, players, maps, servers…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div role="group" aria-label="Show" className="chips">
              {FILTERS.map((f) => {
                const n = demos.filter(f.test).length;
                if (f.hideWhenEmpty && n === 0 && filter !== f.id) return null;
                return (
                  <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label} {n}
                  </button>
                );
              })}
            </div>
            <label htmlFor="mapfilter" className="muted-label">Map</label>
            <select id="mapfilter" className="select" value={map} onChange={(e) => setMap(e.target.value)}>
              <option value="">All maps</option>
              {maps.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="table-wrap">
            <table className="demo-table" data-testid="demo-table">
              <thead>
                <tr>
                  <th scope="col" aria-sort={ariaSort('name')}>{sortButton('name', 'Demo')}</th>
                  <th scope="col" aria-sort={ariaSort('map')}>{sortButton('map', 'Map')}</th>
                  <th scope="col" aria-sort={ariaSort('date')}>{sortButton('date', 'Date')}</th>
                  <th scope="col" aria-sort={ariaSort('length')}>{sortButton('length', 'Length')}</th>
                  <th scope="col">Type</th>
                  <th scope="col">Version</th>
                  <th scope="col" aria-sort={ariaSort('voice')}>{sortButton('voice', 'Voice')}</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="visually-hidden">File</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => <Row key={d.key} d={d} />)}
              </tbody>
            </table>
            {shown.length === 0 && demos.length > 0 && <p className="note table-empty">No demos match. Clear the search or pick "All".</p>}
            {demos.length === 0 && !library?.scan && <p className="note table-empty">No demos found in these folders (looking for .dem files, also inside .zip files).</p>}
          </div>
          <p className="note">Your demos are only read, never changed. Watching, fixing and the details page arrive in the next steps (4.4–4.6).</p>
        </>
      )}
    </div>
  );
}

function Row({ d }: { d: LibraryDemo }) {
  const i = d.info;
  const where = d.zipEntry ? `${d.file} → ${d.zipEntry}` : d.file;
  const title = [where, ...d.alsoAt.map((a) => `Same demo also at ${a}`)].join('\n');
  const mapNote = d.map?.note ?? '';
  const extraMaps = i && i.maps.length > 1 ? ` · +${i.maps.length - 1} more map${i.maps.length > 2 ? 's' : ''}` : '';
  return (
    <tr data-testid="demo-row" data-status={d.status}>
      <td>
        <div className="cell-stack">
          <span className="demo-name" title={title}>{d.name}</span>
          <span className="sub">{d.error ?? i?.hostName ?? (d.zipEntry ? 'in a zip' : '')}</span>
        </div>
      </td>
      <td>
        <div className="cell-stack">
          <span className="mono">{i?.map ?? ''}</span>
          <span className={`sub map-${d.map?.kind ?? 'unknown'}`}>{mapNote}{extraMaps}</span>
        </div>
      </td>
      <td className="nowrap" title={d.dateSource === 'file' ? "File date (the recording date isn't known)" : 'Recording date (from the zip)'}>
        {formatDate(d.date)}{d.dateSource === 'file' && <span className="sub"> · file</span>}
      </td>
      <td className="mono">{i ? formatLength(i.seconds) : ''}</td>
      <td>{i?.recording ?? ''}</td>
      <td className="nowrap" title={i ? `Network protocol ${i.networkProtocol} (today's CS 1.6 uses 48)` : undefined}>{i ? formatVersion(i.networkProtocol) : ''}</td>
      <td className={`nowrap voice${i && i.talkBursts === 0 ? ' none' : ''}`}>{formatVoice(d)}</td>
      <td><span className={`status status-${d.status}`} title={d.error ?? i?.problems.join('\n') ?? ''}>{STATUS_TEXT[d.status]}</span></td>
      <td className="actions">
        <button type="button" className="link-btn" onClick={() => void window.spacedemo.showInFolder(d.file)} aria-label={`Show ${d.name} in Explorer`}>Show file</button>
      </td>
    </tr>
  );
}
