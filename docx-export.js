// docx-export.js — Minimal HTML → real .docx (OOXML) converter.
//
// Produces a true .docx package (ZIP of XML parts) so Google Docs respects
// page margins (<w:pgMar>) on import. The previous .doc-disguised-HTML
// pipeline was at the mercy of Drive's HTML→Google-Doc converter, which
// ignored both @page rules and mso-page-margin-* extensions and forced
// every export to 1" margins.
//
// Scope: targets the constructs the Course Development Worksheet actually
// emits in its preview pane and the course-parser proposal:
//   - <h1>, <h2>, <h3>           → Heading1/2/3 (centered for h1)
//   - <p>, <div>                 → Normal paragraph (with optional indent)
//   - <strong>/<b>, <em>/<i>, <u>, <br>, <span>
//   - <a href>                   → real OOXML hyperlinks (via doc rels)
//   - <ul>/<ol>/<li>             → real numbered/bulleted lists
//   - <table>/<thead>/<tbody>/<tr>/<th>/<td>  with rowspan + colspan
//   - .placeholder, .doc-subtitle classes (special styling)
//   - inline style: color, font-size (pt or px), font-weight, font-style,
//     background-color, text-align, width (px / pt / %)
//
// Out of scope (silently dropped):
//   - <img>, <iframe>, <video>, <hr> (we use sectPr borders instead)
//   - Complex CSS layout (flex/grid), custom fonts beyond Calibri default
//
// Public API:
//   DocxExport.elementToBlob(htmlElement, options?) → Promise<Blob>
//   DocxExport.htmlStringToBlob(htmlString, options?) → Promise<Blob>
//
// Options:
//   { marginIn: 0.5, title: 'My Doc', creator: 'Course Worksheet' }

(function() {
  'use strict';

  // ===== UNIT HELPERS =====
  // Twips: 1 inch = 1440 twips. Half-points: font sizes (10pt = 20).
  // EMU: 914400 per inch (only needed for images, which we don't support).
  function inToTwips(inches) { return Math.round(inches * 1440); }
  function ptToHalfPt(pt)    { return Math.round(pt * 2); }
  function pxToPt(px)        { return px * 0.75; } // 96 DPI → 72 PPI

  // Default 8.5" x 11" portrait.
  var PAGE_W_TWIPS = inToTwips(8.5);
  var PAGE_H_TWIPS = inToTwips(11);

  // ===== XML ESCAPING =====
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  function escAttr(s) { return escXml(s); }

  // ===== STYLE PARSING =====
  // Read the inline style of an element + its merged classes into a flat
  // map of properties relevant to OOXML rendering. We only care about a
  // handful: color, font-size, font-weight, font-style, text-decoration,
  // text-align, background-color, width.
  function readStyle(el) {
    var s = {};
    if (!el || el.nodeType !== 1) return s;
    var cs = el.style || {};
    if (cs.color) s.color = cs.color;
    if (cs.fontSize) s.fontSize = cs.fontSize;
    if (cs.fontWeight) s.fontWeight = cs.fontWeight;
    if (cs.fontStyle) s.fontStyle = cs.fontStyle;
    if (cs.textDecoration) s.textDecoration = cs.textDecoration;
    if (cs.textAlign) s.textAlign = cs.textAlign;
    if (cs.backgroundColor) s.backgroundColor = cs.backgroundColor;
    if (cs.width) s.width = cs.width;
    if (cs.fontWeight === 'bold' || /^[6-9]\d\d$/.test(cs.fontWeight) || cs.fontWeight === '600' || cs.fontWeight === '700' || cs.fontWeight === '800' || cs.fontWeight === '900') {
      s.bold = true;
    }
    if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') s.italic = true;
    return s;
  }

  // CSS color → 6-char hex (no #). Returns null if unrecognized.
  function cssColorToHex(c) {
    if (!c) return null;
    c = String(c).trim();
    if (!c) return null;
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) {
      return (c[1]+c[1]+c[2]+c[2]+c[3]+c[3]).toUpperCase();
    }
    var rgb = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) {
      return [rgb[1], rgb[2], rgb[3]].map(function(n) {
        var h = (parseInt(n, 10) || 0).toString(16).toUpperCase();
        return h.length === 1 ? '0' + h : h;
      }).join('');
    }
    var named = {
      'black': '000000', 'white': 'FFFFFF', 'red': 'FF0000',
      'green': '008000', 'blue': '0000FF', 'gray': '808080', 'grey': '808080'
    };
    if (named[c.toLowerCase()]) return named[c.toLowerCase()];
    return null;
  }

  function parseSize(v) {
    if (!v) return null;
    var m = String(v).match(/^([\d.]+)\s*(pt|px|in|%)?\s*$/i);
    if (!m) return null;
    var n = parseFloat(m[1]); var unit = (m[2] || 'px').toLowerCase();
    return { value: n, unit: unit };
  }

  // Lift inline-style attributes from a block element (div, p, header,
  // etc.) into the run-formatting object that gets inherited by all of
  // its inline descendants. Without this, font-size/color set on the
  // wrapper div in patterns like
  //     <div style="font-size:12px; color:#8c1d40">ELO 1<span>...</span></div>
  // wouldn't reach any of the runs inside, since OOXML applies type to
  // runs only — divs have no equivalent.
  function runFmtFromBlock(el, inherited) {
    var out = Object.assign({}, inherited || {});
    var s = readStyle(el);
    if (s.bold) out.bold = true;
    if (s.italic) out.italic = true;
    if (s.color) {
      var hex = cssColorToHex(s.color);
      if (hex) out.color = hex;
    }
    if (s.fontSize) {
      var sz = parseSize(s.fontSize);
      if (sz) {
        var pt = sz.unit === 'px' ? pxToPt(sz.value) : sz.unit === 'pt' ? sz.value : null;
        if (pt) out.fontSizeHalfPt = ptToHalfPt(pt);
      }
    }
    return out;
  }

  // ===== DOCUMENT STATE =====
  // Tracks relationships (hyperlinks) added during conversion so we can
  // emit document.xml.rels at the end. RIDs start at 100 to leave room
  // for fixed rels (styles, numbering, settings).
  function DocState() {
    this.rels = [];         // [{id, type, target, mode?}]
    this.hyperlinks = {};   // url → rId
    this.nextRid = 100;
    this.numberingUsed = false;
  }
  DocState.prototype.addHyperlink = function(url) {
    if (!url) return null;
    if (this.hyperlinks[url]) return this.hyperlinks[url];
    var rid = 'rId' + (this.nextRid++);
    this.hyperlinks[url] = rid;
    this.rels.push({
      id: rid,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      target: url,
      mode: 'External'
    });
    return rid;
  };

  // ===== INLINE RUNS =====
  // Convert inline content (text + <strong>/<em>/<a>/<br>/<span>) into a
  // sequence of <w:r> (or <w:hyperlink>) XML strings that live inside one
  // <w:p>. fmt carries inherited formatting; child elements override.
  function emitInline(node, fmt, state, out) {
    if (!node) return;
    if (node.nodeType === 3 /* TEXT */) {
      var txt = node.nodeValue || '';
      if (!txt) return;
      out.push(emitRun(txt, fmt));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      out.push('<w:r><w:br/></w:r>');
      return;
    }
    if (tag === 'a') {
      var href = node.getAttribute('href');
      var rid = state.addHyperlink(href);
      var inner = [];
      var linkFmt = Object.assign({}, fmt, { color: '1A0DAB', underline: true });
      Array.from(node.childNodes).forEach(function(c) {
        emitInline(c, linkFmt, state, inner);
      });
      if (rid) {
        out.push('<w:hyperlink r:id="' + rid + '" w:history="1">' + inner.join('') + '</w:hyperlink>');
      } else {
        out.push(inner.join(''));
      }
      return;
    }
    var styleFmt = readStyle(node);
    var newFmt = Object.assign({}, fmt);
    if (tag === 'strong' || tag === 'b') newFmt.bold = true;
    if (tag === 'em' || tag === 'i') newFmt.italic = true;
    if (tag === 'u') newFmt.underline = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') newFmt.strike = true;
    if (tag === 'sup') newFmt.vertAlign = 'superscript';
    if (tag === 'sub') newFmt.vertAlign = 'subscript';
    if (styleFmt.bold) newFmt.bold = true;
    if (styleFmt.italic) newFmt.italic = true;
    if (styleFmt.color) {
      var hex = cssColorToHex(styleFmt.color);
      if (hex) newFmt.color = hex;
    }
    if (styleFmt.fontSize) {
      var sz = parseSize(styleFmt.fontSize);
      if (sz) {
        var pt = sz.unit === 'px' ? pxToPt(sz.value) : sz.unit === 'pt' ? sz.value : null;
        if (pt) newFmt.fontSizeHalfPt = ptToHalfPt(pt);
      }
    }
    if (styleFmt.backgroundColor) {
      var bgHex = cssColorToHex(styleFmt.backgroundColor);
      if (bgHex && bgHex !== 'FFFFFF') newFmt.highlight = bgHex;
    }
    if (/placeholder/.test(node.className || '')) {
      newFmt.italic = true;
      newFmt.color = newFmt.color || 'BBBBBB';
    }
    Array.from(node.childNodes).forEach(function(c) {
      emitInline(c, newFmt, state, out);
    });
  }

  function emitRun(text, fmt) {
    fmt = fmt || {};
    // CT_RPrBase requires elements in schema order — Google Docs's docx
    // import rejects out-of-order children silently. Order:
    //   rFonts, b, i, strike, color, sz, szCs, u, shd, vertAlign
    var rPr = [];
    rPr.push('<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>');
    if (fmt.bold) rPr.push('<w:b/>');
    if (fmt.italic) rPr.push('<w:i/>');
    if (fmt.strike) rPr.push('<w:strike/>');
    if (fmt.color) rPr.push('<w:color w:val="' + fmt.color + '"/>');
    if (fmt.fontSizeHalfPt) {
      rPr.push('<w:sz w:val="' + fmt.fontSizeHalfPt + '"/>');
      rPr.push('<w:szCs w:val="' + fmt.fontSizeHalfPt + '"/>');
    }
    if (fmt.underline) rPr.push('<w:u w:val="single"/>');
    if (fmt.highlight) rPr.push('<w:shd w:val="clear" w:color="auto" w:fill="' + fmt.highlight + '"/>');
    if (fmt.vertAlign) rPr.push('<w:vertAlign w:val="' + fmt.vertAlign + '"/>');
    var rPrXml = '<w:rPr>' + rPr.join('') + '</w:rPr>';

    // Preserve all whitespace (including leading/trailing spaces).
    // Split on newlines so we can emit <w:br/> for embedded \n.
    var parts = String(text).split(/\n/);
    var pieces = [];
    parts.forEach(function(p, i) {
      if (i > 0) pieces.push('<w:br/>');
      if (p.length === 0) return;
      pieces.push('<w:t xml:space="preserve">' + escXml(p) + '</w:t>');
    });
    return '<w:r>' + rPrXml + pieces.join('') + '</w:r>';
  }

  // ===== PARAGRAPH BUILDER =====
  // Build a <w:p> from inline children with a paragraph-properties spec:
  //   { style: 'Heading1', alignment: 'center', indentLeftTwips, numId, ilvl, keepNext }
  // CT_PPrBase requires elements in schema order — out-of-order children
  // are silently dropped by Google Docs on import. Order applied below:
  //   pStyle, keepNext, numPr, spacing, ind, jc
  function buildParagraph(inlineXml, pSpec) {
    pSpec = pSpec || {};
    var pPr = [];
    if (pSpec.style) pPr.push('<w:pStyle w:val="' + pSpec.style + '"/>');
    if (pSpec.keepNext) pPr.push('<w:keepNext/>');
    if (pSpec.numId != null) {
      pPr.push('<w:numPr>' +
        '<w:ilvl w:val="' + (pSpec.ilvl || 0) + '"/>' +
        '<w:numId w:val="' + pSpec.numId + '"/>' +
      '</w:numPr>');
    }
    if (pSpec.spacingBeforeTwips != null || pSpec.spacingAfterTwips != null || pSpec.lineTwips) {
      var attrs2 = '';
      if (pSpec.spacingBeforeTwips != null) attrs2 += ' w:before="' + pSpec.spacingBeforeTwips + '"';
      if (pSpec.spacingAfterTwips != null) attrs2 += ' w:after="' + pSpec.spacingAfterTwips + '"';
      if (pSpec.lineTwips) attrs2 += ' w:line="' + pSpec.lineTwips + '" w:lineRule="auto"';
      pPr.push('<w:spacing' + attrs2 + '/>');
    }
    if (pSpec.indentLeftTwips || pSpec.indentHangingTwips) {
      var attrs = '';
      if (pSpec.indentLeftTwips) attrs += ' w:left="' + pSpec.indentLeftTwips + '"';
      if (pSpec.indentHangingTwips) attrs += ' w:hanging="' + pSpec.indentHangingTwips + '"';
      pPr.push('<w:ind' + attrs + '/>');
    }
    if (pSpec.alignment) pPr.push('<w:jc w:val="' + pSpec.alignment + '"/>');
    var pPrXml = pPr.length ? '<w:pPr>' + pPr.join('') + '</w:pPr>' : '';
    return '<w:p>' + pPrXml + inlineXml + '</w:p>';
  }

  // ===== TABLE EXTRACTION =====
  // Walk an HTML <table> into a 2D grid that resolves rowspan/colspan into
  // cells and merge-continuation markers so OOXML <w:vMerge>/<w:hMerge>
  // can be emitted in document order.
  function extractTable(tableEl, availTwips) {
    var rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return null;

    // Column count = max sum of colspans across rows.
    var maxCols = 0;
    rows.forEach(function(tr) {
      var sum = 0;
      Array.from(tr.children).forEach(function(c) {
        sum += parseInt(c.getAttribute('colspan') || '1', 10);
      });
      if (sum > maxCols) maxCols = sum;
    });
    if (maxCols === 0) return null;

    // Initial empty grid.
    var grid = [];
    for (var i = 0; i < rows.length; i++) {
      var r = new Array(maxCols);
      for (var j = 0; j < maxCols; j++) r[j] = null;
      grid.push(r);
    }

    rows.forEach(function(tr, ri) {
      var ci = 0;
      Array.from(tr.children).forEach(function(cell) {
        // Skip past columns already occupied by a vMerge from above.
        while (ci < maxCols && grid[ri][ci] !== null) ci++;
        if (ci >= maxCols) return;
        var rs = parseInt(cell.getAttribute('rowspan') || '1', 10);
        var cs = parseInt(cell.getAttribute('colspan') || '1', 10);
        for (var dr = 0; dr < rs; dr++) {
          for (var dc = 0; dc < cs; dc++) {
            var rr = ri + dr, cc = ci + dc;
            if (rr >= rows.length || cc >= maxCols) continue;
            if (dr === 0 && dc === 0) {
              grid[rr][cc] = { kind: 'cell', el: cell, rowspan: rs, colspan: cs };
            } else if (dr === 0) {
              grid[rr][cc] = { kind: 'hMerge' };  // colspan continuation
            } else {
              grid[rr][cc] = { kind: 'vMerge', isFirstCol: (dc === 0) };
            }
          }
        }
        ci += cs;
      });
    });

    // Column widths: read from first-row <th>/<td> inline styles. We
    // accept three units and normalize each to a percentage of the
    // available table width:
    //   - %   → used as-is
    //   - px  → converted at 1px = 15 twips (96dpi → 1pt = 1.333px)
    //   - pt  → converted at 1pt = 20 twips
    //   - in  → converted at 1in = 1440 twips
    // Columns without a width hint share the leftover percentage equally.
    // Without the px branch, e.g. width:80px hints in the alignment-
    // traceability HTML were silently dropped, leaving every column at
    // 1/N of the table width — the MLO id column came out way too wide.
    var totalTwips = availTwips || inToTwips(7.5);
    var colWidths = new Array(maxCols);
    var firstRow = grid[0];
    for (var c = 0; c < maxCols; c++) {
      var item = firstRow[c];
      if (!item || item.kind !== 'cell') continue;
      var w = item.el.style && item.el.style.width;
      var sz = parseSize(w);
      if (!sz) continue;
      var pct = null;
      if (sz.unit === '%') {
        pct = sz.value;
      } else if (sz.unit === 'px') {
        pct = (sz.value * 15 / totalTwips) * 100;
      } else if (sz.unit === 'pt') {
        pct = (sz.value * 20 / totalTwips) * 100;
      } else if (sz.unit === 'in') {
        pct = (sz.value * 1440 / totalTwips) * 100;
      }
      if (pct == null) continue;
      var per = pct / item.colspan;
      for (var k = 0; k < item.colspan; k++) {
        colWidths[c + k] = { kind: '%', value: per };
      }
    }
    var assigned = 0, unassigned = 0;
    for (var cc = 0; cc < maxCols; cc++) {
      if (colWidths[cc]) assigned += colWidths[cc].value;
      else unassigned++;
    }
    if (unassigned > 0) {
      var remain = Math.max(0, 100 - assigned);
      var per2 = unassigned > 0 ? remain / unassigned : 0;
      for (var cd = 0; cd < maxCols; cd++) {
        if (!colWidths[cd]) colWidths[cd] = { kind: '%', value: per2 || (100 / maxCols) };
      }
    }
    var colTwips = colWidths.map(function(cw) {
      return Math.max(400, Math.round(totalTwips * (cw.value / 100)));
    });

    return { grid: grid, colTwips: colTwips, totalTwips: colTwips.reduce(function(a, b) { return a + b; }, 0) };
  }

  // ===== TABLE EMISSION =====
  function emitTable(tableEl, ctx, state) {
    var availTwips = ctx.contentTwips || inToTwips(7.5);
    var t = extractTable(tableEl, availTwips);
    if (!t) return '';
    var rows = t.grid;
    var colTwips = t.colTwips;

    // Table-level properties match the user's hand-edited TPH 501.docx:
    //   borders: single 0.75pt (sz=6) #CCCCCC on all sides + inside lines
    //   layout : fixed (so column widths in <w:tblGrid> are honored)
    //   width  : full content area (filled to right margin)
    //   cell margins (tblCellMar): 60 / 120 / 60 / 120 — tighter than the
    //     OOXML default of 0/108/0/108 so cells aren't airy on 9pt text.
    var tblPr = '<w:tblPr>' +
      '<w:tblW w:w="' + t.totalTwips + '" w:type="dxa"/>' +
      '<w:tblBorders>' +
        '<w:top w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>' +
        '<w:left w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>' +
        '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>' +
        '<w:right w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>' +
        '<w:insideH w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>' +
        '<w:insideV w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>' +
      '</w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar>' +
        '<w:top w:w="60" w:type="dxa"/>' +
        '<w:left w:w="120" w:type="dxa"/>' +
        '<w:bottom w:w="60" w:type="dxa"/>' +
        '<w:right w:w="120" w:type="dxa"/>' +
      '</w:tblCellMar>' +
    '</w:tblPr>';

    var tblGrid = '<w:tblGrid>' + colTwips.map(function(w) {
      return '<w:gridCol w:w="' + w + '"/>';
    }).join('') + '</w:tblGrid>';

    var tblRows = rows.map(function(row, ri) {
      var cellsXml = [];
      var ci = 0;
      while (ci < row.length) {
        var item = row[ci];
        if (!item) { ci++; continue; }
        if (item.kind === 'hMerge') { ci++; continue; }
        if (item.kind === 'vMerge') {
          // Continuation of a vertically-merged cell from above. Emit an
          // empty cell with <w:vMerge/> and the column's width.
          cellsXml.push(
            '<w:tc>' +
              '<w:tcPr>' +
                '<w:tcW w:w="' + colTwips[ci] + '" w:type="dxa"/>' +
                '<w:vMerge/>' +
                '<w:vAlign w:val="top"/>' +
              '</w:tcPr>' +
              '<w:p><w:pPr><w:pStyle w:val="TableCell"/></w:pPr></w:p>' +
            '</w:tc>'
          );
          ci++;
          continue;
        }
        // 'cell': may have colspan + rowspan.
        var cell = item;
        var spanWidth = 0;
        for (var s = 0; s < cell.colspan; s++) spanWidth += colTwips[ci + s] || 0;
        // CT_TcPr schema order: tcW, gridSpan, vMerge, shd, vAlign.
        var tcPr = ['<w:tcW w:w="' + spanWidth + '" w:type="dxa"/>'];
        if (cell.colspan > 1) tcPr.push('<w:gridSpan w:val="' + cell.colspan + '"/>');
        if (cell.rowspan > 1) tcPr.push('<w:vMerge w:val="restart"/>');
        // <th>: header background. Cells default to top-aligned to match
        // the user's reference doc (Google Docs's default is center).
        var isHeader = cell.el.tagName.toLowerCase() === 'th';
        var bg = isHeader ? 'F5F5F0' : null;
        var styleBg = cell.el.style && cell.el.style.backgroundColor;
        var bgFromStyle = styleBg ? cssColorToHex(styleBg) : null;
        if (bgFromStyle) bg = bgFromStyle;
        if (bg) tcPr.push('<w:shd w:val="clear" w:color="auto" w:fill="' + bg + '"/>');
        tcPr.push('<w:vAlign w:val="top"/>');

        var bodyXml = blocksFromContainer(cell.el, Object.assign({}, ctx, {
          inTable: true,
          contentTwips: spanWidth,
          cellIsHeader: isHeader,
          baseFont: { sizeHalfPt: 18 } // 9pt cells
        }), state);
        if (!bodyXml.trim()) {
          // OOXML requires every cell to contain at least one <w:p>.
          bodyXml = '<w:p><w:pPr><w:pStyle w:val="TableCell"/></w:pPr></w:p>';
        }
        cellsXml.push(
          '<w:tc>' +
            '<w:tcPr>' + tcPr.join('') + '</w:tcPr>' +
            bodyXml +
          '</w:tc>'
        );
        ci += cell.colspan;
      }
      return '<w:tr>' + cellsXml.join('') + '</w:tr>';
    }).join('');

    return '<w:tbl>' + tblPr + tblGrid + tblRows + '</w:tbl>';
  }

  // ===== BLOCK CONVERSION =====
  // Walk a container element's children and emit OOXML block XML
  // (paragraphs + tables) in document order.
  function blocksFromContainer(container, ctx, state) {
    if (!container) return '';
    ctx = ctx || {};
    var out = [];
    Array.from(container.childNodes).forEach(function(node) {
      out.push(blockFromNode(node, ctx, state));
    });
    return out.join('');
  }

  function blockFromNode(node, ctx, state) {
    if (!node) return '';
    if (node.nodeType === 3) {
      // Bare text node at block level: wrap in a normal paragraph if
      // non-whitespace, otherwise drop.
      var t = (node.nodeValue || '').replace(/^\s+|\s+$/g, '');
      if (!t) return '';
      var inlineOut = [];
      emitInline(node, ctx.baseFont || {}, state, inlineOut);
      return buildParagraph(inlineOut.join(''), { style: ctx.cellIsHeader ? 'TableHeader' : (ctx.inTable ? 'TableCell' : 'Normal') });
    }
    if (node.nodeType !== 1) return '';
    var tag = node.tagName.toLowerCase();

    // Headings.
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      var level = parseInt(tag.slice(1), 10);
      var styleName = 'Heading' + level;
      var inlineOut = [];
      Array.from(node.childNodes).forEach(function(c) {
        emitInline(c, ctx.baseFont || {}, state, inlineOut);
      });
      var spec = { style: styleName, keepNext: true };
      if (level === 1) spec.alignment = 'center';
      // h3 in our worksheet is a sub-heading under h2; indent it 0.5".
      if (level === 3 && !ctx.inTable) spec.indentLeftTwips = inToTwips(0.5);
      return buildParagraph(inlineOut.join(''), spec);
    }

    if (tag === 'table') {
      // Block-level: tables can't appear in a w:p, so emit a real <w:tbl>.
      // OOXML also requires a paragraph after every table to "close" the
      // section, otherwise tables consume document.xml's final paragraph.
      var tblXml = emitTable(node, ctx, state);
      if (ctx.inTable) {
        // Nested tables aren't supported here; flatten to text instead.
        return ''; // skip
      }
      return tblXml + '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>';
    }

    if (tag === 'ul' || tag === 'ol') {
      state.numberingUsed = true;
      var numId = (tag === 'ol') ? 2 : 1;
      var out = [];
      Array.from(node.children).forEach(function(li) {
        if (li.tagName && li.tagName.toLowerCase() === 'li') {
          var inlineOut = [];
          Array.from(li.childNodes).forEach(function(c) {
            // Nested lists/tables inside <li> become subsequent blocks.
            if (c.nodeType === 1 && (c.tagName.toLowerCase() === 'ul' || c.tagName.toLowerCase() === 'ol' || c.tagName.toLowerCase() === 'table')) {
              return;
            }
            emitInline(c, ctx.baseFont || {}, state, inlineOut);
          });
          out.push(buildParagraph(inlineOut.join(''), {
            style: ctx.inTable ? 'TableCell' : 'ListItem',
            numId: numId,
            ilvl: 0
          }));
          // Emit nested blocks as separate paragraphs (no list numbering).
          Array.from(li.childNodes).forEach(function(c) {
            if (c.nodeType !== 1) return;
            var ct = c.tagName.toLowerCase();
            if (ct === 'ul' || ct === 'ol' || ct === 'table') {
              out.push(blockFromNode(c, ctx, state));
            }
          });
        }
      });
      return out.join('');
    }

    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'header' || tag === 'footer') {
      // If the element has block-level children (table, ul, ol, p), recurse;
      // otherwise treat as a paragraph itself. Block-level children inherit
      // this element's run formatting (font-size/color/bold) via ctx.baseFont
      // so e.g. an outer div with font-size:12px reaches every nested run.
      var hasBlockChild = Array.from(node.children).some(function(c) {
        var ct = c.tagName.toLowerCase();
        return ct === 'table' || ct === 'ul' || ct === 'ol' || ct === 'p' || ct === 'div' || /^h[1-6]$/.test(ct);
      });
      var inheritedFmt = runFmtFromBlock(node, ctx.baseFont);
      if (hasBlockChild) {
        return blocksFromContainer(node, Object.assign({}, ctx, { baseFont: inheritedFmt }), state);
      }
      var inlineOut = [];
      Array.from(node.childNodes).forEach(function(c) {
        emitInline(c, inheritedFmt, state, inlineOut);
      });
      var sty = readStyle(node);
      var className = node.className || '';
      var spec = { style: ctx.cellIsHeader ? 'TableHeader' : (ctx.inTable ? 'TableCell' : 'Normal') };
      if (/doc-subtitle/.test(className)) {
        spec = { style: 'Subtitle', alignment: 'center' };
      }
      if (sty.textAlign) spec.alignment = sty.textAlign;
      return buildParagraph(inlineOut.join(''), spec);
    }

    if (tag === 'br') {
      // Bare <br> at block level: emit an empty paragraph.
      return '<w:p/>';
    }

    if (tag === 'hr') {
      // No native <w:hr>; emit a paragraph with a bottom border.
      return '<w:p><w:pPr>' +
        '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr>' +
      '</w:pPr></w:p>';
    }

    if (tag === 'span' || tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'a') {
      // Bare inline at block level: wrap in a Normal paragraph.
      var inlineOut2 = [];
      emitInline(node, ctx.baseFont || {}, state, inlineOut2);
      return buildParagraph(inlineOut2.join(''), { style: ctx.inTable ? 'TableCell' : 'Normal' });
    }

    // Unknown / unsupported: recurse so children still render.
    return blocksFromContainer(node, ctx, state);
  }

  // ===== STATIC PARTS =====
  function buildContentTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
  }

  function buildRootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
  }

  function buildDocRels(state) {
    var fixed = [
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
    ];
    var extras = state.rels.map(function(r) {
      return '<Relationship Id="' + r.id + '"' +
        ' Type="' + r.type + '"' +
        ' Target="' + escAttr(r.target) + '"' +
        (r.mode ? ' TargetMode="' + r.mode + '"' : '') +
      '/>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        fixed.concat(extras).join('') +
      '</Relationships>';
  }

  function buildSettings() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:zoom w:percent="100"/>' +
        '<w:defaultTabStop w:val="720"/>' +
        '<w:characterSpacingControl w:val="doNotCompress"/>' +
        '<w:compat>' +
          '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
        '</w:compat>' +
      '</w:settings>';
  }

  function buildCoreProps(opts) {
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties' +
        ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
        ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
        ' xmlns:dcterms="http://purl.org/dc/terms/"' +
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + escXml(opts.title || '') + '</dc:title>' +
        '<dc:creator>' + escXml(opts.creator || 'Course Worksheet') + '</dc:creator>' +
        '<cp:lastModifiedBy>' + escXml(opts.creator || 'Course Worksheet') + '</cp:lastModifiedBy>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function buildAppProps() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
        ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>Course Worksheet</Application>' +
      '</Properties>';
  }

  function buildStyles() {
    // All sizes/spacing/indents below are ported from the instructor's
    // hand-edited TPH 501.docx (May 2026). Dimensions are in twips (1/1440").
    // Font sizes use w:sz half-points (e.g. sz=20 → 10pt).
    //
    //   H1 (Course Development Document)  18pt centered maroon, no indent
    //   Subtitle (TPH 501 — ...)          10pt gray center, no indent
    //   Body paragraphs                   10pt, left=720 (0.5"), line=348
    //   H2 (Course Description, etc.)     13pt maroon bold, no indent
    //   H3 (Students will learn...)       11pt bold, left=720
    //   List items (CLOs / ELOs)          12pt, left=1440 hanging=270, line=360
    //   Table cells                       9pt, no indent, after=60 before=60
    //   Table header cells                9pt bold, fill #f5f5f0
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults>' +
          '<w:rPrDefault><w:rPr>' +
            '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
            '<w:color w:val="333333"/>' +
            '<w:sz w:val="20"/><w:szCs w:val="20"/>' +
          '</w:rPr></w:rPrDefault>' +
          '<w:pPrDefault><w:pPr>' +
            '<w:spacing w:after="80" w:before="0" w:line="348" w:lineRule="auto"/>' +
          '</w:pPr></w:pPrDefault>' +
        '</w:docDefaults>' +
        // Normal — body paragraph indented to match H3 gutter (0.5").
        '<w:style w:type="paragraph" w:styleId="Normal" w:default="1">' +
          '<w:name w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:spacing w:after="80" w:before="0" w:line="348" w:lineRule="auto"/>' +
            '<w:ind w:left="720" w:right="0" w:firstLine="0"/>' +
          '</w:pPr>' +
        '</w:style>' +
        // Heading1 — page title (centered, 18pt maroon, no indent).
        // before=240 leaves a clear blank line above the title even when
        // the page top margin is tight (e.g., when a print engine clips
        // the first few twips). Mostly cosmetic on the front cover.
        '<w:style w:type="paragraph" w:styleId="Heading1">' +
          '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:keepNext/>' +
            // before=600 (~30pt) gives a clear gap above each major section
            // heading (e.g. "Class Expectations"), matching the roomier
            // preview spacing.
            '<w:spacing w:after="60" w:before="600" w:line="312" w:lineRule="auto"/>' +
            '<w:ind w:left="0" w:right="0" w:firstLine="0"/>' +
            '<w:jc w:val="center"/>' +
            '<w:outlineLvl w:val="0"/>' +
          '</w:pPr>' +
          '<w:rPr>' +
            '<w:b/>' +
            '<w:color w:val="8C1D40"/>' +
            '<w:sz w:val="36"/><w:szCs w:val="36"/>' +
          '</w:rPr>' +
        '</w:style>' +
        // Heading2 — section header (13pt maroon bold, flush left).
        // before=360 (~1.5 lines of 10pt body) gives a clear visual
        // break before each maroon section heading, matching the
        // "extra blank line above all maroon text" preference.
        '<w:style w:type="paragraph" w:styleId="Heading2">' +
          '<w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:keepNext/>' +
            // before=480 (~24pt) — a clear break above each maroon section
            // sub-heading, matching the preview's bumped h2 spacing.
            '<w:spacing w:after="90" w:before="480"/>' +
            '<w:ind w:left="0" w:right="0" w:firstLine="0"/>' +
            '<w:outlineLvl w:val="1"/>' +
          '</w:pPr>' +
          '<w:rPr>' +
            '<w:b/>' +
            '<w:color w:val="8C1D40"/>' +
            '<w:sz w:val="26"/><w:szCs w:val="26"/>' +
          '</w:rPr>' +
        '</w:style>' +
        // Heading3 — sub-section header (11pt bold, indent matches body).
        // before=240 gives a blank-line gap from the previous block (so
        // module titles read as a fresh visual section after a table).
        '<w:style w:type="paragraph" w:styleId="Heading3">' +
          '<w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:keepNext/>' +
            '<w:spacing w:after="90" w:before="240"/>' +
            '<w:ind w:left="720" w:right="0" w:firstLine="0"/>' +
            '<w:outlineLvl w:val="2"/>' +
          '</w:pPr>' +
          '<w:rPr>' +
            '<w:b/>' +
            '<w:sz w:val="22"/><w:szCs w:val="22"/>' +
          '</w:rPr>' +
        '</w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading4">' +
          '<w:name w:val="heading 4"/><w:basedOn w:val="Heading3"/><w:next w:val="Normal"/>' +
          '<w:pPr><w:outlineLvl w:val="3"/></w:pPr>' +
          '<w:rPr><w:i/></w:rPr>' +
        '</w:style>' +
        // Subtitle — for .doc-subtitle paragraphs under H1 (10pt gray center).
        '<w:style w:type="paragraph" w:styleId="Subtitle">' +
          '<w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:spacing w:after="360" w:before="0"/>' +
            '<w:ind w:left="0" w:right="0" w:firstLine="0"/>' +
            '<w:jc w:val="center"/>' +
          '</w:pPr>' +
          '<w:rPr>' +
            '<w:color w:val="666666"/>' +
            '<w:sz w:val="20"/><w:szCs w:val="20"/>' +
          '</w:rPr>' +
        '</w:style>' +
        // ListItem — numbered/bulleted list paragraph. 12pt, indent-and-hang
        // tuned to match her CLO list (left=1440 = 1", hanging=270 ≈ 0.19").
        '<w:style w:type="paragraph" w:styleId="ListItem">' +
          '<w:name w:val="List Item"/><w:basedOn w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:spacing w:after="0" w:before="0" w:line="360" w:lineRule="auto"/>' +
            '<w:ind w:left="1440" w:right="0" w:hanging="270"/>' +
          '</w:pPr>' +
          '<w:rPr>' +
            '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
          '</w:rPr>' +
        '</w:style>' +
        // TableCell — body paragraph inside a table cell (9pt, no indent).
        '<w:style w:type="paragraph" w:styleId="TableCell">' +
          '<w:name w:val="Table Cell"/><w:basedOn w:val="Normal"/>' +
          '<w:pPr>' +
            '<w:spacing w:after="60" w:before="60" w:line="276" w:lineRule="auto"/>' +
            '<w:ind w:left="0" w:right="0" w:firstLine="0"/>' +
          '</w:pPr>' +
          '<w:rPr>' +
            '<w:sz w:val="18"/><w:szCs w:val="18"/>' +
          '</w:rPr>' +
        '</w:style>' +
        // TableHeader — for <th> cells (bold).
        '<w:style w:type="paragraph" w:styleId="TableHeader">' +
          '<w:name w:val="Table Header"/><w:basedOn w:val="TableCell"/>' +
          '<w:rPr><w:b/></w:rPr>' +
        '</w:style>' +
        // Hyperlink character style.
        '<w:style w:type="character" w:styleId="Hyperlink">' +
          '<w:name w:val="Hyperlink"/>' +
          '<w:rPr>' +
            '<w:color w:val="1A0DAB"/>' +
            '<w:u w:val="single"/>' +
          '</w:rPr>' +
        '</w:style>' +
      '</w:styles>';
  }

  function buildNumbering() {
    // Two abstracts: bullet (•) and decimal. Each gets its own w:num so we
    // can reference them by numId 1 (bullet) and 2 (decimal) in document.xml.
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:abstractNum w:abstractNumId="0">' +
          '<w:lvl w:ilvl="0">' +
            '<w:start w:val="1"/>' +
            '<w:numFmt w:val="bullet"/>' +
            '<w:lvlText w:val="•"/>' +
            '<w:lvlJc w:val="left"/>' +
            '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>' +
          '</w:lvl>' +
        '</w:abstractNum>' +
        '<w:abstractNum w:abstractNumId="1">' +
          '<w:lvl w:ilvl="0">' +
            '<w:start w:val="1"/>' +
            '<w:numFmt w:val="decimal"/>' +
            '<w:lvlText w:val="%1."/>' +
            '<w:lvlJc w:val="left"/>' +
            '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>' +
          '</w:lvl>' +
        '</w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
        '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      '</w:numbering>';
  }

  function buildDocumentXml(bodyXml, opts) {
    // Asymmetric page margins ported from the user's hand-edited
    // TPH 501.docx (May 2026):
    //   top    = 994 twips ≈ 0.69" — title sits ~0.7" from page top
    //   right  = 1440         = 1.0" — wide right margin for breathing room
    //   bottom = 1440         = 1.0"
    //   left   = 720          = 0.5" — narrow left so body sits in same
    //                                 gutter as H3 sub-headings (also 720)
    //   header = 0
    //   footer = 720          = 0.5"
    // These defaults can be overridden via opts.margins{ top,right,bottom,left }.
    var m = opts.margins || {};
    var top    = m.topTwips    != null ? m.topTwips    : 994;
    var right  = m.rightTwips  != null ? m.rightTwips  : 1440;
    var bottom = m.bottomTwips != null ? m.bottomTwips : 1440;
    var left   = m.leftTwips   != null ? m.leftTwips   : 720;
    var pgSz = '<w:pgSz w:w="' + PAGE_W_TWIPS + '" w:h="' + PAGE_H_TWIPS + '"/>';
    var pgMar = '<w:pgMar' +
      ' w:top="' + top + '"' +
      ' w:right="' + right + '"' +
      ' w:bottom="' + bottom + '"' +
      ' w:left="' + left + '"' +
      ' w:header="0"' +
      ' w:footer="720"' +
      ' w:gutter="0"/>';
    var sectPr = '<w:sectPr>' + pgSz + pgMar + '<w:cols w:space="708"/></w:sectPr>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document' +
        ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
        ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"' +
        ' xmlns:o="urn:schemas-microsoft-com:office:office"' +
        ' xmlns:v="urn:schemas-microsoft-com:office:vml"' +
        ' xmlns:w10="urn:schemas-microsoft-com:office:word"' +
        '>' +
        '<w:body>' +
          bodyXml +
          sectPr +
        '</w:body>' +
      '</w:document>';
  }

  // ===== ENTRY POINTS =====
  function elementToBlob(htmlElement, options) {
    options = options || {};
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('JSZip is required for .docx export but was not loaded.'));
    }
    // Resolved margins drive (a) the page <w:pgMar> for body-text wrapping
    // and (b) the table fill width. Body text wraps at the actual right
    // margin (1.0" by default), but tables intentionally bleed into the
    // right margin to use the full 0.5"-to-0.5" page area — that's how
    // the user's hand-edited reference is laid out, and trying to keep
    // tables within the body-text margin made the assignment column too
    // narrow for multi-line activity titles.
    var m = (options.margins || {});
    var leftTw  = m.leftTwips  != null ? m.leftTwips  : 720;
    var rightTw = m.rightTwips != null ? m.rightTwips : 1440;
    // Tables span left margin → 0.5" from the right edge of the page.
    var tableRightInsetTw = m.tableRightInsetTwips != null ? m.tableRightInsetTwips : 720;
    var contentTwips = PAGE_W_TWIPS - leftTw - tableRightInsetTw;
    var state = new DocState();
    var ctx = { contentTwips: contentTwips, baseFont: {} };
    var bodyXml = blocksFromContainer(htmlElement, ctx, state);
    // OOXML requires the body to end with a paragraph (the sectPr lives
    // inside the final paragraph in some docs; here we put sectPr as a
    // direct child of w:body so a trailing empty paragraph isn't strictly
    // required, but many viewers prefer one).
    if (!/<w:p[\s/>]/.test(bodyXml.slice(-32))) {
      bodyXml += '<w:p/>';
    }
    var documentXml = buildDocumentXml(bodyXml, { margins: m });

    var zip = new JSZip();
    zip.file('[Content_Types].xml', buildContentTypes());
    zip.folder('_rels').file('.rels', buildRootRels());
    zip.folder('docProps').file('core.xml', buildCoreProps(options));
    zip.folder('docProps').file('app.xml', buildAppProps());
    var word = zip.folder('word');
    word.file('document.xml', documentXml);
    word.file('styles.xml', buildStyles());
    word.file('numbering.xml', buildNumbering());
    word.file('settings.xml', buildSettings());
    word.folder('_rels').file('document.xml.rels', buildDocRels(state));

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE'
    });
  }

  function htmlStringToBlob(htmlString, options) {
    var holder = document.createElement('div');
    holder.innerHTML = htmlString;
    return elementToBlob(holder, options);
  }

  window.DocxExport = {
    elementToBlob: elementToBlob,
    htmlStringToBlob: htmlStringToBlob,
    DOCX_MIME: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
})();
