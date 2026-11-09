(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMath(tex, displayMode) {
    var katex = window.katex;
    if (katex && typeof katex.renderToString === 'function') {
      try {
        return katex.renderToString(tex, {
          throwOnError: false,
          displayMode: !!displayMode
        });
      } catch (e) {
        // fall through to fallback
      }
    }
    return '<code class="math-fallback">' + escapeHtml(tex) + '</code>';
  }

  function protectMath(text, store) {
    function push(html) {
      var key = '\u0000MATH' + store.length + '\u0000';
      store.push(html);
      return key;
    }

    // Display: $$...$$ and \[...\]
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (m, tex) {
      return push('<div class="math-scroll">' + renderMath(tex, true) + '</div>');
    });
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (m, tex) {
      return push('<div class="math-scroll">' + renderMath(tex, true) + '</div>');
    });

    // Inline: $...$ and \(...\)
    text = text.replace(/(^|[^\\$])\$([^\$\n]+?)\$/g, function (m, pre, tex) {
      return pre + push(renderMath(tex, false));
    });
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, function (m, tex) {
      return push(renderMath(tex, false));
    });

    return text;
  }

  function restoreMath(text, store) {
    return text.replace(/\u0000MATH(\d+)\u0000/g, function (m, i) {
      return store[parseInt(i, 10)];
    });
  }

  function inlineFormat(s) {
    // inline code first
    var codes = [];
    s = s.replace(/`([^`\n]+)`/g, function (m, c) {
      var key = '\u0001CODE' + codes.length + '\u0001';
      codes.push('<code>' + c + '</code>');
      return key;
    });

    s = s.replace(/\*\*([^\*\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\*])\*([^\*\n]+?)\*/g, '$1<em>$2</em>');

    // Bare https URLs (search sources) become links; input is already escaped.
    s = s.replace(/https?:\/\/[^\s<>"']+/g, function (url) {
      var trail = '';
      var tm = url.match(/[.,;:!?，。；：！？、]+$/);
      if (tm) {
        trail = tm[0];
        url = url.slice(0, -trail.length);
      }
      if (!/^https?:\/\//i.test(url)) return url + trail;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + trail;
    });

    s = s.replace(/\u0001CODE(\d+)\u0001/g, function (m, i) {
      return codes[parseInt(i, 10)];
    });
    return s;
  }

  function renderBlocks(text) {
    var lines = text.split('\n');
    var out = [];
    var i = 0;
    var n = lines.length;

    function isBlank(l) { return /^\s*$/.test(l); }
    function isFence(l) { return /^\s*```/.test(l); }
    function isUl(l) { return /^\s*[-*+]\s+/.test(l); }
    function isOl(l) { return /^\s*\d+\.\s+/.test(l); }
    function isHeading(l) { return /^\s*#{1,3}\s+/.test(l); }

    while (i < n) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      if (isFence(line)) {
        var fence = line.match(/^\s*```(.*)$/);
        var lang = fence ? fence[1].trim() : '';
        var buf = [];
        i++;
        while (i < n && !isFence(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < n) i++; // skip closing fence
        var cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
        out.push('<pre><code' + cls + '>' + buf.join('\n') + '</code></pre>');
        continue;
      }

      if (isHeading(line)) {
        var hm = line.match(/^\s*(#{1,3})\s+(.*)$/);
        var level = hm[1].length;
        out.push('<h' + level + '>' + inlineFormat(hm[2].trim()) + '</h' + level + '>');
        i++;
        continue;
      }

      if (isUl(line)) {
        var items = [];
        while (i < n && isUl(lines[i])) {
          items.push('<li>' + inlineFormat(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      if (isOl(line)) {
        var oitems = [];
        while (i < n && isOl(lines[i])) {
          oitems.push('<li>' + inlineFormat(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ol>' + oitems.join('') + '</ol>');
        continue;
      }

      // paragraph: gather until blank or block start
      var para = [];
      while (i < n && !isBlank(lines[i]) && !isFence(lines[i]) &&
             !isHeading(lines[i]) && !isUl(lines[i]) && !isOl(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      var joined = para.map(function (l) { return inlineFormat(l); }).join('<br>');
      out.push('<p>' + joined + '</p>');
    }

    return out.join('\n');
  }

  function render(mdText) {
    // Protect math on raw text first so TeX is not HTML-escaped; then escape the rest.
    var store = [];
    var text = protectMath(String(mdText == null ? '' : mdText), store);
    text = escapeHtml(text);
    // Placeholders use \u0000 which escapeHtml leaves alone.
    var html = renderBlocks(text);
    return restoreMath(html, store);
  }

  window.StudyHubRender = { render: render };
})();
