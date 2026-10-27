import type { Child } from "hono/jsx";

const css = `
:root{color-scheme:light dark;--bg:#fafafa;--fg:#18181b;--muted:#71717a;--card:#fff;--line:#e4e4e7;--accent:#18181b;--accent-fg:#fff;--danger:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--card:#18181b;--line:#27272a;--accent:#fafafa;--accent-fg:#18181b;--danger:#f87171}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:1.25rem;margin:0 0 4px}
p{margin:0 0 16px;color:var(--muted);font-size:.9rem}
label{display:block;font-size:.85rem;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{width:100%;margin-top:16px;padding:10px 12px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line);margin-top:10px}
.error{margin:12px 0 0;padding:10px 12px;border:1px solid var(--danger);border-radius:8px;color:var(--danger);font-size:.9rem}
hr{border:0;border-top:1px solid var(--line);margin:20px 0 4px}
`;

export function Layout(props: { title: string; nonce: string; children?: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title}</title>
        <style nonce={props.nonce} dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
