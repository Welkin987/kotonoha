(() => {
  'use strict';

  const DATA = window.VOCAB_DATA;
  const app = document.getElementById('app');
  const AUDIO_BASE = './audio/ja-JP-NanamiNeural/';
  const TEXT_AUDIO_BASE = './audio/lessons/minimax-hd/';
  const audio = new Audio();
  audio.preload = 'auto';
  const STORAGE = 'jisho-tts-v1';
  const TEXT_RATES = [0.75, 0.85, 0.92, 1, 1.1, 1.2, 1.35, 1.5];
  const TEXT_GAPS = [100, 300, 700, 1000, 1500];
  const TEXT_MODES = { loop: '单课循环', next: '自动播下一课' };
  let textCatalog;
  let routeVersion = 0;
  const state = {
    lesson: null,
    textLesson: null,
    textIndex: 0,
    textLast: null,
    textSettings: { rate: 1, gap: 300, mode: 'loop' },
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
      if (saved.textLast) state.textLast = saved.textLast;
      if (saved.textSettings) {
        const { rate, gap, mode } = saved.textSettings;
        if (TEXT_RATES.includes(rate)) state.textSettings.rate = rate;
        if (TEXT_GAPS.includes(gap)) state.textSettings.gap = gap;
        if (Object.hasOwn(TEXT_MODES, mode)) state.textSettings.mode = mode;
      }
    } catch (_) {}
    if (![100, 300, 700, 1000, 1500].includes(state.settings.gap)) state.settings.gap = 300;
  }

  function savePrefs() {
    try {
      const { settings, last, textSettings, textLast } = state;
      localStorage.setItem(STORAGE, JSON.stringify({ settings, last, textSettings, textLast }));
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
    playAudio(audioPath(word), word.id, state.settings.rate, token, onEnd);
  }

  function playAudio(path, id, rate, token, onEnd) {
    audio.onended = () => { if (token === state.token) onEnd?.(); };
    audio.onerror = () => {
      if (token !== state.token) return;
      playbackFailed(token, `音频加载失败：${id}，请重试`);
    };
    audio.src = path;
    audio.currentTime = 0;
    audio.playbackRate = Number(rate) || 1;
    const promise = audio.play();
    if (promise?.catch) promise.catch(error => {
      if (error.name !== 'AbortError' && !state.paused) playbackFailed(token, '播放失败，请点击重试');
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
    }, state.textLesson ? state.textSettings.gap : Number(state.settings.gap) || 0);
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
        audio.play().catch(error => { if (error.name !== 'AbortError') playbackFailed(token, '播放失败，请点击重试'); });
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
    if (state.textLesson) {
      updateTextPlayback();
      return;
    }
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
    const lessonCards = DATA.lessons.map(lesson =>
      lessonCard(lesson.lesson, lesson.title, '#lesson-' + lesson.lesson, lesson.words.length + ' 条')
    ).join('');
    return `<div class="shell">
      ${moduleBar('words')}
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

  function lessonCard(no, title, href, count = '') {
    return `<a class="lesson-card" href="${href}">
      <div class="num">第 ${String(no).padStart(2, '0')} 课</div>
      <div class="ltitle" lang="ja">${esc(title)}</div>
      ${count ? `<div class="count">${count}</div>` : ''}
    </a>`;
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
      ${moduleBar('words', lesson.lesson)}
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

  function moduleBar(mode, lesson = null) {
    const wordsActive = mode === 'words' ? 'aria-current="page"' : '';
    const textActive = mode === 'text' ? 'aria-current="page"' : '';
    return `<header class="topbar module-bar">
      <a class="brand-link" href="#words">
        <img class="brand-icon" src="./icons/icon.svg" alt="" width="32" height="32">
        <span class="title">ことのは <span class="brand-subtitle">· 标日听读</span></span>
      </a>
      <nav class="module-links" aria-label="学习模式">
        <a href="#words" ${wordsActive}>单词</a>
        <a href="#text" ${textActive}>课文</a>
      </nav>
      ${lesson && mode === 'words' ? '' : '<button id="installBtn" class="small" hidden>安装</button>'}
    </header>`;
  }

  const TEXT_SECTIONS = [
    ['title', null], ['classic_examples', '基本例句'],
    ['basic_lesson', '基础课文'], ['applied_lesson', '应用课文']
  ];

  function showTextCatalog() {
    const last = textCatalog.find(lesson => lesson.lesson === state.textLast?.lesson);
    const lessonCards = textCatalog.map(lesson =>
      lessonCard(lesson.lesson, lesson.basic_title, '#text-' + lesson.lesson)
    ).join('');
    app.innerHTML = `<div class="shell">
      ${moduleBar('text')}
      <main class="content">
        <section class="hero">
          <h1>标准日本语 · 初级上册</h1>
          <p>选择课文，逐句点读或从指定句子开始连播。</p>
          <div class="statusline"><span class="dot ok"></span><span>${textCatalog.length} 课</span><span>·</span><span id="offlineStatus"></span></div>
        </section>
        ${last ? `<div class="continue-card">
          <div class="meta"><strong>继续上次位置</strong><span>第 ${last.lesson} 课 · 第 ${state.textLast.index + 1} 句</span></div>
          <a class="primary" href="#text-resume">继续</a>
        </div>` : ''}
        <div class="section-title">课程</div>
        <div class="lesson-grid">${lessonCards}</div>
      </main>
      <div class="footer-note">已播放的音频会缓存到本机，首次听读请保持联网。</div>
    </div>`;
    bindHome();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  async function openTextRoute(selection, version) {
    closeMeaning();
    stopPlayback();
    state.lesson = null;
    state.textLesson = null;
    if (!textCatalog) {
      app.innerHTML = moduleBar('text') + '<p class="text-message" role="status">正在加载课文…</p>';
      observeTopbar();
      bindInstall();
      try {
        const response = await fetch('./assets/text_tts.json');
        if (!response.ok) throw new Error('课文加载失败');
        textCatalog = (await response.json()).lessons;
      } catch (_) {
        if (version !== routeVersion) return;
        app.innerHTML = moduleBar('text') + '<p class="text-message">课文加载失败。 <button id="retryText" class="small">重试</button></p>';
        observeTopbar();
        bindInstall();
        document.getElementById('retryText').addEventListener('click', routeInitial);
        return;
      }
    }
    if (version !== routeVersion) return;
    const resume = selection === 'resume';
    const no = resume ? state.textLast?.lesson : Number(selection);
    const lesson = textCatalog.find(item => item.lesson === no);
    if (lesson) {
      showTextLesson(lesson, resume);
    } else {
      history.replaceState(null, '', '#text');
      showTextCatalog();
    }
  }

  function textLineHTML(row, index) {
    const heading = row.type === 'title';
    if (row.voice === 'none') {
      return row.type === 'section'
        ? `<h3 class="text-group">${esc(row.display_text)}</h3>`
        : `<p class="text-note">${esc(row.display_text)}</p>`;
    }
    const text = `<span class="text-line-copy" lang="ja">${esc(row.display_text)}</span>`;
    const button = `<button type="button" class="text-line${heading ? ' text-line-title' : ''}" data-text-index="${index}">
      <span class="text-line-icon" aria-hidden="true">▶</span>${text}
    </button>`;
    return heading ? (row.id.endsWith('.applied.title') ? `<h3>${button}</h3>` : `<h1>${button}</h1>`) : button;
  }

  function textOptions(values, format) {
    return values.map(value => `<option value="${value}">${format(value)}</option>`).join('');
  }

  function showTextLesson(lesson, resume = false) {
    const openSettings = document.getElementById('textSettings')?.open;
    const entries = [];
    const sections = TEXT_SECTIONS.map(([key, label]) => {
      const lines = lesson[key].filter(row => !label || row.type !== 'section' || row.display_text !== label);
      const content = lines.map(row => {
        if (row.voice !== 'none') entries.push(row);
        return textLineHTML(row, entries.length - 1);
      }).join('');
      if (!label) return `<div class="text-heading"><p>${esc(lesson.unit_title)}</p>${content}</div>`;
      return `<section class="text-section"><h2>${label}</h2>${content}</section>`;
    }).join('');
    state.textLesson = { lesson: lesson.lesson, entries };
    const savedIndex = state.textLast?.lesson === lesson.lesson ? state.textLast.index : 0;
    state.textIndex = Number.isInteger(savedIndex) && entries[savedIndex] ? savedIndex : 0;
    state.textLast = { lesson: lesson.lesson, index: state.textIndex };
    savePrefs();
    history.replaceState(null, '', '#text-' + lesson.lesson);
    const chapterOptions = textCatalog.map(item => `<option value="${item.lesson}">
      第 ${String(item.lesson).padStart(2, '0')} 课 · ${esc(item.basic_title)}</option>`).join('');
    app.innerHTML = `<div class="shell text-shell">
      ${moduleBar('text', lesson.lesson)}
      <div class="controls text-controls">
        <div class="text-toolbar">
          <label class="text-picker" for="textChapter"><span>章节</span>
            <select id="textChapter">${chapterOptions}</select>
          </label>
          <div class="text-transport">
            <button id="textPlay" class="primary">▶ 连播</button>
            <button id="textStop" class="ghost" disabled>停止</button>
            <span id="textProgress" class="text-progress"></span>
          </div>
        </div>
      </div>
      <main class="text-content">
        <details id="textSettings" class="settings text-settings" ${openSettings ? 'open' : ''}>
          <summary>播放设置</summary>
          <div class="settings-body">
            <div class="field"><label for="textRate">朗读速度</label>
              <select id="textRate">${textOptions(TEXT_RATES, rate => rate + '×')}</select>
            </div>
            <div class="field"><label for="textGap">句间停顿</label>
              <select id="textGap">${textOptions(TEXT_GAPS, gap => gap / 1000 + ' 秒')}</select>
            </div>
            <div class="field"><label for="textMode">连播模式</label>
              <select id="textMode">${textOptions(Object.keys(TEXT_MODES), mode => TEXT_MODES[mode])}</select>
            </div>
          </div>
        </details>
        <article class="text-sheet">${sections}</article>
      </main>
    </div>`;
    observeTopbar();
    bindInstall();
    bindTextLesson();
    window.scrollTo({ top: 0, behavior: 'instant' });
    updateTextPlayback(resume);
  }

  function bindTextLesson() {
    const chapter = document.getElementById('textChapter');
    chapter.value = String(state.textLesson.lesson);
    chapter.addEventListener('change', () => {
      location.hash = 'text-' + chapter.value;
    });
    for (const [id, key] of [['textRate', 'rate'], ['textGap', 'gap'], ['textMode', 'mode']]) {
      const select = document.getElementById(id);
      select.value = String(state.textSettings[key]);
      select.addEventListener('change', () => {
        state.textSettings[key] = key === 'mode' ? select.value : Number(select.value);
        if (key === 'rate') audio.playbackRate = state.textSettings.rate;
        savePrefs();
      });
    }
    document.getElementById('textPlay').addEventListener('click', () => {
      if (state.playing && state.sequence) togglePause();
      else startTextPlayback(state.textIndex, true);
    });
    document.getElementById('textStop').addEventListener('click', () => stopPlayback());
    document.querySelector('.text-sheet').addEventListener('click', event => {
      const line = event.target.closest('[data-text-index]');
      if (line) startTextPlayback(Number(line.dataset.textIndex), state.sequence);
    });
  }

  function updateTextPlayback(scroll = false) {
    const play = document.getElementById('textPlay');
    if (!play) return;
    play.textContent = state.sequence ? (state.paused ? '▶ 继续' : '⏸ 暂停') : '▶ 连播';
    document.getElementById('textStop').disabled = !state.playing;
    document.getElementById('textProgress').textContent = `句 ${state.textIndex + 1} / ${state.textLesson.entries.length}`;
    document.querySelector('.text-line[aria-current]')?.removeAttribute('aria-current');
    const line = document.querySelector(`[data-text-index="${state.textIndex}"]`);
    if (!line) return;
    line.setAttribute('aria-current', 'true');
    if (scroll) {
      const box = line.getBoundingClientRect();
      const controls = document.querySelector('.text-controls').getBoundingClientRect();
      if (box.top < controls.bottom + 12 || box.bottom > window.innerHeight - 20) {
        line.scrollIntoView({ block: 'center' });
      }
    }
  }

  function startTextPlayback(index, continuous) {
    if (!state.textLesson?.entries[index]) return;
    stopPlayback();
    state.playing = true;
    state.sequence = continuous;
    requestWakeLock();
    playTextLine(index);
  }

  function playTextLine(index) {
    const { lesson, entries } = state.textLesson;
    const row = entries[index];
    state.textIndex = index;
    state.textLast = { lesson, index };
    savePrefs();
    updateTextPlayback(state.sequence);
    const path = TEXT_AUDIO_BASE + String(lesson).padStart(2, '0') + '/' + row.id + '.mp3';
    playAudio(path, row.id, state.textSettings.rate, state.token, () => {
      if (!state.sequence) {
        stopPlayback();
      } else if (index + 1 < entries.length) {
        scheduleAfterGap(() => playTextLine(index + 1));
      } else {
        scheduleAfterGap(continueAfterLesson);
      }
    });
  }

  function continueAfterLesson() {
    if (state.textSettings.mode === 'loop') {
      playTextLine(0);
      return;
    }
    const next = textCatalog[textCatalog.findIndex(item => item.lesson === state.textLesson.lesson) + 1];
    if (next) {
      showTextLesson(next);
      playTextLine(0);
    } else {
      stopPlayback();
      toast('已播放到最后一课');
    }
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
    document.querySelector('[data-continue]')?.addEventListener('click', () => { openLesson(state.last.lesson); setTimeout(()=>setHighlight(state.last.index,true), 40); });
    bindInstall();
    refreshHomeStatus();
  }

  function bindInstall() {
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
  }

  function refreshHomeStatus() {
    const o = document.getElementById('offlineStatus'); if (o) o.textContent = navigator.onLine ? '在线' : '离线';
  }

  function bindLesson() {
    observeTopbar();
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
    state.textLesson = null;
    const lesson = lessonByNo(no); if (!lesson) return;
    state.lesson = lesson.lesson;
    history.replaceState(null,'',`#lesson-${lesson.lesson}`);
    app.innerHTML = lessonHTML(lesson);
    bindLesson();
    window.scrollTo({top:0});
  }

  function goHome() {
    closeMeaning();
    stopPlayback(); state.lesson = null; state.textLesson = null;
    if (location.hash && location.hash !== '#words') history.replaceState(null, '', '#words');
    app.innerHTML = homeHTML(); bindHome(); window.scrollTo({top:0});
  }

  function routeInitial() {
    const version = ++routeVersion;
    const textRoute = location.hash.match(/^#text(?:-(\d+|resume))?$/);
    if (textRoute) {
      openTextRoute(textRoute[1], version);
      return;
    }
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
