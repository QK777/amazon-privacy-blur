(() => {
  'use strict';
  let enabled = null;
  const highlightName = 'apb-private-text';
  const ignored = 'script,style,noscript,textarea,input,select,option,[contenteditable]';
  const ignoredTags = new Set(['script', 'style', 'noscript', 'textarea', 'input', 'select', 'option']);
  const privateText = [
    '#nav-link-accountList-nav-line-1',
    '#glow-ingress-line1',
    '#glow-ingress-line2',
    '#contextualIngressPtLabel',
    '#contextualIngressPtLabel_deliveryShortLine',
    '#contextualIngressPtLabel_deliveryLongLine',
    '#address-ui-widgets-FullName',
    '[id^="address-book-entry-"][id$="-name"]',
    '[id^="address-book-entry-"][id$="-postalCode"]',
    '[autocomplete="name"]',
    '[autocomplete="postal-code"]'
  ].join(',');
  const postal = /(?:〒\s*)?(?<![0-9０-９])[0-9０-９]{3}[-－ー‐‑–—−\s][0-9０-９]{4}(?![0-9０-９])/gu;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = new RegExp(postal.source, 'gu');
  let namesKey = null;
  let settings = {enabled: true, names: ''};
  const highlight = new Highlight();
  let nodeRanges = new WeakMap();
  let parentContexts = new WeakMap();
  const privateIds = new Set([...privateText.matchAll(/#([\w-]+)/g)].map(match => match[1]));
  const privateId = id => privateIds.has(id) || /^address-book-entry-.*-(name|postalCode)$/.test(id || '');
  const scanFilter = {acceptNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return ignoredTags.has(node.localName) || node.hasAttribute('contenteditable')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    }
    return NodeFilter.FILTER_ACCEPT;
  }};

  function visitText(root, visit, scanning = false) {
    if (scanning) {
      const element = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
      if (element?.closest(ignored)) return;
    }
    if (root.nodeType === Node.TEXT_NODE) {
      visit(root);
      return;
    }
    const walker = scanning
      ? document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, scanFilter)
      : document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) visit(node);
  }

  function clearNode(node) {
    const ranges = nodeRanges.get(node);
    if (!ranges) return;
    for (const range of ranges.ranges) highlight.delete(range);
    nodeRanges.delete(node);
  }

  function scanNode(node) {
    const parent = node.parentElement;
    const text = node.nodeValue;
    if (!parent) return;
    if (!text.trim()) {
      clearNode(node);
      return;
    }
    let fullField = parentContexts.get(parent);
    if (fullField === undefined) {
      fullField = !!parent.closest(privateText);
      parentContexts.set(parent, fullField);
    }
    const previous = nodeRanges.get(node);
    if (previous && previous.text === text && previous.fullField === fullField) return;
    clearNode(node);
    const ranges = [];
    function addRange(start, end) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      highlight.add(range);
      ranges.push(range);
    }
    if (fullField) {
      addRange(0, text.length);
    } else {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        addRange(match.index, match.index + match[0].length);
      }
    }
    if (ranges.length) nodeRanges.set(node, {ranges, text, fullField});
  }

  function syncEnabled() {
    if (!document.documentElement) return false;
    document.documentElement.toggleAttribute('data-apb-off', !enabled);
    return true;
  }

  function apply() {
    const wasEnabled = enabled;
    enabled = settings.enabled !== false;
    if (!enabled) {
      observer.disconnect();
      // document_start may run before <html> exists. Stop as soon as it arrives.
      if (!syncEnabled()) observer.observe(document, {childList: true});
      if (wasEnabled !== false) {
        highlight.clear();
        nodeRanges = new WeakMap();
        CSS.highlights.delete(highlightName);
      }
      return;
    }
    const names = [...new Set((settings.names || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))]
      .sort((a,b) => b.length-a.length);
    const key = JSON.stringify(names);
    if (wasEnabled && namesKey === key) return;
    if (namesKey !== key) {
      pattern = new RegExp([postal.source, ...names.map(escape)].join('|'), 'gu');
      namesKey = key;
    }
    syncEnabled();
    observer.disconnect();
    highlight.clear();
    nodeRanges = new WeakMap();
    parentContexts = new WeakMap();
    visitText(document, scanNode, true);
    CSS.highlights.set(highlightName, highlight);
    observer.observe(document, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeOldValue: true,
      attributeFilter: ['id', 'autocomplete', 'contenteditable']
    });
  }

  const observer = new MutationObserver(records => {
    if (!enabled) {
      if (syncEnabled()) observer.disconnect();
      return;
    }
    const roots = new Set();
    const removed = new Set();
    const clearRoots = new Set();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.removedNodes) removed.add(node);
        for (const node of record.addedNodes) roots.add(node);
      } else {
        if (record.type === 'attributes') {
          const value = record.target.getAttribute(record.attributeName);
          if (value === record.oldValue) continue;
          if (record.attributeName === 'id' && !privateId(value) && !privateId(record.oldValue)) continue;
          if (record.attributeName === 'autocomplete' &&
              !['name', 'postal-code'].includes(value) && !['name', 'postal-code'].includes(record.oldValue)) continue;
          if (record.attributeName === 'contenteditable' && value !== null && record.oldValue !== null) continue;
          if (record.attributeName === 'contenteditable' && value !== null) clearRoots.add(record.target);
        } else {
          // Assigning identical text can still collapse native DOM Ranges.
          clearNode(record.target);
        }
        roots.add(record.target);
      }
    }
    if (!roots.size && !removed.size && !clearRoots.size) return;
    for (const root of clearRoots) {
      if (!highlight.size) break;
      visitText(root, clearNode);
    }
    // Removed/moved nodes must release their old ranges before any new scan.
    for (const root of removed) {
      if (!highlight.size) break;
      let ancestor = root.parentNode;
      while (ancestor && !removed.has(ancestor)) ancestor = ancestor.parentNode;
      if (!ancestor) visitText(root, clearNode);
    }
    parentContexts = new WeakMap();
    for (const root of roots) {
      if (!root.isConnected) continue;
      let ancestor = root.parentNode;
      while (ancestor && !roots.has(ancestor)) ancestor = ancestor.parentNode;
      if (!ancestor) visitText(root, scanNode, true);
    }
  });
  let initialized = false;
  const pending = {};
  chrome.storage.local.get(settings, values => {
    settings = {...values, ...pending};
    initialized = true;
    apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.enabled && !changes.names)) return;
    const values = {};
    if (changes.enabled) values.enabled = changes.enabled.newValue !== false;
    if (changes.names) values.names = changes.names.newValue || '';
    if (!initialized) Object.assign(pending, values);
    else {
      Object.assign(settings, values);
      apply();
    }
  });
})();
