import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/web/markdown.js";

describe("renderMarkdown", () => {
  it("renders heading list and code", () => {
    const html = renderMarkdown("# Title\n\n- a\n- b\n\n```js\nconst x = 1;\n```\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<pre><code");
    expect(html).toContain("const x = 1;");
  });

  it("escapes raw html", () => {
    expect(renderMarkdown("<script>x</script>")).toContain("&lt;script&gt;");
    const table = renderMarkdown("| a |\n|---|\n| <script>x</script> |\n");
    expect(table).toContain("&lt;script&gt;");
    expect(table).not.toContain("<script>");
  });

  it("renders GFM pipe tables", () => {
    const html = renderMarkdown(
      "| 层 | 行为 |\n|---|---|\n| 属性 | `is_increment_field` |\n",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>层</th>");
    expect(html).toContain("<th>行为</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>属性</td>");
    expect(html).toContain("<td><code>is_increment_field</code></td>");
    expect(html).not.toContain("| 层 | 行为 |");
  });

  it("leaves pipe text as a paragraph when there is no delimiter row", () => {
    const html = renderMarkdown("a | b | c\n");
    expect(html).not.toContain("<table>");
    expect(html).toContain("<p>");
  });
});
