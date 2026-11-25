import { describe, expect, it } from 'vitest';
import { cardPages, checklistProgress, clipLength, fileAttachments, isPoster, mediaItems, posterId, CODE_CLOSE, CODE_OPEN, displayTitle, hasPhoto, HIDE_CLOSE, HIDE_OPEN, isBlank, isImageUrl, leadLine, linkedCardIds, linkUrls, photoIds, plainText, previewLines, previewParts, siteName, splitLinks, storedPages, textToDoc, translationPage, pagesHaveTranslation, withNewPage, withoutLeadLine, withoutPage, withPage, wordsToDoc } from './content';
import { doc, link, note, p, tag, text } from './testFixtures';
import type { JSONNode } from './types';

describe('content', () => {
  const body = doc(p(text('see '), link('a', 'A'), text(' and '), link('a', 'A'), link('b', 'B')));
  it('finds each linked card once', () => expect(linkedCardIds(body)).toEqual(['a', 'b']));
  it('extracts text including link labels', () => {
    expect(plainText(doc(p(text('one')), p(text('two '), link('a', 'Alpha'))))).toBe('one two Alpha');
  });
  it('treats untouched cards as blank but not tags', () => {
    expect(isBlank(note('n', '  '))).toBe(true);
    expect(isBlank(note('n', 'Title'))).toBe(false);
    expect(isBlank(note('n', '', { content: doc(p(text('x'))) }))).toBe(false);
    expect(isBlank(note('n', '', { content: doc(p(link('a', 'A'))) }))).toBe(false);
    expect(isBlank(tag('t', ''))).toBe(false);
  });
  it('names cards for display', () => {
    expect(displayTitle(note('n', '  '))).toBe('Untitled');
    expect(displayTitle(note('n', 'Plan'))).toBe('Plan');
  });
  it('names a card without a title by its first line', () => {
    expect(displayTitle(note('n', '', { content: doc(p(), p(text('Buy milk')), p(text('and eggs'))) }))).toBe('Buy milk');
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('first item'))] }] };
    expect(displayTitle(note('n', '', { content: doc(list) }))).toBe('first item');
    expect(displayTitle(note('n', '', { content: doc(p(text('x'.repeat(100)))) }))).toHaveLength(80);
  });
});

describe('previews', () => {
  it('gives one line per paragraph and list item, with markers', () => {
    const body = doc(
      p(text('Groceries')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('milk'))] }, { type: 'listItem', content: [p(text('eggs'))] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(text('three'))] }] },
      { type: 'photo', attrs: { id: 'p-1' } },
      p(text('see '), link('a', 'Old')),
      p(),
    );
    expect(previewLines(body, () => 'New')).toEqual(['Groceries', '• milk', '• eggs', '3. three', 'see New']);
  });
  it('turns typed text into paragraphs and back', () => {
    const body = textToDoc('one\n\ntwo\n');
    expect(body).toEqual(doc(p(text('one')), { type: 'paragraph' }, p(text('two'))));
    expect(previewLines(body)).toEqual(['one', '', 'two']);
  });
  it('keeps code blocks as typed, apart from the text around them', () => {
    const body = doc(
      p(text('Run '), { type: 'text', text: 'npm test', marks: [{ type: 'code' }] }, text(':')),
      { type: 'codeBlock', attrs: { language: 'js' }, content: [text('if (a) {\n  b();\n}\n')] },
      p(text('Done')),
      { type: 'codeBlock', attrs: { language: null } },
    );
    expect(previewParts(body, undefined, { markCode: true })).toEqual([
      { kind: 'text', lines: [`Run ${CODE_OPEN}npm test${CODE_CLOSE}:`] },
      { kind: 'code', text: 'if (a) {\n  b();\n}', language: 'js', prefix: '' },
      { kind: 'text', lines: ['Done'] },
    ]);
    // Lines elsewhere (titles, comparing versions) keep code's lines, without marks.
    expect(previewLines(body)).toEqual(['Run npm test:', 'if (a) {', '  b();', '}', 'Done']);
  });
  it('names a stack by its first line of words, and leaves that line out of the text under it', () => {
    const parts = previewParts(textToDoc('\nKyoto trip\n\nWhat to book first\nand when'));
    expect(leadLine(parts)).toBe('Kyoto trip');
    expect(withoutLeadLine(parts)).toEqual([{ kind: 'text', lines: ['What to book first', 'and when'] }]);
    // Just the one line: nothing's left under it.
    expect(withoutLeadLine(previewParts(textToDoc('Kyoto trip')))).toEqual([]);
    // A list item is named without its marker.
    expect(leadLine(previewParts(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(text('milk'))] }] })))).toBe('milk');
    // Code first, or no text: no name from it, and the text stays whole.
    const code = previewParts(doc({ type: 'codeBlock', attrs: { language: null }, content: [text('x = 1')] }, p(text('after'))));
    expect(leadLine(code)).toBe('');
    expect(withoutLeadLine(code)).toBe(code);
    expect(leadLine(previewParts(doc(p())))).toBe('');
  });
});

describe('web links', () => {
  it('cuts text into plain runs and addresses, leaving trailing punctuation out', () => {
    expect(splitLinks('See https://a.example/x?y=1, and http://b.example.')).toEqual([
      { text: 'See ' },
      { text: 'https://a.example/x?y=1', href: 'https://a.example/x?y=1' },
      { text: ', and ' },
      { text: 'http://b.example', href: 'http://b.example' },
      { text: '.' },
    ]);
    expect(splitLinks('no links')).toEqual([{ text: 'no links' }]);
    expect(splitLinks('')).toEqual([{ text: '' }]);
  });

  it('makes typed web addresses into links, leaving trailing punctuation out', () => {
    expect(textToDoc('see https://example.com/a?b=1. ok')).toEqual(
      doc(p(text('see '), text('https://example.com/a?b=1', [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }]), text('. ok'))),
    );
  });
  it('finds addresses in links and in plain text, each once', () => {
    const body = doc(
      p(text('docs', [{ type: 'link', attrs: { href: 'https://docs.example.com' } }]), text(' and http://plain.example.org/x')),
      p(text('again https://docs.example.com')),
      p(text('mail', [{ type: 'link', attrs: { href: 'mailto:a@b.c' } }])),
    );
    expect(linkUrls(body)).toEqual(['https://docs.example.com', 'http://plain.example.org/x']);
  });
  it('names a site by its host', () => {
    expect(siteName('https://www.github.com/a/b')).toBe('github.com');
    expect(siteName('not a url')).toBe('not a url');
  });
});

describe('photos', () => {
  it('counts a photo as content, so a photo-only note is kept', () => {
    const withPhoto = note('n', '', { content: doc({ type: 'photo', attrs: { id: 'p-12345678' } }) });
    expect(photoIds(withPhoto.content)).toEqual(['p-12345678']);
    expect(isBlank(withPhoto)).toBe(false);
    expect(isBlank(note('m', ''))).toBe(true);
  });
});

describe('files', () => {
  it('lists files with what they were added with, and counts one as content', () => {
    const withFile = note('n', '', {
      content: doc(p(text('Tickets')), { type: 'file', attrs: { id: 'f-1', name: 'Itinerary.pdf', mime: 'application/pdf', size: 2048 } }, { type: 'file', attrs: { id: 'f-2' } }),
    });
    expect(fileAttachments(withFile.content)).toEqual([
      { id: 'f-1', name: 'Itinerary.pdf', mime: 'application/pdf', size: 2048 },
      { id: 'f-2', name: 'Untitled', mime: null, size: null },
    ]);
    expect(isBlank(note('m', '', { content: doc({ type: 'file', attrs: { id: 'f-3', name: 'a.txt' } }) }))).toBe(false);
    expect(previewLines(withFile.content)).toEqual(['Tickets']);
    expect(previewLines(withFile.content, undefined, true)).toEqual(['Tickets', '[File: Itinerary.pdf]', '[File: Untitled]']);
  });

  it('keeps what a video was found to be, and shows it among the photos in order', () => {
    const video = { type: 'file', attrs: { id: 'v-1', name: 'Beach.mov', mime: 'video/quicktime', size: 9, poster: posterId('v-1'), width: 1920, height: 1080, duration: 7.4 } };
    const unread = { type: 'file', attrs: { id: 'v-2', name: 'clip.mkv', mime: 'video/x-matroska', size: 3, poster: '', width: -1, duration: 'long' } };
    const body = doc({ type: 'photo', attrs: { id: 'p-1' } }, video, { type: 'file', attrs: { id: 'f-1', name: 'a.pdf', mime: 'application/pdf' } }, unread);
    const [clip] = fileAttachments(body);
    expect(clip).toEqual({ id: 'v-1', name: 'Beach.mov', mime: 'video/quicktime', size: 9, poster: 'v-1-poster', width: 1920, height: 1080, duration: 7.4 });
    expect(fileAttachments(body)[2]).toEqual({ id: 'v-2', name: 'clip.mkv', mime: 'video/x-matroska', size: 3, poster: null, width: null, height: null, duration: null });
    expect(mediaItems(body).map((m) => [m.id, !!m.video])).toEqual([
      ['p-1', false],
      ['v-1', true],
      ['v-2', true],
    ]);
    // Their shapes, where the entry says, to lay them out before they load.
    const sized = doc({ type: 'photo', attrs: { id: 'p-2', width: 1800, height: 600 } }, { type: 'photo', attrs: { id: 'p-3', width: 0, height: 5 } });
    expect([...mediaItems(sized), ...mediaItems(body)].map((m) => m.ratio)).toEqual([3, undefined, undefined, 1920 / 1080, undefined]);
    expect(isPoster('v-1-poster')).toBe(true);
    expect(isPoster('v-1')).toBe(false);
    expect(previewLines(body, undefined, true)).toEqual(['[Photo]', '[Video: Beach.mov]', '[File: a.pdf]', '[Video: clip.mkv]']);
  });

  it('tells a video\'s length as a player does', () => {
    expect([clipLength(0), clipLength(7.4), clipLength(65), clipLength(3729)]).toEqual(['0:00', '0:07', '1:05', '1:02:09']);
  });
});

describe('pictures by address', () => {
  it('knows a link straight to a picture from a page', () => {
    expect(isImageUrl('https://img.example/a/cat.jpeg')).toBe(true);
    expect(isImageUrl('https://img.example/cat.PNG?w=600#top')).toBe(true);
    expect(isImageUrl('https://github.com/yun-cheng/notes-app')).toBe(false);
    expect(isImageUrl('https://example.com/?file=cat.jpg')).toBe(false);
    expect(isImageUrl('not a url.png')).toBe(false);
  });

  it('counts a photo of its own or a picture link as a photo, and a page link not', () => {
    const linked = (href: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }] }] });
    expect(hasPhoto(linked('https://img.example/cat.webp'))).toBe(true);
    expect(hasPhoto(linked('https://developer.mozilla.org/en-US/docs/Web/HTML'))).toBe(false);
    expect(hasPhoto({ type: 'doc', content: [{ type: 'photo', attrs: { id: 'p' } }] })).toBe(true);
  });
});

describe('checklistProgress', () => {
  const item = (checked: boolean, ...content: JSONNode[]): JSONNode => ({ type: 'taskItem', attrs: { checked }, content: [p(text('x')), ...content] });
  const list = (...items: JSONNode[]): JSONNode => ({ type: 'taskList', content: items });

  it('counts ticked items of all checklists, nested ones too', () => {
    expect(checklistProgress(doc(list(item(true), item(false, list(item(true)))), p(text('and')), list(item(false))))).toEqual({ done: 2, total: 4 });
  });

  it('is null without a checklist', () => {
    expect(checklistProgress(doc(p(text('plain'))))).toBeNull();
  });
});

describe('hidden text', () => {
  const body = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Answer: ' },
          { type: 'text', text: 'forty', marks: [{ type: 'hidden' }] },
          { type: 'text', text: '-two', marks: [{ type: 'bold' }, { type: 'hidden' }] },
        ],
      },
    ],
  };

  it('shows as typed by default, marked for a bubble, and masked in a title', () => {
    expect(previewLines(body)).toEqual(['Answer: forty-two']);
    expect(previewParts(body, undefined, { hidden: 'mark' })).toEqual([{ kind: 'text', lines: [`Answer: ${HIDE_OPEN}forty-two${HIDE_CLOSE}`] }]);
    expect(displayTitle({ ...note('n', ''), content: body })).toBe('Answer: •••');
  });
});

describe('the pages behind a card’s front', () => {
  const page = (words: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] });
  const blank = { type: 'doc', content: [{ type: 'paragraph' }] };

  it('are its pages, blank ones skipped, or none', () => {
    expect(cardPages(note('n', '', { pages: [page('Lima'), blank, page('Peru')] }))).toEqual([page('Lima'), page('Peru')]);
    expect(storedPages(note('n', '', { pages: [page('Lima'), blank] }))).toHaveLength(2);
    expect(cardPages(note('n', ''))).toEqual([]);
    expect(cardPages(note('n', '', { pages: null }))).toEqual([]);
  });

  it('read a back from before there were pages as the only one', () => {
    expect(cardPages(note('n', '', { back: page('Lima') }))).toEqual([page('Lima')]);
    expect(cardPages(note('n', '', { back: blank }))).toEqual([]);
    // Pages, once written, are what it has.
    expect(cardPages(note('n', '', { back: page('Old'), pages: [page('New')] }))).toEqual([page('New')]);
  });

  it('are written one at a time, a new one at the end, the old back cleared', () => {
    const old = note('n', '', { back: page('Lima') });
    expect(withPage(old, 1, page('Peru'))).toEqual({ pages: [page('Lima'), page('Peru')], back: null });
    expect(withPage(note('n', ''), 0, page('Lima'))).toEqual({ pages: [page('Lima')] });
    // Blank pages at the end go; one in the middle stays, to write on.
    expect(withPage(old, 0, blank)).toEqual({ pages: null, back: null });
    const three = note('n', '', { pages: [page('a'), page('b'), page('c')] });
    expect(withPage(three, 1, blank)).toEqual({ pages: [page('a'), blank, page('c')] });
    expect(withPage(three, 2, blank)).toEqual({ pages: [page('a'), page('b')] });
  });

  it('are taken out one at a time, and added after the last', () => {
    const three = note('n', '', { pages: [page('a'), page('b'), page('c')] });
    expect(withoutPage(three, 1)).toEqual({ pages: [page('a'), page('c')] });
    expect(withoutPage(note('n', '', { pages: [page('a')] }), 0)).toEqual({ pages: null });
    expect(withNewPage(note('n', '', { pages: [page('a'), blank] }), page('b'))).toEqual({ pages: [page('a'), page('b')] });
    expect(withNewPage(note('n', '', { back: page('a') }), page('b'))).toEqual({ pages: [page('a'), page('b')], back: null });
  });
});

describe('a translation as a page', () => {
  const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  it('is one paragraph per line, blanks left out', () => {
    expect(translationPage(['', 'Where is the station?\nThank you'])).toEqual({ type: 'doc', content: [para('Where is the station?'), para('Thank you')] });
  });
  it('is known to be on a page already, whatever the case and spacing', () => {
    const pages = [{ type: 'doc', content: [para('Excuse me')] }, { type: 'doc', content: [para('Thank you very much'), para('arigatō  gozaimasu')] }];
    expect(pagesHaveTranslation(pages, ['', 'thank you'])).toBe(true);
    expect(pagesHaveTranslation(pages, ['Arigatō gozaimasu'])).toBe(true);
    expect(pagesHaveTranslation(pages, ['Where is it'])).toBe(false);
    // All its words on one page, not spread over two.
    expect(pagesHaveTranslation(pages, ['Excuse me', 'Thank you'])).toBe(false);
    expect(pagesHaveTranslation([], ['Thanks'])).toBe(false);
    expect(pagesHaveTranslation(pages, [''])).toBe(false);
  });
  it('reads words selected in a bubble as paragraphs and flat lists, with addresses as links', () => {
    const words = wordsToDoc('Packing\n• Socks\n• Hat see https://x.test\n1. One\n2. Two\n☐ Open\n☑ Done\n\nEnd');
    expect(words.content!.map((b) => b.type)).toEqual(['paragraph', 'bulletList', 'orderedList', 'taskList', 'paragraph', 'paragraph']);
    expect(words.content![1].content).toHaveLength(2);
    expect(words.content![1].content![1].content![0].content![1].marks![0]).toMatchObject({ type: 'link', attrs: { href: 'https://x.test' } });
    expect(words.content![2].attrs).toEqual({ start: 1 });
    expect(words.content![3].content!.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(wordsToDoc('just words').content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'just words' }] }]);
  });
});

