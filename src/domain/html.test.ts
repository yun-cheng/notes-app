import { describe, expect, it } from 'vitest';
import { toHTML } from './html';
import { doc, link, p, text } from './testFixtures';
import type { JSONNode } from './types';

const title = (_id: string, label: string) => label;
const item = (...content: JSONNode[]): JSONNode => ({ type: 'listItem', content });

describe('toHTML', () => {
  it('keeps formatting, lists, quotes and code, and names linked cards', () => {
    const body = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
      p(text('Go '), text('now', [{ type: 'bold' }, { type: 'italic' }]), { type: 'hardBreak' }, text('x', [{ type: 'code' }]), text(' see '), link('n', 'Other')),
      { type: 'bulletList', content: [item(p(text('one'))), item(p(text('two')), { type: 'bulletList', content: [item(p(text('deep')))] })] },
      { type: 'orderedList', attrs: { start: 3 }, content: [item(p(text('third')))] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] }] },
      { type: 'blockquote', content: [p(text('said'))] },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [text('a < b')] },
      { type: 'photo', attrs: { id: 'abcdefgh' } },
      { type: 'horizontalRule' },
    );
    expect(toHTML(body, title)).toBe(
      '<h2>Plan</h2><p>Go <em><strong>now</strong></em><br><code>x</code> see Other</p>' +
        '<ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul><ol start="3"><li>third</li></ol><ul><li>☑ done</li></ul>' +
        '<blockquote><p>said</p></blockquote><pre><code>a &lt; b</code></pre><hr>',
    );
  });

  it('links only to web and mail addresses', () => {
    const linked = (href: string) => text('here', [{ type: 'link', attrs: { href } }]);
    expect(toHTML(doc(p(linked('https://a.dev/?q="x"'), linked('javascript:alert(1)'))), title)).toBe('<p><a href="https://a.dev/?q=&quot;x&quot;">here</a>here</p>');
  });
});
