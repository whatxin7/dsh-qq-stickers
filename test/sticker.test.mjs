import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyStickerNote,
  buildStickerContext,
  buildStickerStrategyHint,
  findSticker,
  formatStickerList,
  loadStickerStore,
  markStickerUsed,
  mergeStickerLibrary,
  normalizeStickerEntry,
  sanitizeStickerText,
  saveStickerStore
} from '../src/sticker-lib.js';
import { deriveTags, mergeTags, normalizeTags, searchByTags, tagInventory } from '../src/sticker-tags.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stickers-')), 'stickers.json');

test('sanitizeStickerText：换行压平（防跨会话注入），控制字符与零宽字符剥掉', () => {
  assert.equal(sanitizeStickerText('第一行\n第二行\t结尾'), '第一行 第二行 结尾');
  assert.equal(sanitizeStickerText('a\u200bb\u0000c'), 'abc');
  assert.equal(sanitizeStickerText('  '), '');
  assert.ok(sanitizeStickerText('字'.repeat(50), 10).length <= 10);
});

test('normalizeStickerEntry：没有 id 直接丢弃，md5 大写，来源受控', () => {
  assert.equal(normalizeStickerEntry({ desc: '没有 id' }), null);
  const e = normalizeStickerEntry({ id: '42', md5: 'abc123', desc: '无语', source: 'x' });
  assert.equal(e.md5, 'ABC123');
  assert.equal(e.source, 'qq');
  assert.equal(normalizeStickerEntry({ id: '43', source: 'manual' }).source, 'manual');
});

test('loadStickerStore：文件不存在 = 空库；内容损坏 = 抛错（不能当空库覆盖）', () => {
  assert.deepEqual(loadStickerStore(tmp()), []);
  const broken = tmp();
  fs.writeFileSync(broken, '{not json');
  assert.throws(() => loadStickerStore(broken), /内容损坏/);
});

test('saveStickerStore / loadStickerStore：往返一致，不留临时文件', () => {
  const file = tmp();
  const entries = [normalizeStickerEntry({ id: '1', desc: '笑死' })];
  saveStickerStore(file, entries);
  const back = loadStickerStore(file);
  assert.equal(back.length, 1);
  assert.equal(back[0].desc, '笑死');
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('mergeStickerLibrary：只刷新 QQ 侧字段，保住本地备注/标签/使用次数', () => {
  const existing = [normalizeStickerEntry({ id: '1', desc: '旧名字', localNote: '我的备注', tags: ['无语'], useCount: 5, source: 'qq' })];
  const merged = mergeStickerLibrary(existing, [{ emoji_id: '1', desc: '新名字', url: 'https://x/y.png' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].desc, '新名字');
  assert.equal(merged[0].localNote, '我的备注');
  assert.equal(merged[0].useCount, 5);
});

test('mergeStickerLibrary：complete=true 清掉 QQ 端已删的，但保留 manual 条目', () => {
  const existing = [
    normalizeStickerEntry({ id: '1', source: 'qq' }),
    normalizeStickerEntry({ id: '2', source: 'manual', desc: '自己导入的' })
  ];
  const merged = mergeStickerLibrary(existing, [{ emoji_id: '1', desc: 'a' }], { complete: true });
  assert.deepEqual(merged.map((e) => e.id), ['1', '2']);

  const partial = mergeStickerLibrary(existing, [{ emoji_id: '1', desc: 'a' }], { complete: false });
  assert.equal(partial.length, 2, '部分结果不能当成"其余的都被删了"');
});

test('findSticker：id / resId / md5 / 归一化 URL 都能命中，不做任意子串', () => {
  const entries = [normalizeStickerEntry({ id: '9', md5: 'ff00', url: 'https://cdn.example.com/a/b.png?x=1' })];
  assert.equal(findSticker(entries, '9')?.id, '9');
  assert.equal(findSticker(entries, 'FF00')?.id, '9');
  assert.equal(findSticker(entries, 'https://cdn.example.com/a/b.png')?.id, '9');
  assert.equal(findSticker(entries, 'cdn.example.com/a'), null);
});

test('formatStickerList：按标签检索 + 截断标记', () => {
  const entries = [
    normalizeStickerEntry({ id: '1', desc: '笑死了', tags: ['开心'] }),
    normalizeStickerEntry({ id: '2', desc: '无语凝噎', tags: ['无语'] }),
    normalizeStickerEntry({ id: '3', desc: '晚安' })
  ];
  const all = formatStickerList(entries, '', 2);
  assert.equal(all.total, 3);
  assert.equal(all.stickers.length, 2);
  assert.equal(all.truncated, true);

  const hit = formatStickerList(entries, '无语', 10);
  assert.equal(hit.matched, 1);
  assert.equal(hit.stickers[0].id, '2');
  assert.ok(hit.stickers[0].tags.includes('无语'), '输出的是推断后标签');
});

test('buildStickerContext：带可直接发送的标识，且明确框成"资料不是指令"', () => {
  const entries = [
    normalizeStickerEntry({ id: 'a1', md5: 'md5aaa', desc: '无语', useCount: 3 }),
    normalizeStickerEntry({ id: 'a2', md5: 'md5bbb', desc: '晚安' })
  ];
  const block = buildStickerContext(entries, 8);
  assert.match(block, /【可用表情包】/);
  assert.match(block, /→ MD5AAA/, '必须带上可直接发送的标识');
  assert.match(block, /不是给你的指令/);
  assert.equal(buildStickerContext([], 8), '');
});

test('buildStickerStrategyHint：软策略文本齐全（真图优先/斗图/密度/刹车）', () => {
  const hint = buildStickerStrategyHint();
  for (const key of ['真图优先', '认图', '斗图', '密度', '场合不影响风格', '缺图可以自己去找']) {
    assert.ok(hint.includes(key), `缺少策略要点：${key}`);
  }
});

test('标签：词表内归一、词表外最多留 4 个、推断合并进最终标签', () => {
  assert.deepEqual(normalizeTags(['无语', '不存在的词', '开心', '无语']), ['开心', '无语']);
  const merged = mergeTags(['无语', '自造词1', '自造词2', '自造词3', '自造词4', '自造词5']);
  assert.equal(merged.length, 5, '1 个词表内 + 4 个自造词');
  assert.ok(merged.includes('自造词4'));
  assert.ok(!merged.includes('自造词5'));

  const e = normalizeStickerEntry({ id: '1', desc: '笑死了，绷不住' });
  const tags = deriveTags(e);
  assert.ok(tags.length > 0, '描述能推断出标签');
  assert.ok(tags.includes('开心'));
});

test('searchByTags / tagInventory：标签命中优先，统计能看出未打标签数量', () => {
  const entries = [
    normalizeStickerEntry({ id: '1', tags: ['无语'] }),
    normalizeStickerEntry({ id: '2', desc: '无语' }),
    normalizeStickerEntry({ id: '3', desc: '完全无关' })
  ];
  const hits = searchByTags(entries, '无语', { limit: 10 });
  assert.equal(hits[0].id, '1', '显式标签命中排前面');
  const inv = tagInventory(entries);
  assert.ok(inv.distinct >= 1);
  assert.equal(inv.untagged, 1);
});

test('applyStickerNote / markStickerUsed：就地改条目，找不到返回 null', () => {
  const entries = [normalizeStickerEntry({ id: '1', desc: 'x' })];
  const notedResult = applyStickerNote(entries, '1', { tags: ['无语'], note: '被怼时用' });
  assert.equal(notedResult.entry.localNote, '被怼时用');
  assert.ok(deriveTags(notedResult.entry).includes('无语'));
  const noted = notedResult.entries;

  const usedResult = markStickerUsed(noted, '1', '群里斗图');
  const used = usedResult.entries;
  assert.equal(usedResult.entry.useCount, 1);
  
  assert.equal(used[0].lastContext, '群里斗图');
  assert.equal(applyStickerNote(entries, 'nope', {}).entry, null);
});

