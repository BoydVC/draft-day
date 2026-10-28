(function () {
  const params = new URLSearchParams(location.search);
  const t = Math.max(0, parseInt(params.get('t') || '0', 10) || 0);
  // 16 phases @ ~0.5s = 8s loop. Also support live mode without ?t=
  const LIVE = !params.has('t');

  const $ = (id) => document.getElementById(id);

  function setBilling(pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    $('billing-bar').style.width = pct + '%';
    $('billing-label').textContent = pct >= 100 ? 'spec ready · 14 acceptance checks' : `drafting · ${pct}%`;
  }

  function setCand(letter, score, meta, running) {
    const sEl = $('score-' + letter);
    const bEl = $('bar-' + letter);
    const mEl = $('meta-' + letter);
    const card = $('cand-' + letter);
    score = Math.max(0, Math.min(100, Math.round(score)));
    if (running) {
      sEl.textContent = '…';
      sEl.className = 'score blue';
      card.classList.add('running');
    } else {
      sEl.textContent = String(score);
      sEl.className = 'score ' + (score >= 85 ? 'green' : score >= 60 ? 'yellow' : 'red');
      card.classList.remove('running');
    }
    bEl.style.width = score + '%';
    bEl.className = 'fill ' + (running ? 'blue' : score >= 85 ? 'green' : score >= 60 ? 'yellow' : 'red');
    mEl.textContent = meta;
  }

  function clearWinners() {
    ['a','b','c','d'].forEach((L) => {
      const c = $('cand-' + L);
      c.classList.remove('winner', 'dim');
    });
  }

  function applyPhase(p) {
    document.getElementById('app').dataset.phase = String(p);
    const newIdea = $('idea-new');
    const webhook = $('spec-webhook');
    const newBtn = document.querySelector('.new-idea');
    const ideasCount = $('ideas-count');
    const specsCount = $('specs-count');
    const pr418 = $('pr-418');
    const pr418meta = $('pr-418-meta');

    // defaults / reset-ish
    newIdea.hidden = true;
    newIdea.classList.remove('entering', 'leaving', 'moving-out');
    webhook.hidden = true;
    newBtn.classList.remove('flash');
    clearWinners();
    ideasCount.textContent = '4';
    specsCount.textContent = '3';
    pr418.classList.remove('verified');
    pr418meta.innerHTML = '<span class="status pending">draft · CI running</span>';
    $('m-shipped').textContent = '11';
    $('m-avg').textContent = '47 min';
    $('m-win').textContent = '+38%';
    $('m-checks').textContent = '96%';
    $('agents-live').textContent = '6';

    // Timeline (~8s):
    // 0-1: idle baseline (billing mid, D running low, PR pending)
    // 2: New Idea button flash
    // 3: new idea card appears in Ideas
    // 4: idea starts leaving / moving to Spec
    // 5: webhook arrives in Specs; billing continues
    // 6-8: billing fills; arena scores tick; D rises
    // 9: D finishes; A pulls ahead
    // 10-11: A wins highlight; others dim
    // 12-13: PR #418 flips verified · CI green
    // 14-15: footer metrics tick up slightly; hold

    if (p <= 1) {
      setBilling(28 + p * 8);
      setCand('a', 78 + p * 2, `${12 + p}/14 checks · 280 lines`);
      setCand('b', 68 + p, `${10 + p}/14 checks · 480 lines`);
      setCand('c', 35 + p, 'tests failing');
      setCand('d', 18 + p * 6, `running · ${p}m`, true);
    } else if (p === 2) {
      setBilling(44);
      setCand('a', 82, '12/14 checks · 290 lines');
      setCand('b', 70, '11/14 checks · 500 lines');
      setCand('c', 38, 'tests failing');
      setCand('d', 30, 'running · 1m', true);
      newBtn.classList.add('flash');
    } else if (p === 3) {
      setBilling(52);
      setCand('a', 84, '13/14 checks · 300 lines');
      setCand('b', 72, '11/14 checks · 510 lines');
      setCand('c', 39, 'tests failing');
      setCand('d', 38, 'running · 2m', true);
      newIdea.hidden = false;
      newIdea.classList.add('entering');
      ideasCount.textContent = '5';
    } else if (p === 4) {
      setBilling(58);
      setCand('a', 86, '13/14 checks · 305 lines');
      setCand('b', 74, '12/14 checks · 520 lines');
      setCand('c', 40, 'tests failing');
      setCand('d', 48, 'running · 2m', true);
      newIdea.hidden = false;
      newIdea.classList.add('leaving');
      ideasCount.textContent = '5';
    } else if (p === 5) {
      setBilling(61);
      setCand('a', 88, '13/14 checks · 308 lines');
      setCand('b', 75, '12/14 checks · 525 lines');
      setCand('c', 40, 'tests failing');
      setCand('d', 55, 'running · 3m', true);
      newIdea.hidden = true;
      ideasCount.textContent = '4';
      webhook.hidden = false;
      specsCount.textContent = '4';
    } else if (p === 6) {
      setBilling(72);
      setCand('a', 89, '14/14 checks · 310 lines');
      setCand('b', 76, '12/14 checks · 530 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 62, 'running · 3m', true);
      webhook.hidden = false;
      specsCount.textContent = '4';
    } else if (p === 7) {
      setBilling(84);
      setCand('a', 90, '14/14 checks · 311 lines');
      setCand('b', 77, '12/14 checks · 535 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 74, 'running · 4m', false);
      $('score-d').textContent = '74';
      $('score-d').className = 'score yellow';
      webhook.hidden = false;
      specsCount.textContent = '4';
    } else if (p === 8) {
      setBilling(93);
      setCand('a', 91, '14/14 checks · 312 lines');
      setCand('b', 78, '12/14 checks · 540 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 81, '13/14 checks · 298 lines', false);
      webhook.hidden = false;
      specsCount.textContent = '4';
    } else if (p === 9) {
      setBilling(100);
      setCand('a', 92, '14/14 checks · 312 lines');
      setCand('b', 78, '12/14 checks · 540 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 86, '14/14 checks · 301 lines', false);
      webhook.hidden = false;
      specsCount.textContent = '4';
      $('agents-live').textContent = '6';
    } else if (p === 10 || p === 11) {
      setBilling(100);
      setCand('a', 92, '14/14 checks · 312 lines');
      setCand('b', 78, '12/14 checks · 540 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 86, '14/14 checks · 301 lines', false);
      webhook.hidden = false;
      specsCount.textContent = '4';
      $('cand-a').classList.add('winner');
      ['b','c','d'].forEach((L) => $('cand-' + L).classList.add('dim'));
      pr418meta.innerHTML = '<span class="status pending">draft · CI running</span>';
    } else if (p === 12 || p === 13) {
      setBilling(100);
      setCand('a', 92, '14/14 checks · 312 lines');
      setCand('b', 78, '12/14 checks · 540 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 86, '14/14 checks · 301 lines', false);
      webhook.hidden = false;
      specsCount.textContent = '4';
      $('cand-a').classList.add('winner');
      ['b','c','d'].forEach((L) => $('cand-' + L).classList.add('dim'));
      pr418.classList.add('verified');
      pr418meta.innerHTML = '<span class="status ok">verified · CI green</span>';
    } else {
      // 14+ hold / metrics tick
      setBilling(100);
      setCand('a', 92, '14/14 checks · 312 lines');
      setCand('b', 78, '12/14 checks · 540 lines');
      setCand('c', 41, 'tests failing');
      setCand('d', 86, '14/14 checks · 301 lines', false);
      webhook.hidden = false;
      specsCount.textContent = '4';
      $('cand-a').classList.add('winner');
      ['b','c','d'].forEach((L) => $('cand-' + L).classList.add('dim'));
      pr418.classList.add('verified');
      pr418meta.innerHTML = '<span class="status ok">verified · CI green</span>';
      $('m-shipped').textContent = '12';
      $('m-avg').textContent = '46 min';
      $('m-win').textContent = '+39%';
      $('m-checks').textContent = '97%';
    }
  }

  if (LIVE) {
    let p = 0;
    applyPhase(0);
    setInterval(() => {
      p = (p + 1) % 16;
      applyPhase(p);
    }, 500);
  } else {
    applyPhase(t);
  }
})();
