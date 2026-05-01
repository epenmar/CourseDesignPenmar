// rich-editor.js — Quill-based rich text editor with math + symbol dropdowns.
//
// Usage:
//   <div class="rich-editor"
//        data-editor-type="template|material"
//        data-act-id="act-1" data-tpl-type="assignment" data-section="Overview"
//        data-material-id="mat-1" data-module-num="2" data-field="richText"
//        data-placeholder="..."
//        data-initial="<escaped-html>"></div>
//
//   window.RichEditor.initAll(optionalRoot) — instantiate any uninitialized editors.
//
// SHARED-TOOLBAR MODE:
//   When an editor is inside a `.template-preview` container, all editors in that
//   container share a single toolbar rendered at the top (sticky). The per-editor
//   toolbars are still created by Quill (so hover tooltips/icons are owned by
//   Quill) but hidden via CSS, and shared toolbar clicks dispatch to the
//   currently-focused editor via `quill.format()`.
//
// The editor persists via existing save paths:
//   - template  → saveTemplateField(actId, tplType, section, html)
//   - material  → mutates courseMaterials[modNum][*].<field> and calls saveActivityData()

(function() {
  var SCIENTIFIC = [
    ['±', 'plus-minus'], ['×', 'times'], ['÷', 'divide'], ['·', 'dot'],
    ['≠', 'not equal'], ['≤', 'less-equal'], ['≥', 'greater-equal'], ['≈', 'approx'],
    ['∝', 'proportional'], ['∞', 'infinity'], ['°', 'degree'], ['‰', 'per mille'],
    ['∑', 'sum'], ['∏', 'product'], ['√', 'sqrt'], ['∫', 'integral'],
    ['∂', 'partial'], ['∇', 'nabla'], ['Δ', 'delta'], ['∴', 'therefore'], ['∵', 'because']
  ];
  var GREEK = [
    ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'],
    ['ζ', 'zeta'], ['η', 'eta'], ['θ', 'theta'], ['ι', 'iota'], ['κ', 'kappa'],
    ['λ', 'lambda'], ['μ', 'mu'], ['ν', 'nu'], ['ξ', 'xi'], ['π', 'pi'],
    ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['υ', 'upsilon'], ['φ', 'phi'],
    ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'],
    ['Γ', 'Gamma'], ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Ξ', 'Xi'],
    ['Π', 'Pi'], ['Σ', 'Sigma'], ['Φ', 'Phi'], ['Ψ', 'Psi'], ['Ω', 'Omega']
  ];

  function waitForQuill(cb) {
    if (window.Quill) return cb();
    var tries = 0;
    var iv = setInterval(function() {
      if (window.Quill) { clearInterval(iv); cb(); }
      else if (++tries > 200) { clearInterval(iv); console.warn('[RichEditor] Quill never loaded'); }
    }, 50);
  }

  // Ensure KaTeX is exposed as window.katex (Quill formula expects it global).
  function ensureKatexGlobal() {
    if (window.katex) return;
    if (window.KaTeX) window.katex = window.KaTeX;
  }

  function buildSymbolDropdown(getQuill, label, items) {
    var sel = document.createElement('select');
    sel.className = 're-symbol-dropdown';
    sel.title = label;
    var html = '<option value="">' + label + ' ▾</option>';
    items.forEach(function(pair) {
      html += '<option value="' + pair[0] + '" title="' + pair[1] + '">' + pair[0] + '  ' + pair[1] + '</option>';
    });
    sel.innerHTML = html;
    sel.addEventListener('change', function() {
      var v = sel.value;
      if (!v) return;
      var quill = (typeof getQuill === 'function') ? getQuill() : getQuill;
      if (!quill) { sel.value = ''; return; }
      var range = quill.getSelection(true);
      if (!range) { quill.focus(); range = quill.getSelection(true); }
      quill.insertText(range.index, v, 'user');
      quill.setSelection(range.index + v.length, 0, 'user');
      sel.value = '';
    });
    return sel;
  }

  function _bumpContentIndicator(el) {
    if (typeof window.refreshAllContentIndicators !== 'function') return;
    // Quill text-change fires before the indicator's input listener sees the
    // value, and contenteditable mutation events don't always bubble. Run a
    // pass through every Content toggle on the page so the green ✓ tracks
    // typing in real time.
    try { window.refreshAllContentIndicators(); } catch(e) {}
  }

  function persistTemplateChange(el, html) {
    if (typeof window.saveTemplateField !== 'function') return;
    window.saveTemplateField(
      el.getAttribute('data-act-id'),
      el.getAttribute('data-tpl-type'),
      el.getAttribute('data-section'),
      html
    );
    _bumpContentIndicator(el);
  }

  function persistMaterialChange(el, html) {
    var modNum = parseInt(el.getAttribute('data-module-num'), 10);
    var matId = el.getAttribute('data-material-id');
    var field = el.getAttribute('data-field') || 'richText';
    if (typeof window.saveMaterialField === 'function') {
      window.saveMaterialField(matId, modNum, field, html);
    }
    _bumpContentIndicator(el);
  }

  function defaultToolbarOptions() {
    return [
      [{ 'header': [1, 2, 3, false] }],
      [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      [{ 'indent': '-1' }, { 'indent': '+1' }],
      [{ 'script': 'sub' }, { 'script': 'super' }],
      ['link', 'formula', 'clean']
    ];
  }

  // Create a Quill instance on `el` with the standard toolbar + persistence.
  // Returns the Quill instance.
  function createQuill(el) {
    var quill = new Quill(el, {
      theme: 'snow',
      placeholder: el.dataset.placeholder || '',
      modules: { toolbar: defaultToolbarOptions() }
    });
    var initial = el.getAttribute('data-initial') || '';
    if (initial) {
      try { quill.clipboard.dangerouslyPasteHTML(0, initial, 'silent'); }
      catch (e) { quill.root.innerHTML = initial; }
    }
    var saveTimer = null;
    quill.on('text-change', function(delta, oldDelta, source) {
      if (source !== 'user') return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function() {
        var html = quill.root.innerHTML === '<p><br></p>' ? '' : quill.root.innerHTML;
        var type = el.getAttribute('data-editor-type');
        if (type === 'template') persistTemplateChange(el, html);
        else if (type === 'material') persistMaterialChange(el, html);
      }, 250);
    });
    el._quill = quill;
    return quill;
  }

  function initOne(el) {
    if (el.dataset.reInitialized === '1') return;
    el.dataset.reInitialized = '1';

    var quill = createQuill(el);

    // Add custom symbol dropdowns at the end of the per-editor toolbar.
    var toolbar = quill.getModule('toolbar').container;
    var sciGroup = document.createElement('span');
    sciGroup.className = 'ql-formats';
    sciGroup.appendChild(buildSymbolDropdown(quill, 'Sci', SCIENTIFIC));
    sciGroup.appendChild(buildSymbolDropdown(quill, 'Greek', GREEK));
    toolbar.appendChild(sciGroup);
  }

  // ===== SHARED-TOOLBAR MODE =====
  // Build one toolbar at the top of a .template-preview and wire it to format
  // whichever editor in the preview currently has focus (or the last-focused).

  function initSharedForPreview(previewEl) {
    if (previewEl.dataset.reSharedInit === '1') return;
    var editors = Array.prototype.slice.call(previewEl.querySelectorAll('.rich-editor'));
    if (editors.length === 0) return;
    previewEl.dataset.reSharedInit = '1';
    previewEl.classList.add('has-shared-toolbar');

    var quills = [];
    var activeQuill = null;

    editors.forEach(function(el) {
      if (el.dataset.reInitialized === '1') return;
      el.dataset.reInitialized = '1';
      var q = createQuill(el);
      // Hide the per-editor toolbar's ql-formats (it still exists so Quill can
      // render formula/link tooltips, just not visible).
      q.on('selection-change', function(range) {
        if (range) { activeQuill = q; refreshState(); }
      });
      q.root.addEventListener('focus', function() { activeQuill = q; refreshState(); });
      quills.push(q);
    });
    if (quills.length) activeQuill = quills[0];

    // Build shared toolbar. We deliberately ignore Quill's SVG icons and use
    // plain-text/emoji labels instead — the SVG set renders as hard-to-read
    // glyphs at our size (vertical dots, blank squares, etc.) which users
    // can't identify without hovering for the tooltip.
    var toolbar = document.createElement('div');
    toolbar.className = 're-shared-toolbar';

    function getQuill() { return activeQuill; }

    function addGroup() {
      var g = document.createElement('span');
      g.className = 'ql-formats';
      toolbar.appendChild(g);
      return g;
    }

    function mkBtn(fmt, value, iconHtml, title) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ql-' + fmt + (value ? ' ql-' + fmt + '-' + String(value).replace(/[^a-z0-9]/gi, '') : '');
      b.setAttribute('data-fmt', fmt);
      if (value != null) b.setAttribute('data-val', String(value));
      if (title) b.title = title;
      b.innerHTML = iconHtml || '';
      b.addEventListener('mousedown', function(e) { e.preventDefault(); }); // keep focus
      b.addEventListener('click', function() { dispatchFormat(fmt, value, b); });
      return b;
    }

    function mkSelect(fmt, options, placeholder) {
      var s = document.createElement('select');
      s.className = 're-symbol-dropdown';
      s.setAttribute('data-fmt', fmt);
      if (placeholder) {
        var o = document.createElement('option');
        o.value = '';
        o.textContent = placeholder;
        s.appendChild(o);
      }
      options.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt.value == null ? '' : String(opt.value);
        o.textContent = opt.label;
        s.appendChild(o);
      });
      s.addEventListener('change', function() {
        var v = s.value;
        dispatchFormat(fmt, v === '' ? false : v, s);
        // Put caret back into the editor so user can keep typing.
        if (activeQuill) activeQuill.focus();
      });
      return s;
    }

    function dispatchFormat(fmt, value, ctrl) {
      var quill = getQuill();
      if (!quill) return;
      var range = quill.getSelection(true);
      if (!range) { quill.focus(); range = quill.getSelection(true); if (!range) return; }
      if (fmt === 'clean') {
        quill.removeFormat(range.index, range.length);
        return;
      }
      if (fmt === 'link') {
        var existing = (quill.getFormat(range) || {}).link || '';
        var url = prompt('Enter URL:', existing || 'https://');
        if (url === null) return;
        if (url === '') quill.format('link', false);
        else quill.format('link', url);
        return;
      }
      if (fmt === 'formula') {
        var f = prompt('Enter LaTeX formula (e.g. e^{i\\pi}+1=0):');
        if (!f) return;
        quill.insertEmbed(range.index, 'formula', f, 'user');
        quill.setSelection(range.index + 1, 0, 'user');
        return;
      }
      if (fmt === 'indent') {
        quill.format('indent', value, 'user');
        return;
      }
      var cur = quill.getFormat(range);
      if (value === undefined || value === null) {
        // Toggle boolean format
        quill.format(fmt, !cur[fmt], 'user');
      } else if (value === false) {
        quill.format(fmt, false, 'user');
      } else {
        // If pressing a valued button that is already active, unset it.
        var same = cur[fmt] !== undefined && String(cur[fmt]) === String(value);
        quill.format(fmt, same && ctrl && ctrl.tagName === 'BUTTON' ? false : value, 'user');
      }
      refreshState();
    }

    function refreshState() {
      if (!activeQuill) return;
      var range = activeQuill.getSelection();
      var fmt = range ? activeQuill.getFormat(range) : activeQuill.getFormat();
      toolbar.querySelectorAll('button[data-fmt]').forEach(function(b) {
        var f = b.getAttribute('data-fmt');
        var v = b.getAttribute('data-val');
        var active;
        if (f === 'clean' || f === 'link' || f === 'formula' || f === 'indent') active = false;
        else if (v == null) active = !!fmt[f];
        else active = fmt[f] !== undefined && String(fmt[f]) === v;
        b.classList.toggle('active', active);
      });
      toolbar.querySelectorAll('select[data-fmt]').forEach(function(s) {
        var f = s.getAttribute('data-fmt');
        var val = fmt[f];
        if (val == null) val = '';
        // Don't override Sci/Greek insert-selects
        if (!s.classList.contains('re-insert-symbol')) s.value = String(val);
      });
    }

    // Build toolbar groups
    var g1 = addGroup();
    var headerSel = mkSelect('header', [
      { value: '1', label: 'H1' }, { value: '2', label: 'H2' }, { value: '3', label: 'H3' }
    ], 'Normal');
    g1.appendChild(headerSel);

    var g2 = addGroup();
    g2.appendChild(mkBtn('bold', null, '<b>B</b>', 'Bold (Ctrl+B)'));
    g2.appendChild(mkBtn('italic', null, '<i>I</i>', 'Italic (Ctrl+I)'));
    g2.appendChild(mkBtn('underline', null, '<u>U</u>', 'Underline (Ctrl+U)'));
    g2.appendChild(mkBtn('strike', null, '<s>S</s>', 'Strikethrough'));

    var g3 = addGroup();
    g3.appendChild(mkBtn('list', 'ordered', '1.', 'Ordered list'));
    g3.appendChild(mkBtn('list', 'bullet',  '•',  'Bullet list'));
    g3.appendChild(mkBtn('indent', '-1', '←', 'Outdent'));
    g3.appendChild(mkBtn('indent', '+1', '→', 'Indent'));

    var g4 = addGroup();
    g4.appendChild(mkBtn('script', 'sub',   'X₂', 'Subscript'));
    g4.appendChild(mkBtn('script', 'super', 'X²', 'Superscript'));

    var g5 = addGroup();
    g5.appendChild(mkBtn('link', null, '🔗', 'Insert link'));
    g5.appendChild(mkBtn('formula', null, 'ƒx', 'Insert formula (LaTeX)'));
    g5.appendChild(mkBtn('clean', null, '⌫ clear', 'Clear formatting'));

    var g6 = addGroup();
    var sciSel = buildSymbolDropdown(getQuill, 'Sci', SCIENTIFIC);
    sciSel.classList.add('re-insert-symbol');
    var grkSel = buildSymbolDropdown(getQuill, 'Greek', GREEK);
    grkSel.classList.add('re-insert-symbol');
    g6.appendChild(sciSel);
    g6.appendChild(grkSel);

    // Insert toolbar as first child of previewEl (but after any <h4> title)
    var title = previewEl.querySelector('h4');
    if (title && title.parentNode === previewEl) {
      previewEl.insertBefore(toolbar, title.nextSibling);
    } else {
      previewEl.insertBefore(toolbar, previewEl.firstChild);
    }

    refreshState();
  }

  function initAll(root) {
    ensureKatexGlobal();
    root = root || document;

    // First handle shared-toolbar previews.
    var previews = root.querySelectorAll ? root.querySelectorAll('.template-preview') : [];
    previews.forEach(function(p) {
      if (p.querySelector('.rich-editor')) initSharedForPreview(p);
    });
    // Also handle the case where `root` itself is a template-preview.
    if (root.classList && root.classList.contains('template-preview') && root.querySelector('.rich-editor')) {
      initSharedForPreview(root);
    }

    // Then init any remaining (uninitialized) editors with per-editor toolbars.
    var nodes = root.querySelectorAll ? root.querySelectorAll('.rich-editor') : [];
    nodes.forEach(initOne);
  }

  // Utility: strip HTML to plain text (used by Drive .txt export).
  function htmlToPlainText(html) {
    if (!html) return '';
    var div = document.createElement('div');
    div.innerHTML = html;
    // Replace <br>/<p>/<li> with newlines for readability
    div.querySelectorAll('br').forEach(function(el) { el.replaceWith('\n'); });
    div.querySelectorAll('p, div, li').forEach(function(el) {
      if (el.textContent.length > 0 && !el.textContent.endsWith('\n')) el.append('\n');
    });
    return div.textContent.trim();
  }

  window.RichEditor = {
    initAll: function(root) { waitForQuill(function() { initAll(root); }); },
    htmlToPlainText: htmlToPlainText
  };
})();
