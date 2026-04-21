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

  function buildSymbolDropdown(quill, label, items) {
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
      var range = quill.getSelection(true);
      if (!range) { quill.focus(); range = quill.getSelection(true); }
      quill.insertText(range.index, v, 'user');
      quill.setSelection(range.index + v.length, 0, 'user');
      sel.value = '';
    });
    return sel;
  }

  function persistTemplateChange(el, html) {
    if (typeof window.saveTemplateField !== 'function') return;
    window.saveTemplateField(
      el.getAttribute('data-act-id'),
      el.getAttribute('data-tpl-type'),
      el.getAttribute('data-section'),
      html
    );
  }

  function persistMaterialChange(el, html) {
    var modNum = parseInt(el.getAttribute('data-module-num'), 10);
    var matId = el.getAttribute('data-material-id');
    var field = el.getAttribute('data-field') || 'richText';
    if (typeof window.saveMaterialField === 'function') {
      window.saveMaterialField(matId, modNum, field, html);
    }
  }

  function initOne(el) {
    if (el.dataset.reInitialized === '1') return;
    el.dataset.reInitialized = '1';

    var toolbarOptions = [
      [{ 'header': [1, 2, 3, false] }],
      [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      [{ 'indent': '-1' }, { 'indent': '+1' }],
      [{ 'script': 'sub' }, { 'script': 'super' }],
      ['link', 'formula', 'clean']
    ];

    var quill = new Quill(el, {
      theme: 'snow',
      placeholder: el.dataset.placeholder || '',
      modules: { toolbar: toolbarOptions }
    });

    // Load initial content (HTML) if present.
    var initial = el.getAttribute('data-initial') || '';
    if (initial) {
      try { quill.clipboard.dangerouslyPasteHTML(0, initial, 'silent'); }
      catch (e) { quill.root.innerHTML = initial; }
    }

    // Add custom symbol dropdowns at the end of the toolbar.
    var toolbar = quill.getModule('toolbar').container;
    var sciGroup = document.createElement('span');
    sciGroup.className = 'ql-formats';
    sciGroup.appendChild(buildSymbolDropdown(quill, 'Sci', SCIENTIFIC));
    sciGroup.appendChild(buildSymbolDropdown(quill, 'Greek', GREEK));
    toolbar.appendChild(sciGroup);

    // Debounced persist on text-change.
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

    // Store the Quill instance so callers can read plain text later (e.g. Drive export).
    el._quill = quill;
  }

  function initAll(root) {
    ensureKatexGlobal();
    root = root || document;
    var nodes = root.querySelectorAll('.rich-editor');
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
