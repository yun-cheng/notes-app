import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { buildSearch } from '../../domain/search';
import { useCards } from '../../state/CardsContext';
import { CardRow, Empty, Page } from '../components';

/** How many results the search page draws at first, and adds with each Show more: a word's first letters can find thousands. */
const SHOWN = 100;

export function SearchPage() {
  const { index } = useCards();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const engine = useMemo(() => buildSearch(index), [index]);
  const hits = useMemo(() => engine.search(query), [engine, query]);
  const [more, setMore] = useState({ query, shown: SHOWN });
  const shown = more.query === query ? more.shown : SHOWN;
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
          {hits.slice(0, shown).map((h) => (
            <CardRow key={h.card.id} card={h.card} detail={h.snippet} />
          ))}
        </div>
      )}
      {hits.length > shown && (
        <button type="button" className="btn btn--quiet stream__more" onClick={() => setMore({ query, shown: shown + SHOWN })}>
          Show more results ({hits.length - shown} left)
        </button>
      )}
    </Page>
  );
}
