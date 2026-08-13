# Library attachment：允许 .html + 预览按类型分流

ADR 0006 把馆藏附件限为 `.md`，预览只走面板内只读 Markdown，并排除「默认 App 打开」作主路径。现扩展为：可绑定 **`.md` 与 `.html`**（不含 `.htm`），同一有序去重路径列表混排；整理面文案称「附件」。**Attachment preview** 按扩展名分流——`.md` 仍面板内只读渲染；`.html` 用**系统默认浏览器**打开本地文件。按钮统一叫「预览」；打开失败 toast，不静默、不自动改 Finder。

**Rejected:** 允许 `.htm` 或任意扩展名；md/html 拆两套附件列表；HTML 面板 iframe 作主预览；HTML 去掉「预览」只靠 Finder；失败静默或偷偷 reveal；HTML 单独「浏览器打开」文案。
