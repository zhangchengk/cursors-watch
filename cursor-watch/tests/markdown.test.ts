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
  });
});
