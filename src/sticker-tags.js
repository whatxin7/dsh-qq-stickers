// 表情语义索引：一套**受控词表**，让「找一张无语的图」变成可检索的事。
//
// 为什么不放任自由标签：`tags` 原本是自由字符串，AI 每次写的措辞都不一样
// （「无语」「有点无语」「看了想打人」），`qq_list_stickers(query)` 自然搜不准。
// 这里给定四个维度、一张有限词表，写标签时一律归一到词表内 —— 词表外的丢弃，
// 需要更细的意思用 localNote（自由文本）补，不进索引。
//
// 纯逻辑，不碰磁盘、不碰网络：谁想改分类，只改这个文件 + 跑 test-sticker-tags.mjs。

/** 四个维度：情绪 / 场景 / 画风 / 风险。顺序就是排序顺序。 */
export const TAG_DIMENSIONS = {
  mood: ['开心', '得意', '无语', '嫌弃', '疑惑', '生气', '委屈', '害羞', '敷衍', '震惊', '疲惫', '兴奋', '难过'],
  scene: ['打招呼', '告别', '晚安', '加油', '道谢', '道歉', '起哄', '求饶', '挑衅', '卖萌', '抱抱', '吐槽', '催促', '安慰'],
  style: ['旺仔', '小鲸鱼', '真人', '动漫', '像素', '文字图', '实拍', '手绘', '表情包'],
  risk: ['慎用']
};

export const ALL_TAGS = Object.values(TAG_DIMENSIONS).flat();
const TAG_ORDER = new Map(ALL_TAGS.map((t, i) => [t, i]));

/** 关键词 → 标签。词表外的说法靠这张表落进受控标签。 */
const KEYWORDS = [
  ['开心', ['笑', '开心', '哈哈', '嘿嘿', '好耶', '高兴', '鼓掌', '庆祝', '开森']],
  ['得意', ['得意', '叉腰', '牛', '厉害', '666', '拽', '嚣张', '凡尔赛', '赢了']],
  ['无语', ['无语', '扶额', '汗', '尬', '沉默', '省略号', '……', '...', '冷笑', '白眼', '服了', '离谱']],  ['嫌弃', ['嫌弃', '呸', '呕', '看不起', '鄙夷']],
  ['疑惑', ['疑惑', '问号', '?', '？', '懵', '不懂', '纳尼', 'what']],
  ['生气', ['生气', '怒', '火', '拳头', '砸', '拍桌', '气死']],
  ['委屈', ['委屈', '哭', '眼泪', '呜呜', '可怜', '惨', '难过', '呜']],
  ['害羞', ['害羞', '脸红', '脸红', '羞', '捂脸', '可爱', '不好意思']],
  ['敷衍', ['敷衍', '敷衍', '哦', '嗯', '随便', '打卡', '已阅', '收到']],
  ['震惊', ['震惊', '目瞪口呆', '卧槽', '好家伙']],
  ['疲惫', ['疲惫', '累', '躺', '困', '摆烂', '瘫', '狗带', '下班']],
  ['兴奋', ['好耶', '起飞', '燃', '激动', '冲鸭']],
  ['难过', ['难过', '伤心', 'emo', '丧', '落泪']],
  ['打招呼', ['打招呼', '你好', 'hi', 'hello', '在吗', '招手', '早']],
  ['告别', ['告别', '拜拜', '再见', '走了', '下播']],
  ['晚安', ['晚安', '睡', '睡觉', '梦里']],
  ['加油', ['加油', '努力', '打气', '干巴爹', '冲刺']],
  ['道谢', ['道谢', '谢谢', '多谢', '感谢', 'thx']],
  ['道歉', ['道歉', '对不起', '抱歉', 'sry', '我错了']],
  ['起哄', ['起哄', '围观', '吃瓜', '看戏', '热闹']],
  ['求饶', ['求饶', '饶命', '救命', '放过', '别打我']],
  ['挑衅', ['挑衅', '来啊', '打一架', '你打我', '挑衅']],
  ['卖萌', ['卖萌', '可爱', '么么', '蹭', '喵', '求摸']],
  ['抱抱', ['抱抱', '搂', '贴贴', '抱一下']],
  ['吐槽', ['吐槽', '绷不住', '笑死', '无语子', '离谱子']],
  ['催促', ['催促', '快点', '催', '搞快点', 'gkd']],
  ['安慰', ['安慰', '摸摸', '别哭', '没事', '抱抱你']],
  ['旺仔', ['旺仔', '牛奶', '旺仔牛奶', '罐']],
  ['小鲸鱼', ['鲸鱼', '小鲸鱼', '深海']],
  ['真人', ['真人', '照片', '自拍', '实人']],
  ['动漫', ['动漫', '二次元', '漫画', '动画']],
  ['像素', ['像素', 'pixel', '8bit']],
  ['文字图', ['文字图', '文字', '文案', '写着']],
  ['实拍', ['实拍', '生活照']],
  ['手绘', ['手绘', '涂鸦', '画的']],
  ['表情包', ['表情包', '表情', '梗图', 'meme']]
];

/** 词表校验：只留词表内的标签，去重，按维度顺序排，上限 max。 */
export function normalizeTags(input, { max = 12 } = {}) {
  const raw = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(/[,\s/、，]+/) : []);
  const seen = new Set();
  for (const item of raw) {
    const t = String(item ?? '').trim();
    if (!t || !TAG_ORDER.has(t) || seen.has(t)) continue;
    seen.add(t);
  }
  return [...seen].sort((a, b) => TAG_ORDER.get(a) - TAG_ORDER.get(b)).slice(0, Math.max(1, max));
}

/**
 * 入库用的合并：词表内标签优先，词表外的**保留最多 4 个**（AI 自己造的词不该被静默丢掉，
 * 它们仍然参与文本检索），总数上限 max。
 */
export function mergeTags(input, { max = 12, maxFree = 4 } = {}) {
  const raw = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(/[,\s/、，]+/) : []);
  const known = normalizeTags(raw, { max });
  const free = [];
  for (const item of raw) {
    const t = String(item ?? '').trim().slice(0, 24);
    if (!t || TAG_ORDER.has(t) || known.includes(t) || free.includes(t)) continue;
    free.push(t);
    if (free.length >= maxFree) break;
  }
  return [...known, ...free].slice(0, Math.max(1, max));
}

/** 从一段中文文本里推断标签（关键词命中即给，最多 max 个）。 */export function classifyByText(text, { max = 6 } = {}) {
  const s = String(text ?? '').toLowerCase();
  if (!s) return [];
  const hits = new Set();
  for (const [tag, words] of KEYWORDS) {
    if (words.some((w) => s.includes(String(w).toLowerCase()))) hits.add(tag);
  }
  return [...hits].sort((a, b) => TAG_ORDER.get(a) - TAG_ORDER.get(b)).slice(0, Math.max(1, max));
}

/**
 * 一条表情的最终标签：显式标签（词表内）∪ 文本推断。
 * 只读 desc / localNote / usage 三个字段 —— 它们是 AI 自己写的，比 QQ 侧名字可信。
 */
export function deriveTags(entry, { max = 12 } = {}) {
  if (!entry || typeof entry !== 'object') return [];
  const explicit = normalizeTags(entry.tags, { max });
  const inferred = classifyByText([entry.desc, entry.localNote, entry.usage].filter(Boolean).join(' '), { max: 6 });
  return normalizeTags([...explicit, ...inferred], { max });
}

/** 词表覆盖统计：给提示词/控制台看「现在这套索引长什么样」。 */
export function tagInventory(entries, { top = 8 } = {}) {
  const counts = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const t of deriveTags(e)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1] || TAG_ORDER.get(a[0]) - TAG_ORDER.get(b[0]));
  return {
    tagged: [...counts.values()].reduce((n, v) => n + v, 0),
    distinct: counts.size,
    top: list.slice(0, top).map(([tag, count]) => ({ tag, count })),
    untagged: (Array.isArray(entries) ? entries : []).filter((e) => deriveTags(e).length === 0).length
  };
}

/**
 * 按标签/文本检索：标签命中权重最高（2 分），文本命中 1 分。
 * 返回按分数降序的条目；分数相同按 useCount 高者优先（常用的先给）。
 */
export function searchByTags(entries, query, { limit = 48 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  if (!q) return list.slice(0, limit);
  // 查询词本身可能是标签（"无语"），也可能是普通词（"旺仔"）。
  const qTags = new Set([...normalizeTags([q]), ...classifyByText(q)]);
  const scored = [];
  for (const e of list) {
    const tags = new Set(deriveTags(e));
    let score = 0;
    for (const t of qTags) if (tags.has(t)) score += 2;
    const haystack = [e.desc, e.localNote, e.usage, e.id, e.resId, e.md5, ...(e.tags || [])].join(' ').toLowerCase();
    if (haystack.includes(q)) score += 1;
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || (Number(b.e.useCount) || 0) - (Number(a.e.useCount) || 0));
  return scored.slice(0, limit).map((x) => x.e);
}
