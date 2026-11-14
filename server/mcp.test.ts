import { describe, expect, it } from 'vitest';
import type { CardRecord } from '../src/domain/types';
import type { VersionsResponse } from '../src/sync/protocol';
import { connectAi, rec, setup } from './testHarness';

const para = (text: string, extra: object[] = []) => ({ type: 'paragraph', content: [{ type: 'text', text }, ...extra] });
const doc = (...content: object[]) => ({ type: 'doc', content });
const payload = (fields: Record<string, unknown>) => JSON.stringify({ tags: [], content: doc(), createdAt: 1, ...fields });
const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };

async function world(access: 'read' | 'write' = 'write') {
  const t = setup();
  const ann = await t.signIn('ann');
  const patch = (id: string, body: object) => t.call(`/api/vaults/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, ann.cookie);
  await patch(ann.vault, { ai_access: access });
  const secret = (await (await t.call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Secret diary', pin }) }, ann.cookie)).json()) as { id: string };
  await t.push(ann.cookie, [
    rec(secret.id, 'private-1', { payload: payload({ type: 'note', title: 'Hidden crush' }) }),
    rec(ann.vault, 'tag-1', { payload: payload({ type: 'tag', title: 'Travel', pinned: true }) }),
    rec(ann.vault, 'note-1', {
      payload: payload({
        type: 'note',
        title: 'Tokyo plan',
        tags: ['tag-1'],
        content: doc(para('Fly Saturday. See ', [{ type: 'cardLink', attrs: { id: 'private-1', label: 'Hidden crush' } }])),
      }),
    }),
    rec(ann.vault, 'note-2', { payload: payload({ type: 'note', title: 'Packing', content: doc(para('Links to ', [{ type: 'cardLink', attrs: { id: 'note-1', label: 'Tokyo plan' } }])) }) }),
    rec(ann.vault, 'todo-1', { payload: payload({ type: 'todo', title: 'Book hotel', status: 'open', due: '2026-11-12', completedAt: null }) }),
  ]);
  const ai = await connectAi(t.call, ann.cookie);
  let id = 0;
  const rpc = async (method: string, params: object = {}) =>
    (await (
      await t.call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), headers: { authorization: `Bearer ${ai.access_token}` } })
    ).json()) as { result?: { content?: { text: string }[]; isError?: boolean; [k: string]: unknown }; error?: { code: number } };
  const tool = async (name: string, args: object = {}) => {
    const { result } = await rpc('tools/call', { name, arguments: args });
    return { text: result!.content![0].text, error: !!result!.isError };
  };
  return { ...t, ann, secret, patch, rpc, tool };
}

describe('MCP server', () => {
  it('negotiates a protocol version and lists tools', async () => {
    const { rpc } = await world();
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'notes-app' }, capabilities: { tools: {} } });
    const list = await rpc('tools/list');
    const tools = (list.result!.tools as { name: string; annotations: { readOnlyHint: boolean } }[]);
    expect(tools.find((t) => t.name === 'search_cards')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'create_note')?.annotations.readOnlyHint).toBe(false);
    expect((await rpc('nope')).error?.code).toBe(-32601);
  });
  it('answers notifications with no body', async () => {
    const { call, ann } = await world();
    const ai = await connectAi(call, ann.cookie, 'Other');
    const res = await call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), headers: { authorization: `Bearer ${ai.access_token}` } });
    expect(res.status).toBe(202);
  });
  it('finds and reads cards without revealing private vaults', async () => {
    const { tool } = await world();
    const found = await tool('search_cards', { query: 'saturday' });
    expect(found.text).toContain('Tokyo plan (note, id: note-1');
    const card = await tool('get_card', { id: 'note-1' });
    expect(card.text).toContain('Tags: Travel');
    expect(card.text).toContain('[[Locked]]');
    expect(card.text).toContain('- Packing (note, id: note-2');
    expect((await tool('search_cards', { query: 'crush' })).text).toBe('Nothing matches "crush".');
    for (const text of [found.text, card.text, (await tool('search_cards', {})).text, (await tool('list_vaults')).text]) {
      expect(text).not.toMatch(/crush|Secret diary/i);
    }
    expect((await tool('get_card', { id: 'private-1' })).error).toBe(true);
    expect((await tool('list_vaults')).text).toBe('- Personal (read and write)\n2 other vaults are closed to AI.');
  });
  it('sees nothing when AI access is off', async () => {
    const { tool, patch, ann } = await world();
    await patch(ann.vault, { ai_access: 'off' });
    expect((await tool('search_cards', {})).text).toBe('There are no cards yet.');
    expect((await tool('create_note', { title: 'x' })).error).toBe(true);
  });
  it('lists todos and completes them', async () => {
    const { tool } = await world();
    expect((await tool('list_todos', { due_before: '2026-11-30' })).text).toContain('Book hotel (todo, due 2026-11-12');
    expect((await tool('complete_todo', { id: 'todo-1' })).text).toBe('Marked "Book hotel" done.');
    expect((await tool('list_todos')).text).toBe('No todos match.');
    expect((await tool('list_todos', { status: 'done' })).text).toContain('Book hotel (todo, done');
  });
  it('adds todos with a time and a repeat, and moves a repeating one on when completed', async () => {
    const { tool } = await world();
    const added = await tool('add_todo', { title: 'Gym', due: '2099-01-05', time: '18:00', repeat: 'weekly' });
    expect(added.text).toMatch(/^Added "Gym" due 2099-01-05 18:00, repeats weekly \(id: /);
    const id = /id: ([^)]+)/.exec(added.text)![1];
    expect((await tool('complete_todo', { id })).text).toBe('Done for now: "Gym" repeats, and is next due 2099-01-12.');
    expect((await tool('get_card', { id })).text).toContain('Status: open · Due: 2099-01-12 18:00, repeats weekly');
    expect((await tool('edit_card', { id, repeat: null, time: null })).text).toBe('Updated the time, repeat of "Gym".');
    expect((await tool('get_card', { id })).text).toContain('Status: open · Due: 2099-01-12\n');
    expect((await tool('add_todo', { title: 'X', repeat: 'fortnightly' })).error).toBe(true);
    expect((await tool('add_todo', { title: 'X', time: '6pm' })).error).toBe(true);
  });
  it('creates notes that sync to devices, with history marked as the app', async () => {
    const { tool, pull, call, ann } = await world();
    const made = await tool('create_note', { title: 'Ideas', markdown: '- see [[Tokyo plan]]\n- **rest**', tags: ['Travel', 'Someday', 'someday'] });
    expect(made.error).toBe(false);
    const id = made.text.match(/id: ([\w-]+)/)![1];
    const records = (await pull(ann.cookie)).records;
    const note = records.find((r: CardRecord) => r.id === id)!;
    const body = JSON.parse(note.payload);
    expect(body.title).toBe('Ideas');
    expect(JSON.stringify(body.content)).toContain('"cardLink","attrs":{"id":"note-1"');
    const tagTitles = records.filter((r) => body.tags.includes(r.id)).map((r) => JSON.parse(r.payload).title);
    expect(tagTitles.sort()).toEqual(['Someday', 'Travel']);
    // One new tag for Someday and someday.
    expect(body.tags).toHaveLength(2);
    expect(records.filter((r) => JSON.parse(r.payload).title?.toLowerCase() === 'someday')).toHaveLength(1);
    const history = (await (await call(`/api/cards/${id}/versions`, {}, ann.cookie)).json()) as VersionsResponse;
    expect(history.versions[0]).toMatchObject({ author: 'ann', via: 'Claude' });
  });
  it('edits by appending or replacing, and refuses read-only vaults', async () => {
    const { tool, patch, ann } = await world();
    expect((await tool('edit_card', { id: 'note-1', append_markdown: 'Pack light.' })).error).toBe(false);
    const after = (await tool('get_card', { id: 'note-1' })).text;
    expect(after).toMatch(/Fly Saturday[\s\S]*Pack light\./);
    expect((await tool('edit_card', { id: 'note-1', markdown: 'Gone', append_markdown: 'x' })).error).toBe(true);
    expect((await tool('edit_card', { id: 'note-1' })).text).toBe('Nothing to change.');
    await patch(ann.vault, { ai_access: 'read' });
    const refused = await tool('edit_card', { id: 'note-1', title: 'Hacked' });
    expect(refused).toEqual({ text: '"Tokyo plan" is in a vault that is read only for AI.', error: true });
  });
  it('writes in the diary as in any vault, once it is open to AI', async () => {
    const t = setup();
    const ann = await t.signIn('ann');
    const diary = `diary-${ann.user.id}`;
    await t.call(`/api/vaults/${diary}`, { method: 'PATCH', body: JSON.stringify({ ai_access: 'write' }) }, ann.cookie);
    const ai = await connectAi(t.call, ann.cookie);
    const tool = async (name: string, args: object) => {
      const res = await t.call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), headers: { authorization: `Bearer ${ai.access_token}` } });
      return ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text;
    };
    expect(await tool('create_note', { title: 'Morning run', vault: 'Diary' })).toMatch(/^Created "Morning run" \(id: .+\) in Diary\.$/);
    expect(await tool('search_cards', { vault: 'diary' })).toMatch(/^- Morning run \(note, id: .+, vault: Diary,/);
    expect(await tool('search_cards', { vault: 'Personal' })).toBe('No vault named "Personal" is open to AI. Use list_vaults.');
    const list = await t.call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), headers: { authorization: `Bearer ${ai.access_token}` } });
    expect(JSON.stringify(await list.json())).not.toMatch(/get_diary|append_to_diary/);
  });
  it('reads a diary card from before the diary was a vault as a note', async () => {
    const t = setup();
    const ann = await t.signIn('ann');
    await t.call(`/api/vaults/${ann.vault}`, { method: 'PATCH', body: JSON.stringify({ ai_access: 'read' }) }, ann.cookie);
    const old = { type: 'diary', date: '2026-11-10', title: '', tags: [], createdAt: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rainy walk' }] }] } };
    await t.push(ann.cookie, [{ id: 'old-day', vault_id: ann.vault, updated_at: 1, deleted: false, seq: 0, payload: JSON.stringify(old) }]);
    const ai = await connectAi(t.call, ann.cookie);
    const res = await t.call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_card', arguments: { id: 'old-day' } } }), headers: { authorization: `Bearer ${ai.access_token}` } });
    const text = ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text;
    expect(text).toContain('Type: note');
    expect(text).toContain('Rainy walk');
  });
  it('validates arguments', async () => {
    const { tool } = await world();
    expect(await tool('list_todos', { due_after: 'yesterday' })).toEqual({ text: '"due_after" must be a date like 2026-11-10.', error: true });
    expect((await tool('complete_todo', { id: 'note-1' })).text).toBe('"Tokyo plan" is not a todo.');
  });
});
