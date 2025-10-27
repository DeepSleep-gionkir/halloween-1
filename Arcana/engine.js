// js/engine.js  (ES Module)
const MAGIC_INK_RE = /\{\|\s*([\s\S]+?)\s*\|\}/g;
// [ADD]
const MAX_UNTIL_ITER = 10000;
export class ArcanaEngine {
  constructor(outputEl) {
    this.outputEl = outputEl;
    this.reset();
  }

  reset() {
    this.variables = Object.create(null);
    this.sealed = new Set();
    this.modules = Object.create(null);
    this.__seed = 123456789; // RNG
  }

  // ========== RNG ==========
  __rand() {
    let x = this.__seed | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.__seed = x | 0;
    return ((x >>> 0) / 4294967296);
  }

  // ========== Utils ==========
  esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  // 2-1) TitleCase
__titleCase(s){
  return String(s).replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

    // [ADD] 시간 포맷 캐시
__timeFmtCache = new Map();
__regexForTimeFormat(fmt){
  let hit = this.__timeFmtCache.get(fmt);
  if (hit) return hit;
  const toks = ['YYYY','MM','DD','HH','mm','ss'];
  let re = fmt;
  toks.forEach(t => re = re.replace(t, `(\\d{${t==='YYYY'?4:2}})`));
  const rx = new RegExp('^' + re + '$');
  this.__timeFmtCache.set(fmt, rx);
  return rx;
}

  // 2-2) 최상위 쉼표 split (배열/객체/문자열 중첩 안전)
splitTopLevelByComma(s){
  let arr=[], cur='', depth=0, inS=false, q=null;
  for (let i=0;i<s.length;i++){
    const c=s[i], p=s[i-1];
    if (inS){ cur+=c; if (c===q && p!=='\\'){ inS=false; q=null; } continue; }
    if (c==='"' || c==="'"){ inS=true; q=c; cur+=c; continue; }
    if (c==='['||c==='{'){ depth++; cur+=c; continue; }
    if (c===']'||c==='}'){ depth--; cur+=c; continue; }
    if (c===',' && depth===0){ arr.push(cur.trim()); cur=''; continue; }
    cur+=c;
  }
  if (cur.trim()!=='') arr.push(cur.trim());
  return arr;
}

    // 2-3) 문자열 패딩 유틸 (추후 PadLeft/Right/Center 등에 사용)
__padLeft(s, ch, w){
  s=String(s); ch=String(ch||' '); if(ch==='') ch=' ';
  while (s.length < w) s = ch + s;
  return (s.length > w) ? s.slice(-w) : s;
}
__padRight(s, ch, w){
  s=String(s); ch=String(ch||' '); if(ch==='') ch=' ';
  while (s.length < w) s = s + ch;
  return (s.length > w) ? s.slice(0,w) : s;
}
__padCenter(s, ch, w){
  s=String(s); ch=String(ch||' '); if(ch==='') ch=' ';
  while (s.length < w){ if ((w - s.length) % 2) s = s + ch; else s = ch + s; }
  return (s.length > w) ? s.slice(0,w) : s;
}


  getByPath(root, path){
    const parts = path.split('.'); let cur = root;
    for (const p of parts){ if (cur==null) return undefined; cur = cur[p]; }
    return cur;
  }
  setByPath(root, path, value){
    const parts = path.split('.'); let cur = root;
    for (let i=0;i<parts.length-1;i++){
      const k = parts[i];
      if (cur[k]==null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length-1]] = value;
  }

  // 2-4) Tome 리터럴 파서 (Tome { name:"Aiden", hp: 10 })
parseTomeLiteral(s){
  const m = s.match(/^Tome\s*\{([\s\S]*)\}$/i);
  if (!m) return null;
  const body = m[1].trim();
  const pairs = this.splitTopLevelByComma(body);
  const obj = {};
  for (const p of pairs){
    const kv = p.split(':');
    const key = kv[0].trim().replace(/^"([^"]+)"$/,'$1');
    const valExpr = kv.slice(1).join(':').trim();
    obj[key] = this.evaluateValue(valExpr);
  }
  return obj;
}

  // 2-5) Shape(람다) 파서/실행기 — Map/Filter/Reduce 기반
__parseShape(src){
  const s = String(src).trim();
  let m = s.match(/^Shape\s*\(\s*([^)]+?)\s*\)\s*=>\s*([\s\S]+)$/i);
  if (m){
    const params = m[1].split(',').map(x=>x.trim()).filter(Boolean);
    return { __shape:true, params, expr:m[2].trim() };
  }
  m = s.match(/^Shape\s+([A-Za-z_]\w*)\s*=>\s*([\s\S]+)$/i);
  if (m){
    return { __shape:true, params:[m[1]], expr:m[2].trim() };
  }
  return null;
}
__isShape(v){ return v && v.__shape === true; }
__execShape(shape, args){
  const saved = this.variables;
  const local = Object.create(saved);
  (shape.params||[]).forEach((p,i)=>{ local[p] = args[i]; });
  this.variables = local;
  try { return this.evaluateValue(shape.expr); }
  finally { this.variables = saved; }
}

  // ========== Module loader ==========
  loadStdModule(path, alias){
    const name = alias || path.split('/').pop();
    if (path === 'std/time'){
      this.modules[name] = {
        now: ()=>new Date(),
        format:(d, pat)=>{
          d = (d instanceof Date)? d : new Date(d);
          const pad2 = n => String(n).padStart(2,'0');
          const Y=d.getFullYear(), M=pad2(d.getMonth()+1), D=pad2(d.getDate()),
                H=pad2(d.getHours()), m=pad2(d.getMinutes()), S=pad2(d.getSeconds());
          return String(pat).replace(/YYYY/g,Y).replace(/MM/g,M).replace(/DD/g,D).replace(/HH/g,H).replace(/mm/g,m).replace(/ss/g,S);
        },
        parse:(text, fmt)=>{
          const toks=['YYYY','MM','DD','HH','mm','ss']; const map={YYYY:1970,MM:1,DD:1,HH:0,mm:0,ss:0}; let re=fmt;
          toks.forEach(t=>re=re.replace(t,`(\\d{${t==='YYYY'?4:2}})`));
          const rx=new RegExp('^'+re+'$'); const m=String(text).match(rx);
          if(!m) throw new Error('std/time.parse 실패');
          let idx=1; toks.forEach(t=>{ if(fmt.indexOf(t)!==-1) map[t]=parseInt(m[idx++],10); });
          return new Date(map.YYYY, map.MM-1, map.DD, map.HH, map.mm, map.ss);
        },
        addDays:(d,n)=>{ d=new Date(d); const u=new Date(d); u.setDate(u.getDate()+Number(n)); return u; },
        addHours:(d,n)=>{ d=new Date(d); const u=new Date(d); u.setHours(u.getHours()+Number(n)); return u; },
        diffDays:(a,b)=>Math.round((new Date(b)-new Date(a))/86400000),
        diffSeconds:(a,b)=>Math.round((new Date(b)-new Date(a))/1000),
        startOfDay:(d)=>{ d=new Date(d); const u=new Date(d); u.setHours(0,0,0,0); return u; },
        endOfDay:(d)=>{ d=new Date(d); const u=new Date(d); u.setHours(23,59,59,999); return u; }
      };
    } else if (path === 'std/json'){
      this.modules[name] = { encode:(v)=>JSON.stringify(v), decode:(s)=>JSON.parse(String(s)) };
    } else if (path === 'std/random'){
      this.modules[name] = {
        seed:(n)=>{ this.__seed=(Math.floor(Number(n))>>>0); return this.__seed; },
        float:(a,b)=>{ a=Number(a); b=Number(b); const lo=Math.min(a,b), hi=Math.max(a,b); return this.__rand()*(hi-lo)+lo; },
        int:(a,b)=>{ a=Number(a); b=Number(b); const lo=Math.min(a,b), hi=Math.max(a,b); return Math.floor(this.__rand()*(hi-lo+1))+lo; },
        bernoulli:(p)=>{ p=Number(p); if(!(p>=0 && p<=1)) throw new Error('p는 0~1'); return this.__rand()<p; },
        choice:(...xs)=>{ const arr = xs.length===1 && Array.isArray(xs[0]) ? xs[0] : xs; if(!arr.length) throw new Error('choice 비어있음'); return arr[Math.floor(this.__rand()*arr.length)]; },
        shuffle:(arr)=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(this.__rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; },
        sample:(arr,k)=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(this.__rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a.slice(0,Math.max(0,Math.min(k,a.length))); }
      };
    } else if (path === 'std/array'){
      this.modules[name] = {
        chunk:(arr,size)=>{ if(!Array.isArray(arr)) throw new Error('chunk 배열 필요'); size=Math.max(1,Number(size)|0); const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; },
        flatten:(arr)=>{ if(!Array.isArray(arr)) throw new Error('flatten 배열 필요'); return arr.reduce((a,x)=>a.concat(x),[]); },
        sum:(arr)=>{ if(!Array.isArray(arr)) throw new Error('sum 배열 필요'); return arr.reduce((s,x)=>s+Number(x||0),0); },
        average:(arr)=>{ if(!Array.isArray(arr)) throw new Error('average 배열 필요'); return arr.length? arr.reduce((s,x)=>s+Number(x||0),0)/arr.length : 0; },
        min:(arr)=>{ if(!Array.isArray(arr)||!arr.length) throw new Error('min 배열 필요'); return Math.min(...arr.map(Number)); },
        max:(arr)=>{ if(!Array.isArray(arr)||!arr.length) throw new Error('max 배열 필요'); return Math.max(...arr.map(Number)); },
        unique:(arr)=>Array.from(new Set(arr)),
        concat:(a,b)=>{ if(!Array.isArray(a)||!Array.isArray(b)) throw new Error('concat 배열 2개 필요'); return a.concat(b); }
      };
    } else if (path === 'std/tome'){
      this.modules[name] = {
        keys:(o)=>Object.keys(o||{}),
        values:(o)=>Object.values(o||{}),
        pairs:(o)=>Object.entries(o||{}),
        merge:(a,b)=>Object.assign({}, b||{}, a||{}),
        tally:(arr)=>{ const f={}; (arr||[]).forEach(x=>{ const k=String(x); f[k]=(f[k]||0)+1; }); return f; }
      };
    } else {
      this.modules[name] = {};
    }
  }

  // ========== Eval ==========
  evaluateValue(valueString){
    if (valueString == null) return '';
    let s = valueString.trim();

    if (/^"""[\s\S]*?"""$/.test(s) || /^'''[\s\S]*?'''$/.test(s)) return s.slice(3,-3);
    if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return JSON.parse(s.replace(/\\x/g,'\\\\x'));
    if (/^(truth|true)$/i.test(s)) return true;
    if (/^(lie|false)$/i.test(s))  return false;
    if (/^-?(?:\d+\.\d+|\d+)$/.test(s)) return Number(s);

    if (/^\[.*\]$/.test(s)){
      const inner = s.slice(1,-1).trim();
      if (inner==='') return [];
      return this.splitTopLevelByComma(inner).map(x=>this.evaluateValue(x));
    }
    if (/^Tome\s*\{[\s\S]*\}$/.test(s)) return this.parseTomeLiteral(s);

    const mv = s.match(/^invoke\s+(\w+)\.(\w+)\s+with\s+([\s\S]+)$/i);
    if (mv){
      const mod = this.modules[mv[1]]; if (!mod) throw new Error(`Unknown module: ${mv[1]}`);
      const fn  = mod[mv[2]];         if (!fn) throw new Error(`No function: ${mv[2]}`);
      const args= this.splitTopLevelByComma(mv[3]).map(x=>this.evaluateValue(x));
      return fn.apply(mod, args);
    }

    if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(s)){
      return this.getByPath(this.variables, s);
    }

    const shp = this.__parseShape(s);
    if (shp) return shp;

    return s;
  }

  evaluateCondition(conditionString){
    let s = conditionString.trim();

    let mg = s.match(/^(.+)\s+is\s+greater\s+than\s+(.+)$/i);
    if (mg) return Number(this.evaluateValue(mg[1])) >  Number(this.evaluateValue(mg[2]));
    mg = s.match(/^(.+)\s+is\s+less\s+than\s+(.+)$/i);
    if (mg) return Number(this.evaluateValue(mg[1])) <  Number(this.evaluateValue(mg[2]));
    mg = s.match(/^(.+)\s+is\s+at\s+least\s+(.+)$/i);
    if (mg) return Number(this.evaluateValue(mg[1])) >= Number(this.evaluateValue(mg[2]));
    mg = s.match(/^(.+)\s+is\s+at\s+most\s+(.+)$/i);
    if (mg) return Number(this.evaluateValue(mg[1])) <= Number(this.evaluateValue(mg[2]));

    let me = s.match(/^(.+)\s+is\s+(.+)$/i);
    if (me) return String(this.evaluateValue(me[1])) === String(this.evaluateValue(me[2]));
    me = s.match(/^(.+)\s+is\s+not\s+(.+)$/i);
    if (me) return String(this.evaluateValue(me[1])) !== String(this.evaluateValue(me[2]));

    // Begins / Ends / Contains / Holds key
    // === PATCH 3-A: evaluateCondition 내부, 마지막 return 전에 추가 ===

// Begins / Ends
let __msw = s.match(/^Begins\s+(.+)\s+with\s+"([^"]*)"\s*$/i);
if (__msw) return String(this.evaluateValue(__msw[1])).startsWith(__msw[2]);

let __mew = s.match(/^Ends\s+(.+)\s+with\s+"([^"]*)"\s*$/i);
if (__mew) return String(this.evaluateValue(__mew[1])).endsWith(__mew[2]);

// Contains (value in string/array)
let __mcv = s.match(/^Contains\s+(.+)\s+in\s+(.+)\s*$/i);
if (__mcv){
  const needle = this.evaluateValue(__mcv[1]);
  const hay    = this.evaluateValue(__mcv[2]);
  if (typeof hay === 'string') return String(hay).includes(String(needle));
  if (Array.isArray(hay))      return hay.some(v=>v===needle);
  return false;
}

// Holds key "k" in Tome
let __mhk = s.match(/^Holds\s+key\s+(.+)\s+in\s+(.+)\s*$/i);
if (__mhk){
  const k = this.evaluateValue(__mhk[1]);
  const o = this.evaluateValue(__mhk[2]);
  return !!(o && typeof o==='object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, k));
}

    if (/^(truth|true)$/i.test(s)) return true;
    if (/^(lie|false)$/i.test(s))  return false;

    return !!this.evaluateValue(s);
  }

  // ========== Blocks ==========
  findBlockEnd(lines, start){
    let depth = 0;
    const isStarter = (raw)=>{
      const l = raw.trim().toLowerCase();
      return l.startsWith('when') || l.startsWith('repeat ') || l.startsWith('repeat each ') ||
             l.startsWith('for each ') || l.startsWith('for each key') || l.startsWith('enumerate ') ||
             l.startsWith('stride ') || l.startsWith('until ') || l.startsWith('ward ') ||
             l.startsWith('guard ') || l.startsWith('as long as') || l.startsWith('choose upon ') ||
             l.startsWith('inscribe ') || l.startsWith('attempt') || l.startsWith('count ');
    };
    for (let i=start+1;i<lines.length;i++){
      const t = lines[i].trim();
      if (/^conclude$/i.test(t)){ if (depth===0) return i; depth--; continue; }
      if (isStarter(t)) depth++;
    }
    return -1;
  }

  async executeBlock(block){
    const inner = block.split('\n');
    for (let j=0;j<inner.length;j++){
      const raw = inner[j];
      await this.processLine(raw.trim());
    }
  }

  // ========== Single line dispatcher ==========
  async processLine(l){
    if (!l || /^\/\//.test(l)) return;

    let m;

    // 선언/대입/Seal
    m = l.match(/^(\w+)\s+is\s+([\s\S]+?)\s*(ok\??|okay\??)$/i);
    if (m){ const name=m[1]; if (this.sealed.has(name)) throw new Error(`${name} is sealed`); this.variables[name]=this.evaluateValue(m[2]); return; }
    m = l.match(/^Set\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+to\s+([\s\S]+?)\s*(ok\??|okay\??)$/i);
    if (m){ const path=m[1]; if (this.sealed.has(path.split('.')[0])) throw new Error(`${path} is sealed`); this.setByPath(this.variables, path, this.evaluateValue(m[2])); return; }
    m = l.match(/^Seal\s+(\w+)\s+is\s+([\s\S]+?)\s*(ok\??|okay\??)$/i);
    if (m){ const name=m[1]; if (this.variables[name]!==undefined) throw new Error(`${name} already exists`); this.variables[name]=this.evaluateValue(m[2]); this.sealed.add(name); return; }

    // Reveal (Magic Ink)
    m = l.match(/^Reveal:\s*([\s\S]+?)\s*(ok\??|okay\??)?$/i);
    if (m){
      const out = String(m[1]).replace(MAGIC_INK_RE, (_, expr)=> String(this.evaluateValue(expr)));
      if (this.outputEl){ this.outputEl.textContent += out + '\n'; this.outputEl.scrollTop = this.outputEl.scrollHeight; }
      return;
    }

    // Summon / invoke
    m = l.match(/^Summon\s+"([^"]+)"(?:\s+as\s+(\w+))?\s*(ok\??|okay\??)$/i);
    if (m){ const path=m[1]; const alias=m[2]||path.split('/').pop(); this.loadStdModule(path, alias); return; }
    m = l.match(/^invoke\s+(\w+)\.(\w+)\s+with\s+([\s\S]+?)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const mod=this.modules[m[1]]; if(!mod) throw new Error(`Unknown module: ${m[1]}`); const fn=mod[m[2]]; if(!fn) throw new Error(`Unknown function ${m[2]} in module ${m[1]}`); const args=this.splitTopLevelByComma(m[3]).map(x=>this.evaluateValue(x)); this.variables[m[4]] = fn.apply(mod, args); return; }

    // 문자열
    m = l.match(/^Transmute\s+(.+)\s+within\s+(.+)\s+to\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const oldv=String(this.evaluateValue(m[1])); const src=String(this.evaluateValue(m[2])); const newv=String(this.evaluateValue(m[3])); this.variables[m[4]] = src.split(oldv).join(newv); return; }
    m = l.match(/^Shear\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);      if (m){ this.variables[m[2]] = String(this.evaluateValue(m[1])).trim(); return; }
    m = l.match(/^ShearLeft\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);  if (m){ this.variables[m[2]] = String(this.evaluateValue(m[1])).replace(/^\s+/, ''); return; }
    m = l.match(/^ShearRight\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[2]] = String(this.evaluateValue(m[1])).replace(/\s+$/, ''); return; }
    m = l.match(/^Ascend\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);     if (m){ this.variables[m[2]] = String(this.evaluateValue(m[1])).toUpperCase(); return; }
    m = l.match(/^Descend\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);    if (m){ this.variables[m[2]] = String(this.evaluateValue(m[1])).toLowerCase(); return; }
    m = l.match(/^CrownTitle\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[2]] = this.__titleCase(this.evaluateValue(m[1])); return; }
    // Begins/Ends into var
m = l.match(/^Begins\s+(.+)\s+with\s+"([^"]*)"\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){ this.variables[m[3]] = String(this.evaluateValue(m[1])).startsWith(m[2]); return; }

m = l.match(/^Ends\s+(.+)\s+with\s+"([^"]*)"\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){ this.variables[m[3]] = String(this.evaluateValue(m[1])).endsWith(m[2]); return; }
    m = l.match(/^Chant\s+(.+)\s+times\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const s=String(this.evaluateValue(m[1])); const n=Math.max(0,Number(this.evaluateValue(m[2]))|0); this.variables[m[3]]=s.repeat(n); return; }
    m = l.match(/^Carve\s+(.+)\s+from\s+(.+)\s+for\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const txt=String(this.evaluateValue(m[1])); let start=Number(this.evaluateValue(m[2])); const len=Number(this.evaluateValue(m[3])); const L=txt.length; if(start<0) start=Math.max(0,L+start); this.variables[m[4]]=txt.substr(start, Math.max(0,len|0)); return; }
    m = l.match(/^CountOf\s+(.+)\s+in\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const needle=String(this.evaluateValue(m[1])); const hay=String(this.evaluateValue(m[2])); if(needle===''){ this.variables[m[3]]=0; return; } let c=0,pos=0; while(true){ const i=hay.indexOf(needle,pos); if(i===-1)break; c++; pos=i+needle.length; } this.variables[m[3]]=c; return; }
    m = l.match(/^FractureLines\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[2]] = String(this.evaluateValue(m[1])).split(/\r?\n/); return; }
    m = l.match(/^BindLines\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);      if (m){ const arr=this.evaluateValue(m[1]); if(!Array.isArray(arr)) throw new Error('BindLines 대상은 배열'); this.variables[m[2]]=arr.join('\n'); return; }
    m = l.match(/^Weave\s+(.+)\s+with\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const arr=this.evaluateValue(m[1]); const sep=String(this.evaluateValue(m[2])); if(!Array.isArray(arr)) throw new Error('Weave 대상은 배열'); this.variables[m[3]]=arr.join(sep); return; }
    // Contains into var
m = l.match(/^Contains\s+(.+)\s+in\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  const needle=this.evaluateValue(m[1]);
  const hay=this.evaluateValue(m[2]);
  this.variables[m[3]] = (typeof hay==='string')
    ? String(hay).includes(String(needle))
    : (Array.isArray(hay) ? hay.some(v=>v===needle) : false);
  return;
}
    // 배열
    m = l.match(/^Stir\s+(.+)\s*(ok\??|okay\??)$/i);
    if (m){ const arr=this.evaluateValue(m[1]); if(!Array.isArray(arr)) throw new Error('Stir 대상은 배열'); for (let i=arr.length-1;i>0;i--){ const j=Math.floor(this.__rand()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return; }
    m = l.match(/^DrawFrom\s+(.+)\s+count\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const arr=this.evaluateValue(m[1]); const k=Number(this.evaluateValue(m[2]))|0; if(!Array.isArray(arr)) throw new Error('DrawFrom 대상은 배열'); const a=arr.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(this.__rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } this.variables[m[3]] = a.slice(0,Math.max(0,Math.min(k,a.length))); return; }
    m = l.match(/^BindFront\s+(.+)\s+to\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const v=this.evaluateValue(m[1]); const name=m[2]; if(!Array.isArray(this.variables[name])) throw new Error(`${name} 배열 아님`); this.variables[name].unshift(v); return; }
    m = l.match(/^PluckFirst\s+from\s+(\w+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const a=this.variables[m[1]]; if(!Array.isArray(a)) throw new Error('PluckFirst 대상은 배열'); this.variables[m[2]]=a.shift(); return; }
    m = l.match(/^Fuse\s+(.+)\s+and\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const A=this.evaluateValue(m[1]), B=this.evaluateValue(m[2]); if(!Array.isArray(A)||!Array.isArray(B)) throw new Error('Fuse에는 배열 2개'); this.variables[m[3]] = A.concat(B); return; }
    m = l.match(/^Unfold\s+(.+)\s+one\s+level\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const A=this.evaluateValue(m[1]); if(!Array.isArray(A)) throw new Error('Unfold 대상은 배열'); this.variables[m[2]] = A.reduce((acc,x)=>acc.concat(x),[]); return; }
    m = l.match(/^Bundle\s+(.+)\s+by\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const a=this.evaluateValue(m[1]); const s=Math.max(1,Number(this.evaluateValue(m[2]))|0); if(!Array.isArray(a)) throw new Error('Bundle 대상은 배열'); const out=[]; for(let i=0;i<a.length;i+=s) out.push(a.slice(i,i+s)); this.variables[m[3]]=out; return; }
    m = l.match(/^Span\s+(.+)\s+to\s+(.+)(?:\s+by\s+(.+))?\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const a=Number(this.evaluateValue(m[1])), b=Number(this.evaluateValue(m[2])); let step=m[3]?Number(this.evaluateValue(m[3])):(a<=b?1:-1); if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(step)||step===0) throw new Error('Span 파라미터 오류'); const out=[]; if(step>0){ for(let x=a;x<=b;x+=step) out.push(x);} else { for(let x=a;x>=b;x+=step) out.push(x);} this.variables[m[4]]=out; return; }
    m = l.match(/^Sum\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);      if (m){ const a=this.evaluateValue(m[1]); if(!Array.isArray(a)) throw new Error('Sum 대상은 배열'); this.variables[m[2]] = a.reduce((s,x)=>s+Number(x||0),0); return; }
    m = l.match(/^Average\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);  if (m){ const a=this.evaluateValue(m[1]); if(!Array.isArray(a)||!a.length){ this.variables[m[2]]=0; return; } this.variables[m[2]]=a.reduce((s,x)=>s+Number(x||0),0)/a.length; return; }
    m = l.match(/^Min\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);      if (m){ const a=this.evaluateValue(m[1]); if(!Array.isArray(a)||!a.length) throw new Error('Min 공배열'); this.variables[m[2]]=Math.min(...a.map(Number)); return; }
    m = l.match(/^Max\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);      if (m){ const a=this.evaluateValue(m[1]); if(!Array.isArray(a)||!a.length) throw new Error('Max 공배열'); this.variables[m[2]]=Math.max(...a.map(Number)); return; }
    m = l.match(/^Flood\s+(\w+)\s+with\s+(.+)\s*(ok\??|okay\??)$/i);
    if (m){ const name=m[1]; const v=this.evaluateValue(m[2]); if(!Array.isArray(this.variables[name])) throw new Error(`${name} 배열 아님`); this.variables[name].fill(v); return; }
    m = l.match(/^Sort\s+(.+?)(?:\s+(ascending|descending))?\s*(ok\??|okay\??)$/i);
    if (m){ const arr=this.evaluateValue(m[1]); const dir=(m[2]||'ascending').toLowerCase(); if(!Array.isArray(arr)) throw new Error('Sort 대상은 배열'); const asc=(dir!=='descending'); arr.sort((x,y)=>{ const sx=typeof x, sy=typeof y; if(sx==='number'&&sy==='number') return asc?x-y:y-x; return asc?String(x).localeCompare(String(y)):String(y).localeCompare(String(x)); }); return; }
    m = l.match(/^Reverse\s+(.+)\s*(ok\??|okay\??)$/i); if (m){ const arr=this.evaluateValue(m[1]); if(!Array.isArray(arr)) throw new Error('Reverse 대상은 배열'); arr.reverse(); return; }
    m = l.match(/^Unique\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);  if (m){ const arr=this.evaluateValue(m[1]); if(!Array.isArray(arr)) throw new Error('Unique 대상은 배열'); this.variables[m[2]] = Array.from(new Set(arr)); return; }
    // Seek <needle> in <haystack> into idx   (문자열/배열 위치, 없으면 -1)
m = l.match(/^Seek\s+(.+)\s+in\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  const val=this.evaluateValue(m[1]);
  const container=this.evaluateValue(m[2]);
  if (typeof container==='string')      this.variables[m[3]] = container.indexOf(String(val));
  else if (Array.isArray(container))    this.variables[m[3]] = container.indexOf(val);
  else throw new Error('Seek 대상은 문자열/배열');
  return;
}

    // Tome
    // Holds key into var
m = l.match(/^Holds\s+key\s+(.+)\s+in\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  const k=this.evaluateValue(m[1]);
  const o=this.evaluateValue(m[2]);
  this.variables[m[3]] = !!(o && typeof o==='object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o,k));
  return;
}
    m = l.match(/^Glyphs\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);     if (m){ const o=this.evaluateValue(m[1]); if(!o||typeof o!=='object'||Array.isArray(o)) throw new Error('Glyphs 대상은 Tome'); this.variables[m[2]]=Object.keys(o); return; }
    m = l.match(/^Essences\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);  if (m){ const o=this.evaluateValue(m[1]); if(!o||typeof o!=='object'||Array.isArray(o)) throw new Error('Essences 대상은 Tome'); this.variables[m[2]]=Object.values(o); return; }
    m = l.match(/^Pairs\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);     if (m){ const o=this.evaluateValue(m[1]); if(!o||typeof o!=='object'||Array.isArray(o)) throw new Error('Pairs 대상은 Tome'); this.variables[m[2]]=Object.entries(o); return; }
    m = l.match(/^Pluck\s+key\s+(.+)\s+from\s+(.+)\s*(ok\??|okay\??)$/i);
    if (m){ const k=this.evaluateValue(m[1]); const obj=this.evaluateValue(m[2]); if(!obj||typeof obj!=='object'||Array.isArray(obj)) throw new Error('Pluck 대상은 Tome'); delete obj[k]; return; }
    m = l.match(/^Rebrand\s+key\s+(.+)\s+as\s+(.+)\s+in\s+(.+)\s*(ok\??|okay\??)$/i);
    if (m){ const oldK=this.evaluateValue(m[1]); const newK=this.evaluateValue(m[2]); const obj=this.evaluateValue(m[3]); if(!obj||typeof obj!=='object'||Array.isArray(obj)) throw new Error('Rebrand 대상은 Tome'); if(Object.prototype.hasOwnProperty.call(obj,oldK)){ obj[newK]=obj[oldK]; delete obj[oldK]; } return; }
    m = l.match(/^Meld\s+(.+)\s+into\s+(.+)\s*(ok\??|okay\??)$/i);
    if (m){ const src=this.evaluateValue(m[1]); const dst=this.evaluateValue(m[2]); if(!src||typeof src!=='object'||Array.isArray(src)||!dst||typeof dst!=='object'||Array.isArray(dst)) throw new Error('Meld 대상은 Tome'); Object.assign(dst, src); return; }
    m = l.match(/^Mirror\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const o=this.evaluateValue(m[1]); this.variables[m[2]] = JSON.parse(JSON.stringify(o)); return; }
    m = l.match(/^Pick\s+keys\s+(.+)\s+from\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const ks=this.evaluateValue(m[1]); const o=this.evaluateValue(m[2]); if(!Array.isArray(ks)) throw new Error('Pick keys 배열 필요'); const out={}; ks.forEach(k=>{ if(o && Object.prototype.hasOwnProperty.call(o,k)) out[k]=o[k]; }); this.variables[m[3]]=out; return; }
    m = l.match(/^Omit\s+keys\s+(.+)\s+from\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const ks=new Set(this.evaluateValue(m[1])); const o=this.evaluateValue(m[2]); const out={}; for (const k in o){ if(Object.prototype.hasOwnProperty.call(o,k) && !ks.has(k)) out[k]=o[k]; } this.variables[m[3]]=out; return; }
    m = l.match(/^Tally\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const a=this.evaluateValue(m[1]); if(!Array.isArray(a)) throw new Error('Tally 대상은 배열'); const f={}; for (const x of a){ const k=String(x); f[k]=(f[k]||0)+1; } this.variables[m[2]]=f; return; }

    // 고차함수
    // === ADD: Arcana-style names ===
m = l.match(/^Morph\s+(.+)\s+with\s+(Shape[\s\S]+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  const arr=this.evaluateValue(m[1]);
  const shape=this.evaluateValue(m[2]);
  if(!Array.isArray(arr)) throw new Error('Morph 대상은 배열');
  if(!this.__isShape(shape)) throw new Error('Morph에는 Shape 필요');
  const out=[];
  for(let i=0;i<arr.length;i++){
    const v = i in arr ? arr[i] : undefined;
    const args = shape.params.length>=2 ? [v,i] : [v];
    out.push(this.__execShape(shape,args));
  }
  this.variables[m[3]] = out; 
  return;
}

m = l.match(/^Sift\s+(.+)\s+with\s+(Shape[\s\S]+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  const arr=this.evaluateValue(m[1]);
  const shape=this.evaluateValue(m[2]);
  if(!Array.isArray(arr)) throw new Error('Sift 대상은 배열');
  if(!this.__isShape(shape)) throw new Error('Sift에는 Shape 필요');
  const out=[];
  for(let i=0;i<arr.length;i++){
    const v = i in arr ? arr[i] : undefined;
    const args = shape.params.length>=2 ? [v,i] : [v];
    if (this.__execShape(shape,args)) out.push(v);
  }
  this.variables[m[3]] = out;
  return;
}

m = l.match(/^Distill\s+(.+)\s+with\s+(Shape[\s\S]+)\s+from\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  const arr=this.evaluateValue(m[1]);
  const shape=this.evaluateValue(m[2]);
  let acc=this.evaluateValue(m[3]);
  if(!Array.isArray(arr)) throw new Error('Distill 대상은 배열');
  if(!this.__isShape(shape)) throw new Error('Distill에는 Shape 필요');
  for(let i=0;i<arr.length;i++){
    const v = i in arr ? arr[i] : undefined;
    const args = shape.params.length>=3 ? [acc,v,i] : [acc,v];
    acc = this.__execShape(shape,args);
  }
  this.variables[m[4]] = acc;
  return;
}
    // 수학/난수
    m = l.match(/^Remainder\s+(.+)\s+by\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[3]] = Number(this.evaluateValue(m[1])) % Number(this.evaluateValue(m[2])); return; }
    m = l.match(/^Raise\s+(.+)\s+by\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);      if (m){ this.variables[m[3]] = Math.pow(Number(this.evaluateValue(m[1])), Number(this.evaluateValue(m[2]))); return; }
    m = l.match(/^Clamp\s+(.+)\s+between\s+(.+)\s+and\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const x=Number(this.evaluateValue(m[1])), lo=Number(this.evaluateValue(m[2])), hi=Number(this.evaluateValue(m[3])); this.variables[m[4]] = Math.min(hi,Math.max(lo,x)); return; }
    m = l.match(/^Round\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[2]] = Math.round(Number(this.evaluateValue(m[1]))); return; }
    m = l.match(/^Floor\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[2]] = Math.floor(Number(this.evaluateValue(m[1]))); return; }
    m = l.match(/^Ceil\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);  if (m){ this.variables[m[2]] = Math.ceil(Number(this.evaluateValue(m[1]))); return; }
    m = l.match(/^Abs\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);   if (m){ this.variables[m[2]] = Math.abs(Number(this.evaluateValue(m[1]))); return; }
    m = l.match(/^MapRange\s+(.+)\s+from\s+(.+)\.\.(.+)\s+to\s+(.+)\.\.(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const x=Number(this.evaluateValue(m[1])), a1=Number(this.evaluateValue(m[2])), b1=Number(this.evaluateValue(m[3])), a2=Number(this.evaluateValue(m[4])), b2=Number(this.evaluateValue(m[5])); this.variables[m[6]] = a2 + ((x-a1)/(b1-a1))*(b2-a2); return; }
    m = l.match(/^Draw\s+float\s+between\s+(.+)\s+and\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const a=Number(this.evaluateValue(m[1])), b=Number(this.evaluateValue(m[2])); const lo=Math.min(a,b), hi=Math.max(a,b); this.variables[m[3]] = this.__rand()*(hi-lo)+lo; return; }

    // 시간
    m = l.match(/^NowUTC\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[1]] = new Date(Date.now()); return; }
    m = l.match(/^DecodeTime\s+"([^"]+)"\s+as\s+"([^"]+)"\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){
      const text=m[1], fmt=m[2], dst=m[3];
      const map={YYYY:1970,MM:1,DD:1,HH:0,mm:0,ss:0}; const toks=['YYYY','MM','DD','HH','mm','ss']; let re=fmt;
      toks.forEach(t=>re=re.replace(t,`(\\d{${t==='YYYY'?4:2}})`));
      const rx = this.__regexForTimeFormat(fmt);
      const ma = String(text).match(rx);
      if(!ma) throw new Error('DecodeTime 실패: 형식이 맞지 않습니다.');
      let idx=1; toks.forEach(t=>{ if(fmt.indexOf(t)!==-1) map[t]=parseInt(ma[idx++],10); });
      this.variables[dst] = new Date(map.YYYY, map.MM-1, map.DD, map.HH, map.mm, map.ss);
      return;
    }
    m = l.match(/^DawnOf\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const d=new Date(this.evaluateValue(m[1])); const u=new Date(d); u.setHours(0,0,0,0); this.variables[m[2]]=u; return; }
    m = l.match(/^DuskOf\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const d=new Date(this.evaluateValue(m[1])); const u=new Date(d); u.setHours(23,59,59,999); this.variables[m[2]]=u; return; }
    m = l.match(/^GapDays\s+between\s+(.+)\s+and\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const a=new Date(this.evaluateValue(m[1])), b=new Date(this.evaluateValue(m[2])); this.variables[m[3]] = Math.round((b-a)/86400000); return; }
    m = l.match(/^GapSeconds\s+between\s+(.+)\s+and\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const a=new Date(this.evaluateValue(m[1])), b=new Date(this.evaluateValue(m[2])); this.variables[m[3]] = Math.round((b-a)/1000); return; }
    m = l.match(/^Format\s+(.+)\s+as\s+"([^"]+)"\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
if (m){
  let d=this.evaluateValue(m[1]); const fmt=m[2]; d=(d instanceof Date)?d:new Date(d);
  const pad2=n=>String(n).padStart(2,'0');
  const Y=d.getFullYear(), M=pad2(d.getMonth()+1), D=pad2(d.getDate()), H=pad2(d.getHours()), mm=pad2(d.getMinutes()), ss=pad2(d.getSeconds());
  this.variables[m[3]] = String(fmt).replace(/YYYY/g,Y).replace(/MM/g,M).replace(/DD/g,D).replace(/HH/g,H).replace(/mm/g,mm).replace(/ss/g,ss);
  return;
}

    // JSON/타입/공허/저장
    m = l.match(/^Encode\s+JSON\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ this.variables[m[2]] = JSON.stringify(this.evaluateValue(m[1])); return; }
    m = l.match(/^Decode\s+JSON\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const t=String(this.evaluateValue(m[1])); try{ this.variables[m[2]] = JSON.parse(t); }catch{ throw new Error('JSON 파싱 실패'); } return; }
    m = l.match(/^EssenceOf\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i); if (m){ const v=this.evaluateValue(m[1]); this.variables[m[2]]=(v==null)?'null':Array.isArray(v)?'array':(v instanceof Date)?'date':(typeof v==='object')?'tome':typeof v; return; }
    m = l.match(/^IsVoid\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);     if (m){ const v=this.evaluateValue(m[1]); let f=false; if(v==null)f=true; else if(typeof v==='string') f=v.length===0; else if(Array.isArray(v)) f=v.length===0; else if(v instanceof Date) f=false; else if(typeof v==='object') f=Object.keys(v).length===0; this.variables[m[2]]=f; return; }
    m = l.match(/^Scribe\s+(.+)\s+as\s+"([^"]+)"\s*(ok\??|okay\??)$/i); if (m){ const text = this.evaluateValue(m[1]); const filename=m[2]; const blob = new Blob([String(text)], {type:'text/plain;charset=utf-8'}); const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 500); return; }
    m = l.match(/^Imprint\s+(.+)\s+to\s+clipboard\s*(ok\??|okay\??)$/i); if (m){ const text = this.evaluateValue(m[1]); if (navigator.clipboard?.writeText){ await navigator.clipboard.writeText(String(text)); } return; }

    // 확률/선택
    m = l.match(/^Choose\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const items=this.splitTopLevelByComma(m[1]).map(x=>this.evaluateValue(x)); if(!items.length) throw new Error('Choose 목록 비어 있음'); this.variables[m[2]] = items[Math.floor(this.__rand()*items.length)]; return; }
    m = l.match(/^Flip\s+with\s+p\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){ const p=Number(this.evaluateValue(m[1])); if(!(p>=0&&p<=1)) throw new Error('p는 0~1'); this.variables[m[2]] = (this.__rand()<p); return; }
    m = l.match(/^WeightedDraw\s+from\s+(.+)\s+weights\s+(.+)\s+into\s+(\w+)\s*(ok\??|okay\??)$/i);
    if (m){
      const arr=this.evaluateValue(m[1]); const ws=this.evaluateValue(m[2]);
      if(!Array.isArray(arr)||!Array.isArray(ws)||arr.length!==ws.length) throw new Error('가중치 길이 불일치');
      const cum=[]; let s=0; for (const w of ws){ const v=Number(w); if(!(v>=0)) throw new Error('가중치는 0 이상'); s+=v; cum.push(s); }
      if (s===0) throw new Error('가중치 합 0');
      const r=this.__rand()*s; let idx=cum.findIndex(c=>r<c); if(idx<0) idx=arr.length-1; this.variables[m[3]] = arr[idx]; return;
    }

    // 알 수 없는 문장
    throw new Error(`알 수 없는 문장: ${l}`);
  }

  // ========== Interpreter ==========
  async interpret(code){
    this.reset();
    const lines = code.split('\n');

    for (let i=0; i<lines.length; ){
      const trimmed = lines[i].trim();
      if (!trimmed || /^\/\//.test(trimmed)) { i++; continue; }

      // when … : / otherwise : / conclude
      if (/^when\s+/i.test(trimmed)){
        const cond = trimmed.slice(4).replace(/:\s*$/,'').trim();
        const end = this.findBlockEnd(lines, i); if (end === -1) throw new Error("'when' 블록의 'conclude'가 없습니다.");
        let elseAt = -1, depth=0;
        for (let k=i+1;k<end;k++){
          const t = lines[k].trim();
          if (/^(when|repeat |repeat each |for each |for each key|enumerate |stride |until |ward |guard |as long as|choose upon |inscribe |attempt|count )/i.test(t)) depth++;
          if (t.toLowerCase()==='conclude') depth--;
          if (depth===0 && /^otherwise:$/i.test(t)){ elseAt = k; break; }
        }
        if (this.evaluateCondition(cond)){
          const body = elseAt===-1 ? lines.slice(i+1, end).join('\n') : lines.slice(i+1, elseAt).join('\n');
          await this.executeBlock(body);
        } else if (elseAt !== -1){
          const body = lines.slice(elseAt+1, end).join('\n');
          await this.executeBlock(body);
        }
        i = end + 1; continue;
      }

      // Repeat each x in/among …
      let mre = trimmed.match(/^Repeat\s+each\s+(\w+)\s+(?:in|among)\s+(.+):\s*$/i);
      if (mre){
        const v = mre[1], container = this.evaluateValue(mre[2].trim());
        const end = this.findBlockEnd(lines, i); if (end === -1) throw new Error("'Repeat each' 블록의 'conclude'가 없습니다.");
        const body = lines.slice(i+1, end).join('\n');
        if (typeof container === 'string'){ for (const ch of container){ this.variables[v]=ch; await this.executeBlock(body); } }
        else if (Array.isArray(container)){ for (const item of container){ this.variables[v]=item; await this.executeBlock(body); } }
        else throw new Error("'Repeat each'는 문자열/배열만 순회");
        i = end + 1; continue;
      }

      // Stride i, x over <container>:
      let men = trimmed.match(/^Stride\s+(\w+)\s*,\s*(\w+)\s+over\s+(.+):\s*$/i);
      if (men){
        const idxName = men[1], valName = men[2], cont = this.evaluateValue(men[3].trim());
        const end = this.findBlockEnd(lines, i); if (end === -1) throw new Error("'Stride' 블록의 'conclude'가 없습니다.");
        const body = lines.slice(i+1, end).join('\n');
        if (typeof cont === 'string'){ for (let k=0;k<cont.length;k++){ this.variables[idxName]=k; this.variables[valName]=cont[k]; await this.executeBlock(body); } }
        else if (Array.isArray(cont)){ for (let k=0;k<cont.length;k++){ this.variables[idxName]=k; this.variables[valName]=cont[k]; await this.executeBlock(body); } }
        else throw new Error("'Stride'는 문자열/배열만");
        i = end + 1; continue;
      }

      // Ward <cond>:
      let mg = trimmed.match(/^Ward\s+(.*):\s*$/i);
      if (mg){
        const end = this.findBlockEnd(lines, i); if (end === -1) throw new Error("'Ward' 블록의 'conclude'가 없습니다.");
        let elseAt = -1, depth=0;
        for (let k=i+1;k<end;k++){
          const t = lines[k].trim();
          if (/^(when|repeat |repeat each |for each |for each key|enumerate |stride |until |ward |guard |as long as|choose upon |inscribe |attempt|count )/i.test(t)) depth++;
          if (t.toLowerCase()==='conclude') depth--;
          if (depth===0 && t.toLowerCase()==='otherwise:'){ elseAt = k; break; }
        }
        const condOk = this.evaluateCondition(mg[1].trim());
        if (elseAt === -1){
          if (condOk) await this.executeBlock(lines.slice(i+1, end).join('\n'));
        } else {
          if (condOk) await this.executeBlock(lines.slice(i+1, elseAt).join('\n'));
          else        await this.executeBlock(lines.slice(elseAt+1, end).join('\n'));
        }
        i = end + 1; continue;
      }

      // until <cond>:
      let mu = trimmed.match(/^until\s+(.*):\s*$/i);
      if (mu){
        const end = this.findBlockEnd(lines, i); if (end === -1) throw new Error("'until' 블록의 'conclude'가 없습니다.");
        const body = lines.slice(i+1, end).join('\n');
        let guard = 0;
do {
  await this.executeBlock(body);
  guard++;
  if (guard > MAX_UNTIL_ITER) throw new Error(`until 루프가 너무 깁니다(>${MAX_UNTIL_ITER}).`);
} while (!this.evaluateCondition(mu[1].trim()));
        i = end + 1; continue;
      }

      // single-line
      await this.processLine(trimmed);
      i++;
    }
  }
}
