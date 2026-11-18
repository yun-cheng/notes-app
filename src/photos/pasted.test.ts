import { describe, expect, it } from 'vitest';
import { picturesInHtml } from './pasted';

describe('pictures in copied HTML', () => {
  it('finds a picture copied by itself, as browsers and apps put it on the clipboard', () => {
    const html = '<meta charset="utf-8"><img src="https://cdn.example/a.jpg?w=800&amp;h=600" alt="A cat">';
    expect(picturesInHtml(html)).toEqual({ sources: ['https://cdn.example/a.jpg?w=800&h=600'], alone: true });
  });

  it('tells pictures among words from pictures alone', () => {
    const html = `<html><head><style>p{}</style></head><body><!--StartFragment--><p>Look at this:</p>
      <img alt=x src='https://a.example/1.png'><p><img src=https://a.example/2.png></p><!--EndFragment--></body></html>`;
    expect(picturesInHtml(html)).toEqual({ sources: ['https://a.example/1.png', 'https://a.example/2.png'], alone: false });
  });

  it('keeps web and data addresses once each, and skips ones it can’t fetch', () => {
    const html = '<img src="data:image/png;base64,AAA"><img src="blob:https://a.example/123"><img src="/relative.png"><img data-src="x"><img src="data:image/png;base64,AAA">';
    expect(picturesInHtml(html)).toEqual({ sources: ['data:image/png;base64,AAA'], alone: true });
  });

  it('finds nothing in HTML without pictures', () => {
    expect(picturesInHtml('<p>Just <b>words</b>&nbsp;</p>')).toEqual({ sources: [], alone: false });
    expect(picturesInHtml('<p> </p>')).toEqual({ sources: [], alone: true });
  });
});
