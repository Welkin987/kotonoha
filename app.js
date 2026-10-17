(() => {
  'use strict';

  const DATA = window.VOCAB_DATA;
  const app = document.getElementById('app');
  const AUDIO_BASE = './audio/ja-JP-NanamiNeural/';
  const audio = new Audio();
  audio.preload = 'auto';
  const STORAGE = 'jisho-tts-v1';
  const state = {
    lesson: null,
    currentIndex: null,
    playing: false,
    paused: false,
    sequence: false,
    repeatDone: 0,
    gapTimer: null,
    pendingAfterGap: null,
    token: 0,
    deferredInstall: null,
    wakeLock: null,
    settings: {
      repeat: 1,
      gap: 300,
      rate: 1,
      keepAwake: true,
      autoScroll: true
    },
    last: { lesson: 1, index: 0 }
  };

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      if (saved.settings) Object.assign(state.settings, saved.settings);
      if (saved.last) Object.assign(state.last, saved.last);
    } catch (_) {}
    if (![100, 300, 700, 1000, 1500].includes(state.settings.gap)) state.settings.gap = 300;
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({settings: state.settings, last: state.last}));
    } catch (_) {}
  }

  function esc(s='') {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function lessonByNo(n) { return DATA.lessons.find(x => x.lesson === Number(n)); }
  function fmtIndex(i) { return String(i + 1).padStart(3, '0'); }
  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }

  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'), 1800);
  }

  function audioPath(word) {
    return `${AUDIO_BASE}${String(word.id).slice(0, 2)}/${word.id}.mp3`;
  }

  async function requestWakeLock() {
    if (!state.settings.keepAwake || !state.playing || state.paused || state.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    const token = state.token;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (token !== state.token || !state.playing || state.paused || !state.settings.keepAwake || state.wakeLock) { await lock.release(); return; }
      state.wakeLock = lock;
      lock.addEventListener('release', () => { if (state.wakeLock === lock) state.wakeLock = null; });
    } catch (_) {}
  }
  async function releaseWakeLock() {
    const lock = state.wakeLock;
    state.wakeLock = null;
    try { if (lock) await lock.release(); } catch (_) {}
  }

  function clearGap() {
    if (state.gapTimer) clearTimeout(state.gapTimer);
    state.gapTimer = null;
  }

  function stopPlayback({keepHighlight=false} = {}) {
    state.token++;
    clearGap();
    state.pendingAfterGap = null;
    state.playing = false;
    state.paused = false;
    state.sequence = false;
    state.repeatDone = 0;
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    audio.removeAttribute('src');
    audio.load();
    releaseWakeLock();
    updatePlaybackButtons();
    if (!keepHighlight) setHighlight(null);
  }

  function speakSingle(index) {
    const lesson = lessonByNo(state.lesson);
    if (!lesson || !lesson.words[index]) return;
    stopPlayback({keepHighlight:true});
    const token = ++state.token;
    state.currentIndex = index;
    state.playing = true;
    state.last = {lesson: state.lesson, index}; savePrefs();
    updatePlaybackButtons();
    requestWakeLock();
    setHighlight(index);
    playWordAudio(lesson.words[index], token, () => stopPlayback());
  }

  function playbackFailed(token, message) {
    if (token !== state.token) return;
    stopPlayback();
    toast(message);
  }

  function playWordAudio(word, token, onEnd) {
    audio.onended = () => { if (token === state.token) onEnd?.(); };
    audio.onerror = () => {
      if (token !== state.token) return;
      playbackFailed(token, `音频加载失败：${word.id}，请联网后重试`);
    };
    audio.src = audioPath(word);
    audio.currentTime = 0;
    audio.playbackRate = Number(state.settings.rate) || 1;
    const promise = audio.play();
    if (promise?.catch) promise.catch(error => {
      if (error.name !== 'AbortError' && !state.paused) playbackFailed(token, '播放失败，请点击单词重试');
    });
  }

  function scheduleAfterGap(action) {
    state.pendingAfterGap = action;
    if (state.paused) return;
    clearGap();
    state.gapTimer = setTimeout(() => {
      state.gapTimer = null;
      const fn = state.pendingAfterGap;
      state.pendingAfterGap = null;
      if (state.playing && !state.paused && fn) fn();
    }, Number(state.settings.gap) || 0);
  }

  function speakSequenceCurrent(token) {
    if (!state.playing || state.paused || token !== state.token) return;
    const lesson = lessonByNo(state.lesson);
    if (!lesson || state.currentIndex == null || state.currentIndex >= lesson.words.length) { stopPlayback(); toast('本课播放完成'); return; }
    const w = lesson.words[state.currentIndex];
    state.last = {lesson: state.lesson, index: state.currentIndex}; savePrefs();
    setHighlight(state.currentIndex, true);
    playWordAudio(w, token, () => {
      if (!state.playing || token !== state.token) return;
      const targetRepeat = Math.max(1, Number(state.settings.repeat) || 1);
      if (state.repeatDone + 1 < targetRepeat) {
        state.repeatDone++;
        scheduleAfterGap(() => speakSequenceCurrent(token));
      } else {
        state.repeatDone = 0;
        if (state.currentIndex + 1 >= lesson.words.length) {
          stopPlayback();
          state.currentIndex = lesson.words.length - 1;
          setHighlight(state.currentIndex);
          toast('本课播放完成');
        } else {
          state.currentIndex++;
          scheduleAfterGap(() => speakSequenceCurrent(token));
        }
      }
    });
  }

  function startSequence(index=0) {
    const lesson = lessonByNo(state.lesson);
    if (!lesson || !lesson.words[index]) return;
    stopPlayback({keepHighlight:true});
    state.token++;
    const token = state.token;
    state.currentIndex = index;
    state.playing = true;
    state.paused = false;
    state.sequence = true;
    state.repeatDone = 0;
    updatePlaybackButtons();
    requestWakeLock();
    speakSequenceCurrent(token);
  }

  function togglePause() {
    if (!state.playing) return;
    if (!state.paused) {
      state.paused = true;
      if (state.gapTimer) { clearTimeout(state.gapTimer); state.gapTimer = null; }
      audio.pause();
      releaseWakeLock();
    } else {
      state.paused = false;
      if (state.pendingAfterGap) scheduleAfterGap(state.pendingAfterGap);
      else {
        const token = state.token;
        audio.play().catch(error => { if (error.name !== 'AbortError') playbackFailed(token, '播放失败，请点击单词重试'); });
      }
      requestWakeLock();
    }
    updatePlaybackButtons();
  }

  function setHighlight(index, scroll=false) {
    document.querySelectorAll('.word-row.playing').forEach(el => el.classList.remove('playing'));
    if (index == null) return;
    const el = document.querySelector(`.word-row[data-index="${index}"]`);
    if (el) {
      el.classList.add('playing');
      if (scroll && state.settings.autoScroll) el.scrollIntoView({block:'center',behavior:'smooth'});
    }
  }

  function updatePlaybackButtons() {
    const pause = document.getElementById('pauseBtn');
    const stop = document.getElementById('stopBtn');
    if (pause) { pause.disabled = !state.playing; pause.textContent = state.paused ? '▶ 继续' : '⏸ 暂停'; }
    if (stop) stop.disabled = !state.playing && audio.paused;
  }

  let meaningPopover = null;
  let meaningAnchor = null;
  let meaningIndex = null;

  function closeMeaning() {
    if (!meaningPopover) return;
    meaningPopover.classList.remove('show');
    meaningPopover.setAttribute('aria-hidden', 'true');
    meaningAnchor?.setAttribute('aria-expanded', 'false');
    meaningAnchor = null;
    meaningIndex = null;
  }

  function positionMeaning() {
    if (!meaningPopover || !meaningAnchor || !meaningPopover.classList.contains('show')) return;
    const anchor = meaningAnchor.getBoundingClientRect();
    const box = meaningPopover.getBoundingClientRect();
    const margin = 8;
    let left = anchor.right - box.width;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = anchor.bottom + 6;
    if (top + box.height > window.innerHeight - margin) top = anchor.top - box.height - 6;
    top = Math.max(margin, top);
    meaningPopover.style.left = `${Math.round(left)}px`;
    meaningPopover.style.top = `${Math.round(top)}px`;
  }

  function toggleMeaning(index, anchor) {
    const lesson = lessonByNo(state.lesson);
    const word = lesson?.words[index];
    if (!word || !anchor) return;

    if (!meaningPopover) {
      meaningPopover = document.createElement('div');
      meaningPopover.className = 'meaning-popover';
      meaningPopover.setAttribute('role', 'status');
      meaningPopover.setAttribute('aria-hidden', 'true');
      document.body.appendChild(meaningPopover);
    }

    if (meaningIndex === index && meaningPopover.classList.contains('show')) {
      closeMeaning();
      return;
    }

    meaningAnchor?.setAttribute('aria-expanded', 'false');
    meaningAnchor = anchor;
    meaningIndex = index;
    meaningPopover.textContent = word.meaning || '暂无释义';
    meaningPopover.classList.add('show');
    meaningPopover.setAttribute('aria-hidden', 'false');
    meaningAnchor.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(positionMeaning);
  }

  function homeHTML() {
    const lastLesson = lessonByNo(state.last.lesson) || DATA.lessons[0];
    const lastWord = lastLesson.words[Math.min(state.last.index || 0, lastLesson.words.length - 1)];
    const lessonCards = DATA.lessons.map(l => `
      <button class="lesson-card" data-open-lesson="${l.lesson}">
        <div class="num">第 ${String(l.lesson).padStart(2,'0')} 课</div>
        <div class="ltitle">${esc(l.title)}</div>
        <div class="count">${l.words.length} 条</div>
      </button>`).join('');
    return `<div class="shell">
      <div class="topbar"><img class="brand-icon" src="./icons/icon.svg" alt="" width="32" height="32"><div class="title">ことのは · 标日听读</div><div class="spacer"></div><button id="installBtn" class="small" hidden>安装</button></div>
      <main class="content">
        <section class="hero">
          <h1>标准日本语 · 初级上册</h1>
          <p>点词听音，按需查看释义。支持整课连读，也可以从任意单词开始。</p>
          <div class="statusline"><span class="dot ok"></span><span>24 课 · 1,079 个词条</span><span>·</span><span id="offlineStatus">${navigator.onLine?'在线':'离线'}</span></div>
        </section>
        <div class="continue-card">
          <div class="meta"><strong>继续上次位置</strong><span>第 ${lastLesson.lesson} 课 · ${esc(lastWord?.word || '')} · ${fmtIndex(state.last.index || 0)}</span></div>
          <button class="primary" data-continue>继续</button>
        </div>
        <div class="section-title">课程</div>
        <div class="lesson-grid">${lessonCards}</div>
      </main>
      <div class="footer-note">中文释义默认隐藏。已播放的音频会缓存到本机，首次听读请保持联网。</div>
    </div>`;
  }

  function lessonHTML(lesson) {
    const words = lesson.words.map((w,i) => `
      <article class="word-row" data-index="${i}">
        <div class="word-index">${fmtIndex(i)}</div>
        <button class="word-main" data-speak="${i}" aria-label="朗读 ${esc(w.word)}">
          <span class="word" lang="ja" title="${esc(w.word)}">${esc(w.word)}</span>
          <span class="reading" lang="ja">${esc(w.reading || '')}</span>
        </button>
        <div class="word-actions">
          <button class="small" data-start="${i}" title="从这里连续播放">▶ 从此</button>
          <button class="small" data-meaning-btn="${i}" aria-expanded="false" title="查看中文释义">释义</button>
        </div>
      </article>`).join('');
    return `<div class="shell">
      <div class="topbar"><button class="small ghost" data-home>← 返回</button><div class="title">第 ${lesson.lesson} 课 · ${esc(lesson.title)}</div><div class="spacer"></div></div>
      <div class="controls">
        <div class="control-row">
          <button id="playAllBtn" class="primary">▶ 从头播放</button>
          <button id="pauseBtn" disabled>⏸ 暂停</button>
          <button id="stopBtn" disabled>■ 停止</button>
          <div class="grow"></div>
        </div>
      </div>
      <div class="lesson-head"><h1>第 ${String(lesson.lesson).padStart(2,'0')} 课</h1><div class="sub">${esc(lesson.title)} · ${lesson.words.length} 条</div></div>
      <details class="settings">
        <summary>播放设置</summary>
        <div class="settings-body">
          <div class="field"><label for="repeatSelect">每个词重复</label><select id="repeatSelect"><option value="1">1 遍</option><option value="2">2 遍</option><option value="3">3 遍</option></select></div>
          <div class="field"><label for="gapSelect">词间停顿</label><select id="gapSelect"><option value="100">0.1 秒</option><option value="300">0.3 秒</option><option value="700">0.7 秒</option><option value="1000">1 秒</option><option value="1500">1.5 秒</option></select></div>
          <div class="field"><label for="rateSelect">朗读速度</label><select id="rateSelect"><option value="0.75">0.75×</option><option value="0.85">0.85×</option><option value="0.92">0.92×</option><option value="1">1.0×</option><option value="1.1">1.1×</option><option value="1.2">1.2×</option></select></div>
          <div class="field"><span class="field-label">朗读声音</span><div class="audio-note">日语女声 · Nanami</div></div>
          <label class="toggle"><input id="wakeToggle" type="checkbox">播放时保持屏幕常亮</label>
          <label class="toggle"><input id="scrollToggle" type="checkbox">连续播放时自动滚动</label>
        </div>
      </details>
      <div class="word-list">${words}</div>
      <div class="footer-note">点击词条主体：单独朗读一次。点击“从此”：从该词开始读到本课结束。点击“释义”：悬浮查看中文，不占用词条高度。进度与播放设置会保存在本机。</div>
    </div>`;
  }

  const topbarObserver = new ResizeObserver(entries => {
    document.documentElement.style.setProperty('--topbar-height', `${entries[0].target.getBoundingClientRect().height}px`);
  });

  function observeTopbar() {
    topbarObserver.disconnect();
    topbarObserver.observe(document.querySelector('.topbar'));
  }

  function bindHome() {
    observeTopbar();
    document.querySelectorAll('[data-open-lesson]').forEach(btn => btn.addEventListener('click', () => openLesson(Number(btn.dataset.openLesson))));
    document.querySelector('[data-continue]')?.addEventListener('click', () => { openLesson(state.last.lesson); setTimeout(()=>setHighlight(state.last.index,true), 40); });
    const install = document.getElementById('installBtn');
    if (install) {
      install.hidden = !state.deferredInstall || isStandalone();
      install.addEventListener('click', async () => {
        if (!state.deferredInstall) { toast('请使用浏览器菜单中的“安装应用/添加到主屏幕”'); return; }
        state.deferredInstall.prompt();
        try { await state.deferredInstall.userChoice; } catch (_) {}
        state.deferredInstall = null; install.hidden = true;
      });
    }
    refreshHomeStatus();
  }

  function refreshHomeStatus() {
    const o = document.getElementById('offlineStatus'); if (o) o.textContent = navigator.onLine ? '在线' : '离线';
  }

  function bindLesson() {
    observeTopbar();
    document.querySelector('[data-home]')?.addEventListener('click', goHome);
    document.getElementById('playAllBtn')?.addEventListener('click', () => startSequence(0));
    document.getElementById('pauseBtn')?.addEventListener('click', togglePause);
    document.getElementById('stopBtn')?.addEventListener('click', () => stopPlayback());
    document.querySelectorAll('[data-speak]').forEach(el => el.addEventListener('click', () => speakSingle(Number(el.dataset.speak))));
    document.querySelectorAll('[data-start]').forEach(el => el.addEventListener('click', () => startSequence(Number(el.dataset.start))));
    document.querySelectorAll('[data-meaning-btn]').forEach(el => el.addEventListener('click', () => toggleMeaning(Number(el.dataset.meaningBtn), el)));

    const repeat = document.getElementById('repeatSelect'); repeat.value=String(state.settings.repeat); repeat.addEventListener('change',()=>{state.settings.repeat=Number(repeat.value);savePrefs();});
    const gap = document.getElementById('gapSelect'); gap.value=String(state.settings.gap); gap.addEventListener('change',()=>{state.settings.gap=Number(gap.value);savePrefs();});
    const rate = document.getElementById('rateSelect'); rate.value=String(state.settings.rate); rate.addEventListener('change',()=>{state.settings.rate=Number(rate.value); audio.playbackRate=state.settings.rate; savePrefs();});
    const wake = document.getElementById('wakeToggle'); wake.checked=!!state.settings.keepAwake; wake.disabled=!('wakeLock' in navigator); wake.addEventListener('change',()=>{state.settings.keepAwake=wake.checked;savePrefs(); if(!wake.checked)releaseWakeLock(); else requestWakeLock();});
    const scroll = document.getElementById('scrollToggle'); scroll.checked=!!state.settings.autoScroll; scroll.addEventListener('change',()=>{state.settings.autoScroll=scroll.checked;savePrefs();});
    updatePlaybackButtons();
  }

  function openLesson(no) {
    closeMeaning();
    stopPlayback();
    const lesson = lessonByNo(no); if (!lesson) return;
    state.lesson = lesson.lesson;
    history.replaceState(null,'',`#lesson-${lesson.lesson}`);
    app.innerHTML = lessonHTML(lesson);
    bindLesson();
    window.scrollTo({top:0});
  }

  function goHome() {
    closeMeaning();
    stopPlayback(); state.lesson = null; history.replaceState(null,'',location.pathname + location.search);
    app.innerHTML = homeHTML(); bindHome(); window.scrollTo({top:0});
  }

  function routeInitial() {
    const m = location.hash.match(/^#lesson-(\d+)$/);
    if (m && lessonByNo(Number(m[1]))) openLesson(Number(m[1])); else goHome();
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); state.deferredInstall = e;
    const btn=document.getElementById('installBtn'); if(btn && !isStandalone()) btn.hidden=false;
  });
  window.addEventListener('appinstalled',()=>{state.deferredInstall=null;toast('已安装到桌面');});
  window.addEventListener('online',refreshHomeStatus); window.addEventListener('offline',refreshHomeStatus);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-meaning-btn], .meaning-popover')) return;
    closeMeaning();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMeaning(); });
  window.addEventListener('scroll', closeMeaning, true);
  window.addEventListener('resize', closeMeaning);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && state.playing)requestWakeLock(); });
  window.addEventListener('pagehide',()=>stopPlayback());
  window.addEventListener('hashchange', routeInitial);

  loadPrefs();
  routeInitial();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
})();
