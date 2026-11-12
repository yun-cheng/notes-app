import type { DiffGap, DiffLine } from '../domain/history';
import { Empty } from './components';

/** Two versions of a card compared, line by line. A gap stands for unchanged lines that were left out. */
export function Diff({ lines }: { lines: (DiffLine | DiffGap)[] }) {
  if (!lines.length) return <Empty>This version is empty.</Empty>;
  return (
    <div className="diff">
      {lines.map((line, i) =>
        line.kind === 'gap' ? (
          <p key={i} className="diff__gap" title={`${line.count} unchanged ${line.count === 1 ? 'line' : 'lines'}`}>
            ⋯
          </p>
        ) : line.kind === 'changed' ? (
          <p key={i} className="diff__line">
            {line.pieces.map((piece, j) =>
              piece.kind === 'same' ? piece.text : piece.kind === 'added' ? <ins key={j}>{piece.text}</ins> : <del key={j}>{piece.text}</del>,
            )}
          </p>
        ) : (
          <p key={i} className={`diff__line diff__line--${line.kind}`}>
            {line.kind === 'added' ? <ins>{line.text}</ins> : line.kind === 'removed' ? <del>{line.text}</del> : line.text || ' '}
          </p>
        ),
      )}
    </div>
  );
}
