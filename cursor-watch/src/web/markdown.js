/**
 * Minimal Markdown → HTML for Attachment preview (headings, lists, tables, code, paras).
 * Escapes HTML in text; not a full CommonMark engine.
 */
export function renderMarkdown(src) {
  const text = String(src ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const html = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let listType = null; // "ul" | "ol"
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join(" ").trim();
    if (joined) html.push(`<p>${inlineFormat(joined)}</p>`);
    para = [];
  };

  const flushList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  const flushCode = () => {
    if (!inCode) return;
    const body = escapeHtml(codeLines.join("\n"));
    html.push(`<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ""}>${body}</code></pre>`);
    inCode = false;
    codeLang = "";
    codeLines = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushPara();
      flushList();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineFormat(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    const tableHtml = tryRenderTable(lines, i);
    if (tableHtml) {
      flushPara();
      flushList();
      html.push(tableHtml.html);
      i = tableHtml.nextIndex;
      continue;
    }

    const ul = /^[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineFormat(ul[1].trim())}</li>`);
      i += 1;
      continue;
    }

    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineFormat(ol[2].trim())}</li>`);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      i += 1;
      continue;
    }

    flushList();
    para.push(line.trim());
    i += 1;
  }

  flushCode();
  flushPara();
  flushList();
  return html.join("\n") || "<p></p>";
}

/** GFM pipe table: header + delimiter (`---`) + optional body rows. */
function tryRenderTable(lines, start) {
  if (start + 1 >= lines.length) return null;
  const headerLine = lines[start];
  if (!headerLine.includes("|")) return null;
  const aligns = parseDelimiterAlignments(lines[start + 1]);
  if (!aligns) return null;
  const headers = splitTableCells(headerLine);
  if (!headers.length || headers.length !== aligns.length) return null;

  const out = ["<table>", "<thead>", "<tr>"];
  for (let c = 0; c < headers.length; c++) {
    out.push(`<th${alignAttr(aligns[c])}>${inlineFormat(headers[c])}</th>`);
  }
  out.push("</tr>", "</thead>");

  let i = start + 2;
  const body = [];
  while (i < lines.length) {
    const rowLine = lines[i];
    if (!rowLine.trim() || !rowLine.includes("|")) break;
    body.push(splitTableCells(rowLine));
    i += 1;
  }

  if (body.length) {
    out.push("<tbody>");
    for (const cells of body) {
      out.push("<tr>");
      for (let c = 0; c < headers.length; c++) {
        out.push(`<td${alignAttr(aligns[c])}>${inlineFormat(cells[c] ?? "")}</td>`);
      }
      out.push("</tr>");
    }
    out.push("</tbody>");
  }
  out.push("</table>");
  return { html: out.join(""), nextIndex: i };
}

function splitTableCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

function parseDelimiterAlignments(line) {
  if (!line.includes("|")) return null;
  const cells = splitTableCells(line);
  if (!cells.length) return null;
  const aligns = [];
  for (const cell of cells) {
    const token = cell.replace(/\s/g, "");
    if (!/^:?-{3,}:?$/.test(token)) return null;
    const left = token.startsWith(":");
    const right = token.endsWith(":");
    aligns.push(left && right ? "center" : right ? "right" : "left");
  }
  return aligns;
}

function alignAttr(align) {
  return align && align !== "left" ? ` align="${align}"` : "";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineFormat(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}
