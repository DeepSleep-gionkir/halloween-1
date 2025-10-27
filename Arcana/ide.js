// ide.js — ES Module (single render path)
import { ArcanaEngine } from './engine.js';
import { highlightArcana } from './highlight.js';

const $ = (sel) => document.querySelector(sel);

document.addEventListener('DOMContentLoaded', () => {
  const codeEl    = $('#codeInput');
  const hiPre     = $('#highlighting-area');
  const hiCode    = $('#highlighting-area code.language-arcana');
  const lineNums  = $('#line-numbers');
  const runIcon   = $('#run-icon');
  const guideIcon = $('#guide-icon');
  const outputEl  = $('#outputConsole');
  const clearBtn  = $('#clear-console-btn');
  const sidebar   = $('#sidebar');
  const resizer   = $('#resizer');
  const statusEl  = $('#status-message');

  const engine = new ArcanaEngine(outputEl);
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  const render = () => {
    if (hiCode && codeEl) hiCode.innerHTML = highlightArcana(codeEl.value);

    if (lineNums && codeEl) {
      const n = (codeEl.value.split('\n').length || 1);
      let html = '';
      for (let i = 1; i <= n; i++) html += `<div class="ln">${i}</div>`;
      lineNums.innerHTML = html;
    }

    if (hiPre && codeEl) {
      hiPre.scrollTop  = codeEl.scrollTop;
      hiPre.scrollLeft = codeEl.scrollLeft;
    }
    if (lineNums && codeEl) lineNums.scrollTop = codeEl.scrollTop;
  };

  let raf = null;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; render(); }); };

  codeEl?.addEventListener('input', schedule);
  codeEl?.addEventListener('scroll', () => {
    if (!codeEl) return;
    if (hiPre) { hiPre.scrollTop = codeEl.scrollTop; hiPre.scrollLeft = codeEl.scrollLeft; }
    if (lineNums) lineNums.scrollTop = codeEl.scrollTop;
  });

  let running = false;
  runIcon?.addEventListener('click', async () => {
    if (running || !codeEl) return;
    running = true;
    runIcon.classList.add('disabled');
    setStatus('Running…');
    try { await engine.interpret(codeEl.value); setStatus('Done'); }
    catch (err) { outputEl.textContent += `❌ ${err?.message || err}\n`; setStatus('Error'); }
    finally {
      outputEl.scrollTop = outputEl.scrollHeight;
      running = false;
      runIcon.classList.remove('disabled');
    }
  });

  clearBtn?.addEventListener('click', () => { outputEl.textContent = ''; });
  guideIcon?.addEventListener('click', () => { sidebar?.classList.toggle('hidden'); });

  if (resizer && sidebar) {
    let resizing = false;
    resizer.addEventListener('mousedown', () => { resizing = true; document.body.classList.add('resizing'); });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const min = 200, max = 560;
      const w = Math.min(max, Math.max(min, e.clientX));
      sidebar.style.width = `${w}px`;
    });
    window.addEventListener('mouseup', () => { resizing = false; document.body.classList.remove('resizing'); });
  }

  render(); setStatus('Ready');
});
