import { useEffect, useState, type ReactNode } from 'react';
import type { Root, RootContent } from 'hast';
import type { createLowlight } from 'lowlight';

type Lowlight = ReturnType<typeof createLowlight>;

/**
 * Syntax colors for code, from highlight.js's common languages through lowlight. They're loaded the first time code
 * is shown, so the app opens without them; until then code shows plain.
 */
let loaded: Lowlight | null = null;
let loading: Promise<Lowlight> | null = null;
const waiting = new Set<() => void>();

export function loadHighlighter(): Promise<Lowlight> {
  loading ??= import('lowlight').then(({ common, createLowlight }) => {
    loaded = createLowlight(common);
    waiting.forEach((done) => done());
    waiting.clear();
    return loaded;
  });
  return loading;
}

export const highlighter = () => loaded;

/** The highlighter once it's loaded, asking for it the first time. */
export function useHighlighter(): Lowlight | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (loaded) return;
    const done = () => redraw((n) => n + 1);
    waiting.add(done);
    void loadHighlighter();
    return () => void waiting.delete(done);
  }, []);
  return loaded;
}

/** Guessing a language is slow on long text, so code longer than this without one is left plain. */
const GUESS_LIMIT = 4000;

/**
 * Code as highlight.js tokens: in its language (`js`, `python`, `sh`…), or a guess when it names none. Null for a
 * language it doesn't know, or code too long to guess.
 */
export function highlightTree(lowlight: Lowlight, code: string, language: string | null): Root | null {
  try {
    if (language) return lowlight.registered(language) ? lowlight.highlight(language, code) : null;
    return code.length <= GUESS_LIMIT ? lowlight.highlightAuto(code) : null;
  } catch {
    return null;
  }
}

/** Each colored run of the code: where it starts and ends in the text, and its classes. */
export function tokenRanges(tree: Root): { from: number; to: number; className: string }[] {
  const ranges: { from: number; to: number; className: string }[] = [];
  let at = 0;
  const visit = (nodes: RootContent[], classes: string[]) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        if (classes.length) ranges.push({ from: at, to: at + node.value.length, className: classes.join(' ') });
        at += node.value.length;
      } else if (node.type === 'element') {
        const own = node.properties?.className;
        visit(node.children, Array.isArray(own) ? [...classes, ...own.map(String)] : classes);
      }
    }
  };
  visit(tree.children, []);
  return ranges;
}

/** Highlight.js tokens as React elements. */
export function renderTree(nodes: RootContent[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    const own = node.properties?.className;
    return (
      <span key={i} className={Array.isArray(own) ? own.join(' ') : undefined}>
        {renderTree(node.children)}
      </span>
    );
  });
}

/** Code in its colors, or plain until they've loaded. */
export function HighlightedCode({ code, language }: { code: string; language: string | null }) {
  const lowlight = useHighlighter();
  const tree = lowlight ? highlightTree(lowlight, code, language) : null;
  return <code className={language ? `language-${language}` : undefined}>{tree ? renderTree(tree.children) : code}</code>;
}
