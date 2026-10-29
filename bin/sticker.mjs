#!/usr/bin/env node
// sticker CLI：QQ 表情表查询 / 本地表情库检索 / 给模型注入的表情摘要 / 打标签。
//
//   sticker faces   [--q 关键词] [--group 分组] [--json]
//   sticker store   [--lib stickers.json]
//   sticker search  <query> [--lib ...] [--limit 20] [--json]
//   sticker context [--lib ...] [--max 8]
//   sticker note    <id> [--tags 无语,嫌弃] [--note 一句备注] [--lib ...]
//   sticker used    <id> [--context 用在什么场合] [--lib ...]
//   sticker export  [--lib ...] [--out stickers.md]
//
// 表情库默认：$STICKER_LIB，其次 ./state/stickers.json（不存在时按空库处理）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyStickerNote,
  buildStickerContext,
  buildStickerStrategyHint,
  formatStickerList,
  loadStickerStore,
  markStickerUsed,
  normalizeStickerEntry,
  saveStickerStore
} from '../src/sticker-lib.js';
import { deriveTags, tagInventory } from '../src/sticker-tags.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACES_FILE = path.join(HERE, '..', 'data', 'faces.json');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) args._.push(t);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) args[t.slice(2)] = true;
    else {
      args[t.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function libPath(args) {
  return path.resolve(String(args.lib ?? process.env.STICKER_LIB ?? path.join('state', 'stickers.json')));
}

function loadFaces() {
  const raw = JSON.parse(fs.readFileSync(FACES_FILE, 'utf8'));
  return Array.isArray(raw) ? raw : [];
}

function loadLib(args) {
  const file = libPath(args);
  try {
    return { file, entries: loadStickerStore(file) };
  } catch (error) {
    console.error(`${error.message}\n（为避免覆盖已有收藏，本命令只读；请先备份或修复该文件）`);
    process.exitCode = 1;
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] ?? 'faces';

  if (cmd === 'faces') {
    const q = String(args.q ?? args._[1] ?? '').trim().toLowerCase();
    const group = String(args.group ?? '').trim();
    const faces = loadFaces();
    const hits = faces.filter((f) => {
      if (group && f.group !== group) return false;
      if (!q) return true;
      return String(f.name).toLowerCase().includes(q) || String(f.id).toLowerCase() === q;
    });
    if (args.json) {
      console.log(JSON.stringify({ total: faces.length, matched: hits.length, faces: hits }, null, 2));
      return 0;
    }
    const groups = [...new Set(faces.map((f) => f.group))];
    console.log(`表情表 ${faces.length} 项，分组：${groups.join(' / ')}`);
    for (const f of hits.slice(0, Number(args.limit ?? 60))) {
      console.log(`${String(f.id).padStart(4)}  [face:${f.name}]  ${f.group}`);
    }
    if (hits.length > Number(args.limit ?? 60)) console.log(`……共 ${hits.length} 条，用 --limit 调大`);
    return 0;
  }

  if (cmd === 'store') {
    const lib = loadLib(args);
    if (!lib) return 1;
    const inv = tagInventory(lib.entries, { top: 10 });
    const bySource = lib.entries.reduce((acc, e) => ((acc[e.source] = (acc[e.source] ?? 0) + 1), acc), {});
    console.log(`库文件    ${lib.file}`);
    console.log(`条目      ${lib.entries.length}（按来源：${JSON.stringify(bySource)}）`);
    console.log(`标签覆盖  ${inv.distinct} 个标签 / ${inv.tagged} 次命中；未打标签 ${inv.untagged} 张`);
    console.log(`最常见    ${inv.top.map((t) => `${t.tag}×${t.count}`).join('、') || '（无）'}`);
    return 0;
  }

  if (cmd === 'search') {
    const lib = loadLib(args);
    if (!lib) return 1;
    const query = String(args._[1] ?? '');
    const result = formatStickerList(lib.entries, query, Number(args.limit ?? 20));
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`库内 ${result.total} 张，命中 ${result.matched} 张${result.truncated ? `（显示前 ${result.stickers.length}）` : ''}`);
    for (const s of result.stickers) {
      console.log(`${(s.md5 || s.id).slice(0, 12).padEnd(13)} ${(s.desc || s.localNote || '（无备注）').slice(0, 30).padEnd(32)} [${s.tags.join('/')}] 用过${s.useCount}次`);
    }
    return 0;
  }

  if (cmd === 'context') {
    const lib = loadLib(args);
    if (!lib) return 1;
    const block = buildStickerContext(lib.entries, Number(args.max ?? 8));
    console.log(block || '（库里还没有表情，注入为空）');
    if (args.strategy) {
      console.log('');
      console.log(buildStickerStrategyHint());
    }
    return 0;
  }

  if (cmd === 'note' || cmd === 'used') {
    const lib = loadLib(args);
    if (!lib) return 1;
    const id = String(args._[1] ?? '');
    if (!id) {
      console.error(`用法：sticker ${cmd} <id> [...]`);
      return 2;
    }
    const tags = args.tags ? String(args.tags).split(/[,\s/、，]+/).filter(Boolean) : [];
    const note = args.note !== undefined ? String(args.note) : args.context !== undefined ? String(args.context) : '';
    const result = cmd === 'note'
      ? applyStickerNote(lib.entries, id, { tags, ...(args.note !== undefined ? { note } : {}) })
      : markStickerUsed(lib.entries, id, note);
    if (!result.entry) {
      console.error(`库里没有这个表情：${id}`);
      return 1;
    }
    saveStickerStore(lib.file, result.entries);
    console.log(
      `已更新 ${result.entry.id}：标签 [${deriveTags(result.entry).join('/')}]，备注「${result.entry.localNote}」，用过 ${result.entry.useCount} 次`
    );
    return 0;
  }

  if (cmd === 'export') {
    const lib = loadLib(args);
    if (!lib) return 1;
    const rows = ['| id | md5 | 备注 | 标签 | 用过 |', '|---|---|---|---|---:|'];
    for (const e of lib.entries) {
      rows.push(`| ${e.id} | ${e.md5 || '—'} | ${(e.desc || e.localNote || '').replace(/\|/g, '/')} | ${deriveTags(e).join('/')} | ${e.useCount} |`);
    }
    const text = `${rows.join('\n')}\n`;
    if (args.out) {
      fs.mkdirSync(path.dirname(path.resolve(String(args.out))), { recursive: true });
      fs.writeFileSync(String(args.out), text, 'utf8');
      console.log(`已写入 ${path.resolve(String(args.out))}（${lib.entries.length} 条）`);
    } else {
      process.stdout.write(text);
    }
    return 0;
  }

  console.error(
    [
      '用法：',
      '  sticker faces   [--q 关键词] [--group 分组] [--json]',
      '  sticker store   [--lib stickers.json]',
      '  sticker search  <query> [--lib ...] [--limit 20] [--json]',
      '  sticker context [--lib ...] [--max 8] [--strategy]',
      '  sticker note    <id> [--tags 无语,嫌弃] [--note 备注] [--lib ...]',
      '  sticker used    <id> [--context 场合] [--lib ...]',
      '  sticker export  [--lib ...] [--out stickers.md]',
      '',
      `表情表：${FACES_FILE}`,
      `表情库默认：${libPath({})}`
    ].join('\n')
  );
  return 2;
}

process.exitCode = main();
