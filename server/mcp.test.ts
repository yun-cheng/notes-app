import { describe, expect, it } from 'vitest';
import type { CardRecord } from '../src/domain/types';
import type { VersionsResponse } from '../src/sync/protocol';
import { connectAi, rec, setup } from './testHarness';

const para = (text: string, extra: object[] = []) => ({ type: 'paragraph', content: [{ type: 'text', text }, ...extra] });
const doc = (...content: object[]) => ({ type: 'doc', content });
const payload = (fields: Record<string, unknown>) => JSON.stringify({ tags: [], content: doc(), createdAt: 1, ...fields });
const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };

async function world(access: 'off' | 'read' | 'write' = 'write') {
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
    const { tool, ann } = await world();
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
    expect((await tool('list_vaults')).text).toBe(`- Personal (id: ${ann.vault}, read and write)\n2 other vaults are closed to AI.`);
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
  it('leaves alone a card set to view only', async () => {
    const { tool, push, ann } = await world();
    await push(ann.cookie, [rec(ann.vault, 'kept', { payload: payload({ type: 'todo', title: 'Lease terms', status: 'open', due: null, completedAt: null, viewOnly: true }) })]);
    expect(await tool('edit_card', { id: 'kept', title: 'Changed' })).toEqual({ text: '"Lease terms" is set to view only. The user can turn that off in the app.', error: true });
    expect((await tool('complete_todo', { id: 'kept' })).error).toBe(true);
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
  it('follows the account default AI access with per-vault overrides, keeping private vaults closed', async () => {
    const { tool, call, patch, ann } = await world('off');
    await patch(ann.vault, { ai_access: 'default' });
    const work = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Work' }) }, ann.cookie)).json()) as { id: string };
    await patch(work.id, { ai_access: 'off' });
    await call('/api/ai/settings', { method: 'PATCH', body: JSON.stringify({ default_access: 'read' }) }, ann.cookie);
    const listed = (await tool('list_vaults')).text;
    expect(listed).toContain(`Personal (id: ${ann.vault}, read only)`);
    expect(listed).toContain(`Diary (id: diary-${ann.user.id}, read only)`);
    expect(listed).not.toContain('Work');
    expect(listed).not.toContain('Secret diary');
    expect(listed).toContain('2 other vaults are closed to AI.');
    // Overriding one vault to write allows edits there while the default stays read only.
    await patch(ann.vault, { ai_access: 'write' });
    expect((await tool('create_note', { title: 'Allowed' })).error).toBe(false);
    expect((await tool('create_note', { title: 'Blocked', vault: 'Diary' })).error).toBe(true);
  });
  it('identifies vaults by ID and disambiguates duplicate vault names', async () => {
    const { tool, call, patch, ann } = await world();
    const dup1 = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Projects' }) }, ann.cookie)).json()) as { id: string };
    const dup2 = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Projects' }) }, ann.cookie)).json()) as { id: string };
    await patch(dup1.id, { ai_access: 'write' });
    await patch(dup2.id, { ai_access: 'write' });

    const ambiguous = await tool('create_note', { title: 'Spec', vault: 'Projects' });
    expect(ambiguous.error).toBe(true);
    expect(ambiguous.text).toContain(dup1.id);
    expect(ambiguous.text).toContain(dup2.id);

    const ok = await tool('create_note', { title: 'Spec', vault: dup2.id });
    expect(ok.error).toBe(false);
    expect((await tool('search_cards', { vault: dup2.id })).text).toContain('Spec');
    expect((await tool('search_cards', { vault: dup1.id })).text).toBe('No cards match those filters.');
  });
  it('respects vault-scoped tags when matching and creating tags', async () => {
    const { tool, call, patch, push, pull, ann } = await world();
    const work = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Work' }) }, ann.cookie)).json()) as { id: string };
    await patch(work.id, { ai_access: 'write' });
    await push(ann.cookie, [
      rec(ann.vault, 'scoped-tag', { payload: payload({ type: 'tag', title: 'Urgent', pinned: false, scope: 'vault' }) }),
    ]);

    // In Work, "Urgent" must not attach Personal's vault-scoped tag; it creates a new vault-scoped tag in Work.
    const made = await tool('create_note', { title: 'Ship', vault: work.id, tags: ['Urgent', 'Travel'] });
    expect(made.error).toBe(false);
    const id = made.text.match(/id: ([\w-]+)/)![1];
    const records = (await pull(ann.cookie)).records;
    const note = JSON.parse(records.find((r: CardRecord) => r.id === id)!.payload) as { tags: string[] };
    // Global tag "Travel" (tag-1, no scope) is reused, while "Urgent" gets a new vault-scoped tag in Work.
    expect(note.tags).toContain('tag-1');
    expect(note.tags).not.toContain('scoped-tag');
    const createdTag = records.find((r: CardRecord) => note.tags.includes(r.id) && r.id !== 'tag-1')!;
    expect(createdTag.vault_id).toBe(work.id);
    expect(JSON.parse(createdTag.payload)).toMatchObject({ type: 'tag', title: 'Urgent', scope: 'vault' });
  });
  it('sees cards shared into an open vault, read only when from another account, and never from closed vaults', async () => {
    const { tool, call, patch, push, signIn, ann } = await world();
    const work = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Work' }) }, ann.cookie)).json()) as { id: string };
    await patch(work.id, { ai_access: 'write' });
    // Share Personal's note-1 into Work.
    await call('/api/cards/note-1/shares', { method: 'POST', body: JSON.stringify({ vault_id: work.id, role: 'edit' }) }, ann.cookie);
    expect((await tool('search_cards', { vault: 'Work' })).text).toContain('Tokyo plan');
    expect((await tool('get_card', { id: 'note-1' })).text).toContain('Also in vaults: Work');

    // Bob shares a card from his open vault into a shared vault Ann is in (or Ann's open vault).
    const bob = await signIn('bob');
    await call(`/api/vaults/${work.id}/members`, { method: 'POST', body: JSON.stringify({ email: bob.user.email, role: 'editor' }) }, ann.cookie);
    await push(bob.cookie, [rec(bob.vault, 'bob-note', { payload: payload({ type: 'note', title: 'Bob memo', content: doc(para('Shared brief')) }) })]);
    await call('/api/cards/bob-note/shares', { method: 'POST', body: JSON.stringify({ vault_id: work.id, role: 'edit' }) }, bob.cookie);
    expect((await tool('search_cards', { vault: 'Work', query: 'brief' })).text).toContain('Bob memo');
    expect((await tool('get_card', { id: 'bob-note' })).text).toContain('read only');
    expect((await tool('edit_card', { id: 'bob-note', title: 'Tampered' })).error).toBe(true);

    // A card living in Ann's own closed vault stays hidden even if shared into Work.
    const diary = `diary-${ann.user.id}`;
    await push(ann.cookie, [rec(diary, 'closed-note', { payload: payload({ type: 'note', title: 'Diary secret', content: doc(para('Keep out')) }) })]);
    await call('/api/cards/closed-note/shares', { method: 'POST', body: JSON.stringify({ vault_id: work.id, role: 'view' }) }, ann.cookie);
    expect((await tool('search_cards', { query: 'Keep out' })).text).toBe('Nothing matches "Keep out".');
    expect((await tool('get_card', { id: 'closed-note' })).error).toBe(true);
  });
  it('clears waiting and keeps a board Done tag in step when completing or reopening a todo', async () => {
    const { tool, push, pull, ann } = await world();
    await push(ann.cookie, [
      rec(ann.vault, 'col-todo', { payload: payload({ type: 'tag', title: 'To do', pinned: false }) }),
      rec(ann.vault, 'col-doing', { payload: payload({ type: 'tag', title: 'Doing', pinned: false }) }),
      rec(ann.vault, 'col-done', { payload: payload({ type: 'tag', title: 'Done', pinned: false }) }),
      rec(ann.vault, 'grp-stage', { payload: payload({ type: 'tag', title: 'Stage', pinned: false, choice: 'one', members: ['col-todo', 'col-doing', 'col-done'] }) }),
      rec(ann.vault, 'board-todo', {
        payload: payload({ type: 'todo', title: 'Review PR', status: 'open', waiting: true, due: '2026-11-20', completedAt: null, tags: ['col-doing'] }),
      }),
    ]);

    expect((await tool('complete_todo', { id: 'board-todo' })).text).toBe('Marked "Review PR" done.');
    let saved = JSON.parse((await pull(ann.cookie)).records.find((r: CardRecord) => r.id === 'board-todo')!.payload) as {
      status: string;
      waiting?: boolean;
      tags: string[];
    };
    expect(saved).toMatchObject({ status: 'done', waiting: false, tags: ['col-done'] });

    // Reopening from Done moves it back to the group's first open column.
    expect((await tool('complete_todo', { id: 'board-todo', done: false })).text).toBe('Marked "Review PR" open.');
    saved = JSON.parse((await pull(ann.cookie)).records.find((r: CardRecord) => r.id === 'board-todo')!.payload) as {
      status: string;
      waiting?: boolean;
      tags: string[];
    };
    expect(saved).toMatchObject({ status: 'open', tags: ['col-todo'] });
  });
  it('preserves photo, video and voice attachment metadata when editing Markdown and warns about extra pages', async () => {
    const { tool, push, pull, ann } = await world();
    await push(ann.cookie, [
      rec(ann.vault, 'rich-note', {
        payload: payload({
          type: 'note',
          title: 'Trip log',
          content: doc(
            para('Day one'),
            { type: 'photo', attrs: { id: 'photo-12345678', alt: null, width: 1600, height: 1200 } },
            {
              type: 'file',
              attrs: {
                id: 'voice-12345678',
                name: 'Voice message',
                mime: 'audio/webm',
                size: 9876,
                duration: 12,
                voice: true,
                peaks: [0.2, 0.8],
                transcript: 'Remember to buy train tickets.',
              },
            },
          ),
          pages: [doc(para('Back of card'))],
        }),
      }),
    ]);

    const read = (await tool('get_card', { id: 'rich-note' })).text;
    expect(read).toContain('Pages: 2 (edit_card edits Page 1 only');
    expect(read).toContain('![Photo](attachment:photo-12345678)');
    expect(read).toContain('[Voice message](attachment:voice-12345678)\n\n> Remember to buy train tickets.');

    // Round-trip Page 1 with an edit, keeping the photo, voice link and the synthetic transcript quote from get_card.
    const edited = await tool('edit_card', {
      id: 'rich-note',
      markdown: 'Day one updated\n\n![Photo](attachment:photo-12345678)\n\n[Voice message](attachment:voice-12345678)\n\n> Remember to buy train tickets.',
    });
    expect(edited.error).toBe(false);

    const saved = JSON.parse((await pull(ann.cookie)).records.find((r: CardRecord) => r.id === 'rich-note')!.payload) as {
      content: { content: { type: string; attrs?: Record<string, unknown> }[] };
      pages?: unknown[];
    };
    const blocks = saved.content.content;
    // The synthetic transcript blockquote is dropped instead of being duplicated as a second block.
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'photo', 'file']);
    expect(blocks[1].attrs).toEqual({ id: 'photo-12345678', alt: null, width: 1600, height: 1200 });
    expect(blocks[2].attrs).toMatchObject({
      id: 'voice-12345678',
      name: 'Voice message',
      mime: 'audio/webm',
      size: 9876,
      duration: 12,
      voice: true,
      peaks: [0.2, 0.8],
      transcript: 'Remember to buy train tickets.',
    });
    expect(saved.pages).toHaveLength(1);
  });
  it('lists tag groups and vault-scoped tags with list_tags, and filters search_cards and list_todos richly', async () => {
    const { tool, call, patch, push, ann } = await world();
    const work = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Work' }) }, ann.cookie)).json()) as { id: string };
    await patch(work.id, { ai_access: 'write' });
    await push(ann.cookie, [
      rec(ann.vault, 'p-high', { payload: payload({ type: 'tag', title: 'High', pinned: false }) }),
      rec(ann.vault, 'p-low', { payload: payload({ type: 'tag', title: 'Low', pinned: false }) }),
      rec(ann.vault, 'grp-pri', { payload: payload({ type: 'tag', title: 'Priority', pinned: false, choice: 'one', ordered: true, members: ['p-high', 'p-low'] }) }),
      rec(work.id, 'w-tag', { payload: payload({ type: 'tag', title: 'Sprint', pinned: true, scope: 'vault' }) }),
      rec(ann.vault, 'arch-1', { payload: payload({ type: 'note', title: 'Old archive', archived: true, createdAt: Date.parse('2026-10-01T10:00:00Z') }) }),
      rec(ann.vault, 'tpl-1', { payload: payload({ type: 'note', title: 'Weekly review', template: true, createdAt: Date.parse('2026-11-01T10:00:00Z') }) }),
      rec(work.id, 'wait-todo', {
        payload: payload({ type: 'todo', title: 'Wait for vendor', status: 'open', waiting: true, due: '2026-11-15', tags: ['p-high', 'w-tag'], completedAt: null, createdAt: Date.parse('2026-11-05T10:00:00Z') }),
      }),
      rec(work.id, 'stack-1', {
        payload: payload({ type: 'note', title: 'Launch deck', stack: ['wait-todo'], color: 'blue', reactions: { '👍': [ann.user.id] }, createdAt: Date.parse('2026-11-06T10:00:00Z') }),
      }),
    ]);
    // Add a comment on note-1.
    await call('/api/cards/note-1/comments', { method: 'POST', body: JSON.stringify({ body: 'Check flights' }) }, ann.cookie);

    const tagsOut = (await tool('list_tags')).text;
    expect(tagsOut).toContain('## Group: Priority (id: grp-pri, one-choice, ordered)');
    expect(tagsOut).toContain('- High (id: p-high, 1 card)');
    expect(tagsOut).toContain('- Sprint (id: w-tag, 1 card, pinned, vault: Work)');
    // Filtering list_tags to Personal hides Work's vault-scoped tag.
    expect((await tool('list_tags', { vault: 'Personal' })).text).not.toContain('Sprint');

    // Archived and templates are excluded by default, and queryable explicitly.
    const defaultSearch = (await tool('search_cards', {})).text;
    expect(defaultSearch).not.toContain('Old archive');
    expect(defaultSearch).not.toContain('Weekly review');
    expect((await tool('search_cards', { archived: 'only' })).text).toContain('Old archive (note, id: arch-1, vault: Personal, archived');
    expect((await tool('search_cards', { templates: 'only' })).text).toContain('Weekly review (note, template');
    expect((await tool('search_cards', { type: 'stack' })).text).toContain('Launch deck (stack, id: stack-1');
    expect((await tool('search_cards', { tag: 'Sprint', created_after: '2026-11-04', created_before: '2026-11-06' })).text).toContain('Wait for vendor');

    // list_todos separates waiting todos from actionable open ones, and filters by vault and tag.
    const openTodos = (await tool('list_todos')).text;
    expect(openTodos).toContain('Book hotel');
    expect(openTodos).not.toContain('Wait for vendor');
    expect(openTodos).toContain('1 waiting todo omitted');
    expect((await tool('list_todos', { status: 'waiting', vault: 'Work', tag: 'High' })).text).toContain('Wait for vendor');
    expect((await tool('list_todos', { status: 'open', include_waiting: true, vault: 'Work' })).text).toContain('Wait for vendor');

    // get_card includes comments, stack parent, reactions, color, and tag group details.
    expect((await tool('get_card', { id: 'note-1' })).text).toContain('## Comments\n- ann (');
    expect((await tool('get_card', { id: 'note-1' })).text).toContain(': Check flights');
    const waitCard = (await tool('get_card', { id: 'wait-todo' })).text;
    expect(waitCard).toContain('In stack: Launch deck (id: stack-1)');
    const stackCard = (await tool('get_card', { id: 'stack-1' })).text;
    expect(stackCard).toContain('Color: blue');
    expect(stackCard).toContain('Reactions: 👍 (1)');
    const grpCard = (await tool('get_card', { id: 'grp-pri' })).text;
    expect(grpCard).toContain('Tag group: one-choice, ordered');
    expect(grpCard).toContain('- High (id: p-high)');
  });
  it('creates untitled notes, starts entries from templates, adds tagged/waiting todos, and edits pages, tags, archive, type and vault', async () => {
    const { tool, call, patch, push, pull, ann } = await world();
    const work = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Work' }) }, ann.cookie)).json()) as { id: string };
    await patch(work.id, { ai_access: 'write' });
    await push(ann.cookie, [
      rec(ann.vault, 'p-high', { payload: payload({ type: 'tag', title: 'High', pinned: false }) }),
      rec(ann.vault, 'p-low', { payload: payload({ type: 'tag', title: 'Low', pinned: false }) }),
      rec(ann.vault, 'grp-pri', { payload: payload({ type: 'tag', title: 'Priority', pinned: false, choice: 'one', ordered: true, members: ['p-high', 'p-low'] }) }),
      rec(ann.vault, 'tpl-pack', {
        payload: payload({
          type: 'note',
          title: 'Packing {date}',
          template: true,
          tags: ['tag-1'],
          color: 'green',
          content: {
            type: 'doc',
            content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('Passport')] }] }],
          },
          pages: [doc(para('Checklist back'))],
        }),
      }),
    ]);

    // Untitled journal note with pages.
    const quick = await tool('create_note', { markdown: 'Walked by the river today.', pages: ['Second page thoughts'], color: 'yellow' });
    expect(quick.error).toBe(false);
    const quickId = quick.text.match(/id: ([\w-]+)/)![1];
    const quickRead = (await tool('get_card', { id: quickId })).text;
    expect(quickRead).toContain('# Walked by the river today.');
    expect(quickRead).toContain('Color: yellow');
    expect(quickRead).toContain('## Page 2\n\nSecond page thoughts');

    // Start from a template: fills {date}, unticks checklist items, copies pages & color, merges extra tags.
    const fromTpl = await tool('create_note', { from_template: 'tpl-pack', tags: ['High'] });
    expect(fromTpl.error).toBe(false);
    const tplCopyId = fromTpl.text.match(/id: ([\w-]+)/)![1];
    const tplCopyRead = (await tool('get_card', { id: tplCopyId })).text;
    expect(tplCopyRead).toContain('- [ ] Passport');
    expect(tplCopyRead).toContain('Tags: Travel, High');
    expect(tplCopyRead).toContain('Color: green');
    expect(tplCopyRead).toContain('## Page 2\n\nChecklist back');

    // Add a todo with tags and waiting.
    const added = await tool('add_todo', { title: 'Chase invoice', tags: ['High', 'Finance'], waiting: true, vault: 'Work' });
    expect(added.error).toBe(false);
    const todoId = added.text.match(/id: ([\w-]+)/)![1];
    const todoRead = (await tool('get_card', { id: todoId })).text;
    expect(todoRead).toContain('Status: open, waiting');
    expect(todoRead).toContain('Tags: High, Finance');

    // Incremental tag edit (one-choice swap High -> Low, remove Finance), resume waiting, archive, edit Page 2, add Page 3.
    expect((await tool('edit_card', { id: todoId, add_tags: ['Low'], remove_tags: ['Finance'], waiting: false, archived: true, add_page: 'Invoice details' })).error).toBe(false);
    const editedTodo = (await tool('get_card', { id: todoId })).text;
    expect(editedTodo).toContain('Tags: Low');
    expect(editedTodo).not.toContain('High');
    expect(editedTodo).not.toContain('Finance');
    expect(editedTodo).toContain('Status: open\n');
    expect(editedTodo).toContain('This card is archived.');
    expect(editedTodo).toContain('## Page 2\n\nInvoice details');

    // Convert untitled note into a todo, set due date, edit Page 2, and move it to Work in one call.
    expect((await tool('edit_card', { id: quickId, type: 'todo', due: '2026-12-01', page: 2, append_markdown: 'More back text', vault: work.id })).error).toBe(false);
    const moved = (await tool('get_card', { id: quickId })).text;
    expect(moved).toContain('Type: todo');
    expect(moved).toContain('Vault: Work (you can edit)');
    expect(moved).toContain('Due: 2026-12-01');
    expect(moved).toContain('Second page thoughts\n\nMore back text');
    // Confirm the move persisted to the new vault record.
    expect((await pull(ann.cookie)).records.find((r: CardRecord) => r.id === quickId)?.vault_id).toBe(work.id);
  });
  it('creates, updates, reorders and moves entries between stacks with manage_stack', async () => {
    const { tool } = await world();
    // Create a stack with note-1 and note-2.
    const created = await tool('manage_stack', { title: 'Japan trip', markdown: 'Everything for Tokyo.', card_ids: ['note-1', 'note-2'] });
    expect(created.error).toBe(false);
    const stackId = created.text.match(/id: ([\w-]+)/)![1];
    let stackText = (await tool('get_card', { id: stackId })).text;
    expect(stackText).toMatch(/Tokyo plan[\s\S]*Packing/);

    // Add todo-1 and remove note-2.
    expect((await tool('manage_stack', { stack_id: stackId, add_card_ids: ['todo-1'], remove_card_ids: ['note-2'] })).error).toBe(false);
    stackText = (await tool('get_card', { id: stackId })).text;
    expect(stackText).toContain('Book hotel');
    expect(stackText).not.toContain('Packing');

    // Reorder: todo-1 before note-1.
    expect((await tool('manage_stack', { stack_id: stackId, card_ids: ['todo-1', 'note-1'] })).error).toBe(false);
    stackText = (await tool('get_card', { id: stackId })).text;
    expect(stackText).toMatch(/Book hotel[\s\S]*Tokyo plan/);

    // Moving note-1 into a second stack takes it out of the first stack.
    const stack2 = await tool('manage_stack', { title: 'Flights', card_ids: ['note-1'] });
    expect(stack2.error).toBe(false);
    const stack2Id = stack2.text.match(/id: ([\w-]+)/)![1];
    expect((await tool('get_card', { id: stackId })).text).not.toContain('Tokyo plan');
    expect((await tool('get_card', { id: stack2Id })).text).toContain('Tokyo plan');
    expect((await tool('get_card', { id: 'note-1' })).text).toContain(`In stack: Flights (id: ${stack2Id})`);

    // Refuses tags and stacks as members.
    expect((await tool('manage_stack', { title: 'Bad', card_ids: ['tag-1'] })).error).toBe(true);
    expect((await tool('manage_stack', { stack_id: stackId, add_card_ids: [stack2Id] })).error).toBe(true);
  });
  it('keeps private vaults off by default, lets non-encrypted ones opt in explicitly, and never opens encrypted ones', async () => {
    const { tool, call, patch, secret, ann } = await world('off');
    const encryption = { version: 1, kdf: { alg: 'argon2id' }, wrapped: 'w', recovery: 'r' };
    const sealed = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Vault E2EE', pin, encryption }) }, ann.cookie)).json()) as { id: string };
    // Even with account default set to write, both PIN-locked vaults stay off by default.
    await call('/api/ai/settings', { method: 'PATCH', body: JSON.stringify({ default_access: 'write' }) }, ann.cookie);
    expect((await tool('list_vaults')).text).not.toContain('Secret diary');
    expect((await tool('list_vaults')).text).not.toContain('Vault E2EE');
    expect((await tool('get_card', { id: 'private-1' })).error).toBe(true);

    // Explicitly opting the non-encrypted PIN-locked vault into read opens it to AI (read only).
    await patch(secret.id, { ai_access: 'read' });
    expect((await tool('list_vaults')).text).toContain(`Secret diary (id: ${secret.id}, read only)`);
    expect((await tool('get_card', { id: 'private-1' })).text).toContain('Hidden crush');
    expect((await tool('edit_card', { id: 'private-1', title: 'Changed' })).error).toBe(true);

    // Opting it into write allows edits; resetting to default closes it again.
    await patch(secret.id, { ai_access: 'write' });
    expect((await tool('edit_card', { id: 'private-1', title: 'Revealed' })).error).toBe(false);
    await patch(secret.id, { ai_access: 'default' });
    expect((await tool('get_card', { id: 'private-1' })).error).toBe(true);
    expect(sealed.id).toBeTruthy();
  });
  it('validates arguments', async () => {
    const { tool } = await world();
    expect(await tool('list_todos', { due_after: 'yesterday' })).toEqual({ text: '"due_after" must be a date like 2026-11-10.', error: true });
    expect((await tool('complete_todo', { id: 'note-1' })).text).toBe('"Tokyo plan" is not a todo.');
  });
});
