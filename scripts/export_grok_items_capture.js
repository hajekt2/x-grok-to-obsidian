(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  if (!location.href.includes('/i/grok')) {
    console.log('Open https://x.com/i/grok first.');
    return;
  }

  const INDEX_PASSES = 8;
  const CAPTURE_PASSES = 3;

  const captured = new Map();
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

  // fetch/xhr intercept
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

  const closeThoughtsDialogIfOpen = () => {
    const closeBtn = [...document.querySelectorAll('button')].find(b =>
      /close/i.test((b.getAttribute('aria-label') || '')) ||
      /^close$/i.test((b.textContent || '').trim())
    );
    const hasThoughtsHeading = [...document.querySelectorAll('h1,h2,[role="heading"]')]
      .some(h => /thoughts/i.test((h.textContent || '').trim()));
    if (hasThoughtsHeading && closeBtn) {
      closeBtn.click();
      return true;
    }
    return false;
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
      const URL = href.startsWith('http') ? href : `https://x.com${href}`;
      if (!map.has(id) || title.length > (map.get(id).title || '').length) {
        map.set(id, { id, title, URL });
      }
    }
    return [...map.values()].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  };

  const scrollHistoryFully = async () => {
    let stable = 0, prev = -1;
    for (let i = 0; i < 340 && stable < 24; i++) {
      closeThoughtsDialogIfOpen();
      const s = getScroller();
      s.scrollTop = s.scrollHeight;
      await sleep(220);
      const c = collectIndex().length;
      if (c === prev) stable++; else stable = 0;
      prev = c;
      if (i % 60 === 0) await sleep(500);
    }
  };

  // Indexing
  const union = new Map();
  for (let pass = 1; pass <= INDEX_PASSES; pass++) {
    closeThoughtsDialogIfOpen();
    openHistory();
    await sleep(1200);
    await scrollHistoryFully();
    collectIndex().forEach(c => union.set(c.id, c));
    console.log(`index pass ${pass}/${INDEX_PASSES}: ${union.size}`);
    openHistory(); await sleep(600); openHistory(); await sleep(700);
  }

  const targets = [...union.values()].sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  console.log('targets', targets.length);

  // Capture (NO thoughts clicking)
  for (let pass = 1; pass <= CAPTURE_PASSES; pass++) {
    console.log(`capture pass ${pass}/${CAPTURE_PASSES}`);
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (captured.has(t.id)) continue;

      closeThoughtsDialogIfOpen();
      openHistory();
      await sleep(450);

      let link = [...document.querySelectorAll('a[href*="/i/grok?conversation="]')]
        .find(a => (a.getAttribute('href') || '').includes(t.id));
      if (!link) {
        await scrollHistoryFully();
        link = [...document.querySelectorAll('a[href*="/i/grok?conversation="]')]
          .find(a => (a.getAttribute('href') || '').includes(t.id));
      }
      if (!link) continue;

      link.click();
      await sleep(1500);

      // watchdog: close any dialog that appeared
      closeThoughtsDialogIfOpen();

      if ((i + 1) % 50 === 0) console.log(`processed ${i+1}/${targets.length}, captured=${captured.size}`);
    }
  }

  const conversations = targets.map(t => {
    const cap = captured.get(t.id);
    if (!cap) return { id: t.id, title: t.title, URL: t.URL, error: 'not_captured' };
    const items = cap?.data?.data?.grok_conversation_items_by_rest_id?.items || [];
    return {
      id: t.id,
      title: t.title,
      URL: t.URL,
      source_request_url: cap.requestUrl,
      item_count: items.length,
      items: items.map(it => ({
        chat_item_id: it.chat_item_id,
        sender_type: it.sender_type,
        created_at_ms: it.created_at_ms,
        message: it.message || '',
        thinking_trace: it.thinking_trace || '',
        deepsearch_headers: it.deepsearch_headers || [],
        cited_web_results: it.cited_web_results || [],
        web_results: it.web_results || [],
        is_partial: !!it.is_partial,
        grok_mode: it.grok_mode || null
      }))
    };
  });

  const out = {
    summary: {
      exported_at: new Date().toISOString(),
      index_passes: INDEX_PASSES,
      capture_passes: CAPTURE_PASSES,
      indexed_total: targets.length,
      captured_conversations: captured.size,
      missing_conversations: targets.length - captured.size
    },
    conversations
  };

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grok-network-capture-v13b-${Date.now()}.json`;
  a.click();

  console.log('DONE', out.summary);
})();
