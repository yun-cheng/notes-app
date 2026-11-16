import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { buildSearch } from '../../domain/search';
import { useCards } from '../../state/CardsContext';
import { CardRow, Empty, Page } from '../components';

export function SearchPage() {
  const { index } = useCards();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const engine = useMemo(() => buildSearch(index), [index]);
  const hits = useMemo(() => engine.search(query), [engine, query]);
  return (
    <Page title="Search">
      <input
        className="search-input"
        type="search"
        autoFocus
        value={query}
        placeholder="Search notes, todos and tags"
        aria-label="Search"
        enterKeyHint="search"
        onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
      />
      {query.trim() && !hits.length && <Empty>No results for “{query.trim()}”.</Empty>}
      {hits.length > 0 && (
        <div className="list">
          {hits.map((h) => (
            <CardRow key={h.card.id} card={h.card} detail={h.snippet} />
          ))}
        </div>
      )}
    </Page>
  );
}
