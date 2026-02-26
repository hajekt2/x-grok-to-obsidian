(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  if (!location.href.includes('/i/grok')) {
    console.log('Open https://x.com/i/grok first.');
    return;
  }

  // v8-style aggressive history loading
  const INDEX_PASSES = 8;
  const SCROLL_MAX = 340;
  const STABLE_TARGET = 24;

  // v11-style endpoint capture storage
  const captured = new Map(); // restId -> {requestUrl, source, data}
  const seenUrls = new Set();

  const parseRestIdFromUrl = (u) => {
    try {
      const url = new URL(u, location.origin);
      const vars = url.searchParams.get('variables');
      if (vars) {
        const obj = JSON.parse(decodeURIComponent(vars));
        if (obj?.restId) return String(obj.restId);
      }
    } catch {}
    const m = String(u).match(/restId%22%3A%22(\d+)/);
    return m ? m[1] : null;
  };

  const maybeStore = (reqUrl, data, source) => {
    const url = String(reqUrl || '');
    if (!url.includes('/GrokConversationItemsByRestId')) return;
    const restId = parseRestIdFromUrl(url) || data?.data?.grok_conversation_by_rest_id?.rest_id || null;
    if (!restId) return;
    if (!captured.has(restId)) {
      captured.set(restId, { restId, requestUrl: url, source, data });
      console.log('[capture]', restId, source);
    }
  };

  // --- intercept fetch
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const reqUrl = String(args[0]?.url || args[0] || '');
    const res = await origFetch(...args);
    try {
      if (reqUrl.includes('/GrokConversationItemsByRestId') && !seenUrls.has(reqUrl)) {
        seenUrls.add(reqUrl);
        const j = await res.clone().json();
        maybeStore(reqUrl, j, 'fetch');
      }
    } catch {}
    return res;
  };

  // --- intercept XHR
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__u = url;
    return XO.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const u = String(this.__u || '');
        if (!u.includes('/GrokConversationItemsByRestId')) return;
        if (seenUrls.has(u)) return;
        seenUrls.add(u);
        const j = JSON.parse(this.responseText);
        maybeStore(u, j, 'xhr');
      } catch {}
    });
    return XS.apply(this, args);
  };

  const openHistory = () => {
    const b = [...document.querySelectorAll('button')].find(x =>
      /chat history/i.test(x.getAttribute('aria-label') || '') ||
      /history/i.test((x.textContent || '').trim())
    );
    if (b) b.click();
  };

  const getScroller = () => {
    const scrollers = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 250);
    scrollers.sort((a,b)=> (b.clientHeight*b.clientWidth) - (a.clientHeight*a.clientWidth));
    return scrollers[0] || document.scrollingElement || document.body;
  };

  const collectIndex = () => {
    const map = new Map();
    for (const a of document.querySelectorAll('a[href*="/i/grok?conversation="]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/conversation=(\d+)/);
      if (!m) continue;
      const id = m[1];
      const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
      const url = href.startsWith('http') ? href : `https://x.com${href}`;
      if (!map.has(id) || title.length > (map.get(id).title || '').length) {
        map.set(id, { id, title, URL: url });
      }
    }
    return [...map.values()].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  };

  // -------- PHASE 1: v8-style multi-pass union indexing --------
  const union = new Map();
  const passStats = [];

  for (let pass = 1; pass <= INDEX_PASSES; pass++) {
    openHistory();
    await sleep(1400);

    let prev = -1;
    let stable = 0;

    for (let i = 0; i < SCROLL_MAX && stable < STABLE_TARGET; i++) {
      const s = getScroller();
      s.scrollTop = s.scrollHeight;
      await sleep(280);

      const nowList = collectIndex();
      nowList.forEach(c => union.set(c.id, c));

      const now = union.size;
      if (now === prev) stable++; else stable = 0;
      prev = now;

      if (i % 50 === 0) await sleep(700);
    }

    passStats.push({ pass, union_count: union.size });
    console.log(`index pass ${pass}/${INDEX_PASSES}: union=${union.size}`);

    // panel toggle to force redraw/reload behavior
    openHistory(); await sleep(700);
    openHistory(); await sleep(900);
  }

  const targets = [...union.values()].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  console.log('Final indexed targets:', targets.length);

  // -------- PHASE 2: click-through capture with retry passes --------
  for (let pass = 1; pass <= 3; pass++) {
    console.log(`capture pass ${pass}/3`);

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (captured.has(t.id)) continue;

      openHistory();
      await sleep(500);

      let link = [...document.querySelectorAll('a[href*="/i/grok?conversation="]')]
        .find(a => (a.getAttribute('href') || '').includes(t.id));

      if (!link) {
        // one mini reload cycle in history list
        for (let j = 0; j < 60; j++) {
          const s = getScroller();
          s.scrollTop = s.scrollHeight;
          await sleep(180);
        }
        link = [...document.querySelectorAll('a[href*="/i/grok?conversation="]')]
          .find(a => (a.getAttribute('href') || '').includes(t.id));
      }

      if (!link) continue;

      link.click();
      await sleep(1500);

      // Intentionally skip Thoughts interaction to avoid dialog-related stalls.

      if ((i + 1) % 50 === 0) {
        console.log(`processed ${i + 1}/${targets.length}, captured=${captured.size}`);
      }
    }
  }

  // -------- PHASE 3: normalize from captured endpoint payload --------
  const conversations = [];

  for (const t of targets) {
    const cap = captured.get(t.id);
    if (!cap) {
      conversations.push({ id: t.id, title: t.title, URL: t.URL, error: 'not_captured' });
      continue;
    }

    const items = cap?.data?.data?.grok_conversation_items_by_rest_id?.items || [];

    const normalizedItems = items.map(it => ({
      chat_item_id: it.chat_item_id,
      sender_type: it.sender_type,
      created_at_ms: it.created_at_ms,
      message: it.message || '',
      thinking_trace: it.thinking_trace || '',
      deepsearch_headers: it.deepsearch_headers || [],
      cited_web_results: it.cited_web_results || [],
      web_results: it.web_results || [],
      is_partial: !!it.is_partial,
      grok_mode: it.grok_mode || null,
    }));

    conversations.push({
      id: t.id,
      title: t.title,
      URL: t.URL,
      source_request_url: cap.requestUrl,
      item_count: normalizedItems.length,
      items: normalizedItems,
    });
  }

  const out = {
    summary: {
      exported_at: new Date().toISOString(),
      index_passes: INDEX_PASSES,
      capture_passes: 3,
      indexed_total: targets.length,
      captured_conversations: captured.size,
      missing_conversations: targets.length - captured.size,
      index_pass_stats: passStats,
    },
    conversations,
  };

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grok-network-v13-v8history-${Date.now()}.json`;
  a.click();

  console.log('DONE', out.summary);
})();
