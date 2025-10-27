// highlight.js — role-colored keywords + safe tokenizer + full keyword list

// === 역할별 카테고리 ===
// (누락되었던 것들 포함: seal / tome / set / reveal / listen / prompt / confirm / warn / assert / fail / summon / invoke
//  padleft / padright / padcenter / essenceof / isvoid / ok? / okay? / for each / for each key / repeat each / otherwise when / as long as / choose upon / by / with / into)
const CATS = {
  flow: [
    'when','otherwise','until','guard','ward','stride','enumerate','conclude','begins','ends',
    'otherwise when','repeat each','for each key','for each','as long as','choose upon'
  ],
  logic: [
    'and','or','not','truth','lie','isvoid','ok?','okay?'
  ],
  compare: [
    'is greater than','is less than','is at least','is at most','is between','is',
    'by','with','into'
  ],
  core: [
    'transmute','weave','fuse','unfold','bundle','flood','span','bindfront','pluckfirst','pluck','holds','drawfrom',
    'stir','carve','rebrand','mirror','meld','shear','shearleft','shearright','ascend','descend','crowntitle','chant',
    'countof','fracturelines','bindlines','glyphs','essences','pairs',
    'tome','seal','set','reveal','listen','prompt','confirm','warn','assert','fail','summon','invoke'
  ],
  list: [
    'reverse','sort','takefirst','takelast','unique'
  ],
  time: [
    'now','nowutc','start of day','end of day','dawnof','duskof','decodetime','gapdays','gapseconds','format'
  ],
  random: [
    'seed','randomfloat','draw','choice','weighteddraw','flip'
  ],
  math: [
    'encode','decode','contains','seek','shape','morph','sift','distill','maprange','clamp','round','floor','ceil','abs',
    'remainder','raise','sum','average','min','max','padleft','padright','padcenter','essenceof'
  ]
};

// === 공통 유틸 ===
const ALL_KWS  = Object.values(CATS).flat().sort((a,b)=>b.length-a.length);
const KEYWORDS = new Set(ALL_KWS.map(s => s.toLowerCase()));
const escHTML  = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const escRe    = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 단어 경계: (?<!\w)(token)(?!\w) — ?, 공백 포함 구문도 정확히 매치
const KW_RE_BY_CAT = Object.fromEntries(
  Object.entries(CATS).map(([cat, arr]) => {
    const pat = arr.sort((a,b)=>b.length-a.length).map(escRe).join('|');
    return [cat, new RegExp(`(?<![A-Za-z0-9_])(${pat})(?![A-Za-z0-9_])`, 'gi')];
  })
);

// === 토큰 패턴 ===
const STR_RE   = /"(?:[^"\\]|\\.)*"|'''[\s\S]*?'''|"""[\s\S]*?"""/g;          // 문자열
const COMM_RE  = /(^|\n)\s*\/\/.*(?=\n|$)/g;                                   // 주석
const NUM_RE   = /\b-?(?:\d+\.\d+|\d+)\b/g;                                     // 숫자
const FN_RE    = /\b([A-Za-z_][A-Za-z0-9_]*)\b(?=\s*\()/g;                      // 함수 foo(
const DECL_RE  = /\b([A-Za-z_][A-Za-z0-9_]*)\b(\s+)(is)\b/gi;                   // 선언: name is ...

// === 플레이스홀더 (안전한 ASCII 토큰) ===
let seq = 0;
const tokenMap = new Map();
const OPEN = '__ARCANA_TOK_';
const CLOSE = '__';

const put = html => {
  const key = `${OPEN}${seq++}${CLOSE}`;
  tokenMap.set(key, html);
  return key;
};

function replaceOutside(text, regex, replacer){
  const ph = new RegExp(`${OPEN}\\d+${CLOSE}`, 'g');
  let out = '', last = 0, m;
  while ((m = ph.exec(text))) {
    out += text.slice(last, m.index).replace(regex, replacer);
    out += m[0];
    last = m.index + m[0].length;
  }
  out += text.slice(last).replace(regex, replacer);
  return out;
}

function expandWithEscape(text){
  const ph = new RegExp(`${OPEN}\\d+${CLOSE}`, 'g');
  let out = '', last = 0, m;
  while ((m = ph.exec(text))) {
    out += escHTML(text.slice(last, m.index));     // 일반 텍스트만 escape
    out += tokenMap.get(m[0]) || '';               // 토큰은 HTML로 복원
    last = m.index + m[0].length;
  }
  out += escHTML(text.slice(last));
  return out;
}

// === 메인 ===
export function highlightArcana(src){
  seq = 0; tokenMap.clear();
  let s = String(src ?? '');

  // 1) 문자열/주석 먼저 토큰화
  s = s
    .replace(STR_RE,  m => put(`<span class="tok-string">${escHTML(m)}</span>`))
    .replace(COMM_RE, m => put(`<span class="tok-comment">${escHTML(m)}</span>`));

  // 2) 선언: "name is ..." — name은 선언변수, is는 비교 카테고리
  s = replaceOutside(s, DECL_RE, (full, name, space, isWord) => {
    const v = put(`<span class="tok-vardecl">${name}</span>`);
    const k = put(`<span class="tok-keyword-compare">${isWord}</span>`);
    return v + space + k;
  });

  // 3) 카테고리 키워드
  for (const [cat, re] of Object.entries(KW_RE_BY_CAT)) {
    s = replaceOutside(s, re, (m) => put(`<span class="tok-keyword-${cat}">${m}</span>`));
  }

  // 4) 숫자
  s = replaceOutside(s, NUM_RE, m => put(`<span class="tok-number">${m}</span>`));

  // 5) 함수 식별자
  s = replaceOutside(s, FN_RE, (m, name) => put(`<span class="tok-function">${name}</span>`));

  // 6) 확정 출력
  return expandWithEscape(s);
}
