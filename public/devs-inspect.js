(function() {
  var inspectEnabled = false;
  var highlightEl = null;

  function getElementClassName(el) {
    if (!el) return '';
    var attrClass = typeof el.getAttribute === 'function' ? el.getAttribute('class') : null;
    if (typeof attrClass === 'string') return attrClass;
    if (typeof el.className === 'string') return el.className;
    if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
    return '';
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    var path = [];
    while (el && el.nodeType === 1) {
      if (el.id) {
        path.unshift('#' + el.id);
        break;
      }
      var tag = el.tagName.toLowerCase();
      var className = getElementClassName(el);
      if (className) {
        var classes = className.trim().split(/\s+/).filter(function(c) {
          return c && !c.startsWith('hover') && !c.startsWith('focus');
        });
        if (classes.length > 0) {
          path.unshift(tag + '.' + classes.join('.'));
          break;
        }
      }
      var parent = el.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) {
          return c.tagName === el.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(el) + 1;
          path.unshift(tag + ':nth-of-type(' + idx + ')');
        } else {
          path.unshift(tag);
        }
      } else {
        path.unshift(tag);
      }
      el = parent;
    }
    return path.join(' > ');
  }

  function getAncestorPath(el, depth) {
    var parts = [];
    var current = el;
    for (var i = 0; i < (depth || 3); i++) {
      if (!current || current === document.documentElement) break;
      parts.unshift(current.tagName.toLowerCase());
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getRect(el) {
    var r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  function getSnippet(el) {
    var clone = el.cloneNode(true);
    // Truncate deep children
    var children = clone.querySelectorAll('*');
    for (var i = 0; i < children.length; i++) {
      if (children[i].children.length > 0) {
        children[i].innerHTML = '...';
      }
    }
    var html = clone.outerHTML;
    return html.length > 500 ? html.slice(0, 500) + '...' : html;
  }

  function onHover(e) {
    if (!inspectEnabled) return;
    var el = e.target;
    if (!el || el === document.body || el === document.documentElement) return;
    window.parent.postMessage({
      type: 'devs:hover',
      payload: {
        rect: getRect(el),
        tagName: el.tagName.toLowerCase(),
        selector: getSelector(el)
      }
    }, '*');
  }

  function onHoverOut() {
    if (!inspectEnabled) return;
    window.parent.postMessage({ type: 'devs:hover-out' }, '*');
  }

  var _h2cPromise = null;
  var H2C_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  var H2C_SHA256 = 'e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb';
  function verifySha256(text, expectedHex) {
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.resolve(false);
    }
    return window.crypto.subtle.digest('SHA-256', new window.TextEncoder().encode(text))
      .then(function(buffer) {
        var actualHex = Array.from(new Uint8Array(buffer)).map(function(b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        return actualHex === expectedHex;
      })
      .catch(function() {
        return false;
      });
  }
  function loadHtml2Canvas() {
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = fetch(H2C_URL)
      .then(function(r) {
        if (!r.ok) throw new Error('Failed to fetch html2canvas');
        return r.text();
      })
      .then(function(code) {
        return verifySha256(code, H2C_SHA256).then(function(valid) {
          if (!valid) throw new Error('html2canvas hash mismatch');
          return code;
        });
      })
      .then(function(code) {
        var blob = new Blob([code], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        var s = document.createElement('script');
        s.src = url;
        return new Promise(function(resolve) {
          s.onload = function() { URL.revokeObjectURL(url); resolve(window.html2canvas || null); };
          s.onerror = function() { URL.revokeObjectURL(url); resolve(null); };
          document.head.appendChild(s);
        });
      })
      .then(function(h2c) {
        if (!h2c) _h2cPromise = null;
        return h2c;
      })
      .catch(function() {
        _h2cPromise = null;
        return null;
      });
    return _h2cPromise;
  }

  function sendScreenshot(dataUrl, selectionToken) {
    window.parent.postMessage({ type: 'devs:select-screenshot', dataUrl: dataUrl, selectionToken: selectionToken }, '*');
  }

  function hasVisibleBackground(color) {
    if (!color || color === 'transparent') return false;
    var normalized = color.replace(/\s+/g, '').toLowerCase();
    if (normalized === 'rgba(0,0,0,0)') return false;
    var rgbaMatch = normalized.match(/^rgba\((\d+),(\d+),(\d+),([^)]+)\)$/);
    if (!rgbaMatch) return true;
    return parseFloat(rgbaMatch[4]) > 0;
  }

  function getCaptureBackgroundColor(el) {
    var current = el;
    while (current && current !== document.documentElement) {
      var bg = window.getComputedStyle(current).backgroundColor;
      if (hasVisibleBackground(bg)) return bg;
      current = current.parentElement;
    }
    var bodyBg = window.getComputedStyle(document.body).backgroundColor;
    return hasVisibleBackground(bodyBg) ? bodyBg : '#ffffff';
  }

  function parseRgbColor(color) {
    if (!color) return null;
    var normalized = color.replace(/\s+/g, '').toLowerCase();
    var match = normalized.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([^)]+))?\)$/);
    if (!match) return null;
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10)
    };
  }

  function channelToLuminance(channel) {
    var scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  }

  function getContrastRatio(colorA, colorB) {
    var lumA = 0.2126 * channelToLuminance(colorA.r) + 0.7152 * channelToLuminance(colorA.g) + 0.0722 * channelToLuminance(colorA.b);
    var lumB = 0.2126 * channelToLuminance(colorB.r) + 0.7152 * channelToLuminance(colorB.g) + 0.0722 * channelToLuminance(colorB.b);
    var lighter = Math.max(lumA, lumB);
    var darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function ensureReadableBackgroundColor(el, backgroundColor) {
    var textColor = parseRgbColor(window.getComputedStyle(el).color);
    var backgroundRgb = parseRgbColor(backgroundColor);
    if (!textColor || !backgroundRgb) return backgroundColor;
    if (getContrastRatio(textColor, backgroundRgb) >= 4.5) return backgroundColor;
    var white = { r: 255, g: 255, b: 255 };
    var black = { r: 0, g: 0, b: 0 };
    return getContrastRatio(textColor, white) >= getContrastRatio(textColor, black) ? '#ffffff' : '#000000';
  }

  function exportCanvasWithBackground(sourceCanvas, backgroundColor) {
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height;
    var ctx = exportCanvas.getContext('2d');
    if (!ctx) return sourceCanvas.toDataURL('image/jpeg', 0.7);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);
    return exportCanvas.toDataURL('image/jpeg', 0.7);
  }

  function svgFallback(el, selectionToken) {
    var rect = el.getBoundingClientRect();
    var w = Math.ceil(rect.width);
    var h = Math.ceil(rect.height);
    if (w === 0 || h === 0) return;
    var maxDim = 300;
    var scale = Math.min(1, maxDim / Math.max(w, h));
    var backgroundColor = ensureReadableBackgroundColor(el, getCaptureBackgroundColor(el));

    var clone = el.cloneNode(true);
    (function inlineStyles(src, dst) {
      var cs = window.getComputedStyle(src);
      var t = '';
      for (var i = 0; i < cs.length; i++) { var p = cs[i]; t += p + ':' + cs.getPropertyValue(p) + ';'; }
      dst.setAttribute('style', t);
      for (var j = 0; j < src.children.length && j < dst.children.length; j++) {
        inlineStyles(src.children[j], dst.children[j]);
      }
    })(el, clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

    var html = new XMLSerializer().serializeToString(clone);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';

    var img = new Image();
    img.onload = function() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        sendScreenshot(canvas.toDataURL('image/jpeg', 0.7), selectionToken);
      } catch(e) { /* tainted canvas — give up */ }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function captureElement(el, selectionToken) {
    loadHtml2Canvas().then(function(h2c) {
      if (!h2c) { svgFallback(el, selectionToken); return; }
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        svgFallback(el, selectionToken);
        return;
      }
      var padding = 8;
      var captureWidth = Math.ceil(rect.width + padding * 2);
      var captureHeight = Math.ceil(rect.height + padding * 2);
      var captureX = Math.max(0, Math.floor(rect.left + window.scrollX - padding));
      var captureY = Math.max(0, Math.floor(rect.top + window.scrollY - padding));
      var maxDim = 300;
      var scale = Math.min(1, maxDim / Math.max(captureWidth || 1, captureHeight || 1));
      var backgroundColor = ensureReadableBackgroundColor(el, getCaptureBackgroundColor(el));
      h2c(document.body, {
        scale: scale,
        useCORS: true,
        logging: false,
        backgroundColor: null,
        removeContainer: true,
        x: captureX,
        y: captureY,
        width: captureWidth,
        height: captureHeight
      }).then(function(canvas) {
        sendScreenshot(exportCanvasWithBackground(canvas, backgroundColor), selectionToken);
      }).catch(function() { svgFallback(el, selectionToken); });
    }).catch(function() { svgFallback(el, selectionToken); });
  }

  var _selectionCounter = 0;
  function nextSelectionToken() {
    _selectionCounter += 1;
    return 'inspect-' + _selectionCounter;
  }

  function onClick(e) {
    if (!inspectEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var el = e.target;
    if (!el || el === document.body || el === document.documentElement) return;
    var textContent = (el.textContent || '').trim();
    var selectionToken = nextSelectionToken();
    window.parent.postMessage({
      type: 'devs:select',
      payload: {
        selectionToken: selectionToken,
        selector: getSelector(el),
        tagName: el.tagName.toLowerCase(),
        className: getElementClassName(el),
        id: el.id || '',
        textContent: textContent.length > 100 ? textContent.slice(0, 100) + '...' : textContent,
        htmlSnippet: getSnippet(el),
        rect: getRect(el),
        ancestorPath: getAncestorPath(el, 3)
      }
    }, '*');
    captureElement(el, selectionToken);
  }

  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'devs:enable-inspect') {
      inspectEnabled = true;
      document.body.style.cursor = 'crosshair';
    } else if (e.data.type === 'devs:disable-inspect') {
      inspectEnabled = false;
      document.body.style.cursor = '';
    } else if (e.data.type === 'devs:setup-touch' && !window.__devsTouchSetup) {
      window.__devsTouchSetup = true;
      document.addEventListener('touchstart', function(te) {
        if (!inspectEnabled) return;
        var t = te.touches[0]; if (!t) return;
        var el = document.elementFromPoint(t.clientX, t.clientY);
        if (!el || el === document.body || el === document.documentElement) return;
        te.preventDefault();
        window.parent.postMessage({ type: 'devs:hover', payload: { rect: getRect(el), tagName: el.tagName.toLowerCase(), selector: getSelector(el) } }, '*');
      }, { capture: true, passive: false });
      document.addEventListener('touchend', function(te) {
        if (!inspectEnabled) return;
        var t = te.changedTouches[0]; if (!t) return;
        var el = document.elementFromPoint(t.clientX, t.clientY);
        if (!el || el === document.body || el === document.documentElement) return;
        te.preventDefault();
        var tc = (el.textContent || '').trim();
        var selectionToken = nextSelectionToken();
        window.parent.postMessage({ type: 'devs:select', payload: { selectionToken: selectionToken, selector: getSelector(el), tagName: el.tagName.toLowerCase(), className: getElementClassName(el), id: el.id || '', textContent: tc.length > 100 ? tc.slice(0, 100) + '...' : tc, htmlSnippet: getSnippet(el), rect: getRect(el), ancestorPath: getAncestorPath(el, 3) } }, '*');
        captureElement(el, selectionToken);
      }, { capture: true, passive: false });
    } else if (e.data.type === 'devs:ping') {
      window.parent.postMessage({ type: 'devs:pong' }, '*');
    } else if (e.data.type === 'devs:db-query') {
      var queryId = e.data.queryId;
      var sql = e.data.sql;
      (function() {
        var pglite = window.__devs_pglite;
        if (!pglite) {
          // Try to dynamically import PGlite and open the IDB database
          import('@electric-sql/pglite').then(function(mod) {
            var client = new mod.PGlite('idb://app-db');
            window.__devs_pglite = client;
            return client.waitReady ? client.waitReady.then(function() { return client; }) : client;
          }).then(function(client) {
            return client.query(sql);
          }).then(function(result) {
            window.parent.postMessage({ type: 'devs:db-result', queryId: queryId, rows: result.rows, fields: result.fields ? result.fields.map(function(f) { return f.name; }) : [] }, '*');
          }).catch(function(err) {
            window.parent.postMessage({ type: 'devs:db-result', queryId: queryId, error: String(err.message || err) }, '*');
          });
          return;
        }
        var ready = pglite.waitReady ? pglite.waitReady : Promise.resolve();
        ready.then(function() {
          return pglite.query(sql);
        }).then(function(result) {
          window.parent.postMessage({ type: 'devs:db-result', queryId: queryId, rows: result.rows, fields: result.fields ? result.fields.map(function(f) { return f.name; }) : [] }, '*');
        }).catch(function(err) {
          window.parent.postMessage({ type: 'devs:db-result', queryId: queryId, error: String(err.message || err) }, '*');
        });
      })();
    }
  });

  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('mouseout', onHoverOut, true);
  document.addEventListener('click', onClick, true);

  // Touch support for mobile inspect
  window.__devsTouchSetup = true;
  document.addEventListener('touchstart', function(e) {
    if (!inspectEnabled) return;
    var touch = e.touches[0];
    if (!touch) return;
    var el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el || el === document.body || el === document.documentElement) return;
    e.preventDefault();
    window.parent.postMessage({
      type: 'devs:hover',
      payload: {
        rect: getRect(el),
        tagName: el.tagName.toLowerCase(),
        selector: getSelector(el)
      }
    }, '*');
  }, { capture: true, passive: false });

  document.addEventListener('touchend', function(e) {
    if (!inspectEnabled) return;
    var touch = e.changedTouches[0];
    if (!touch) return;
    var el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el || el === document.body || el === document.documentElement) return;
    e.preventDefault();
    var textContent = (el.textContent || '').trim();
    var selectionToken = nextSelectionToken();
    window.parent.postMessage({
      type: 'devs:select',
      payload: {
        selectionToken: selectionToken,
        selector: getSelector(el),
        tagName: el.tagName.toLowerCase(),
        className: getElementClassName(el),
        id: el.id || '',
        textContent: textContent.length > 100 ? textContent.slice(0, 100) + '...' : textContent,
        htmlSnippet: getSnippet(el),
        rect: getRect(el),
        ancestorPath: getAncestorPath(el, 3)
      }
    }, '*');
    captureElement(el, selectionToken);
  }, { capture: true, passive: false });

  // Forward console output to parent for the Logs panel
  var _origLog = console.log;
  var _origWarn = console.warn;
  var _origError = console.error;
  var _origInfo = console.info;

  function forwardConsole(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        parts.push(typeof a === 'string' ? a : JSON.stringify(a));
      }
      window.parent.postMessage({
        type: 'devs:console',
        level: level,
        text: parts.join(' ')
      }, '*');
    } catch (e) { /* ignore serialization errors */ }
  }

  console.log = function() { forwardConsole('log', arguments); return _origLog.apply(console, arguments); };
  console.warn = function() { forwardConsole('warn', arguments); return _origWarn.apply(console, arguments); };
  console.error = function() { forwardConsole('error', arguments); return _origError.apply(console, arguments); };
  console.info = function() { forwardConsole('info', arguments); return _origInfo.apply(console, arguments); };

  // Forward unhandled errors
  window.addEventListener('error', function(e) {
    window.parent.postMessage({
      type: 'devs:console',
      level: 'error',
      text: '[Runtime Error] ' + (e.message || String(e.error))
    }, '*');
  });

  window.addEventListener('unhandledrejection', function(e) {
    window.parent.postMessage({
      type: 'devs:console',
      level: 'error',
      text: '[Unhandled Promise] ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))
    }, '*');
  });

  // Intercept fetch to detect failed HTTP responses (4xx/5xx)
  var _origFetch = window.fetch;
  window.fetch = function() {
    var url = arguments[0];
    var urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
    return _origFetch.apply(this, arguments).then(function(response) {
      if (!response.ok && response.status >= 400) {
        var level = response.status >= 500 ? 'error' : 'warn';
        var label = response.status >= 500 ? 'Server error' : 'Request failed';
        try {
          var path = new URL(urlStr, location.origin).pathname;
          window.parent.postMessage({
            type: 'devs:console',
            level: level,
            text: '[HTTP ' + response.status + '] ' + label + ': ' + path
          }, '*');
        } catch(e) {
          window.parent.postMessage({
            type: 'devs:console',
            level: level,
            text: '[HTTP ' + response.status + '] ' + label + ': (unparseable URL)'
          }, '*');
        }
      }
      return response;
    });
  };
})();