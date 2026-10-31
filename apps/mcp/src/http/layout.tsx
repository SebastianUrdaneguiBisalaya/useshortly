import type { Child } from 'hono/jsx';

const css = `
:root{--background:#fff;--foreground:#0a0a0a;--foreground-secondary:rgb(0 0 0/64%);--border:rgb(0 0 0/10%);--hover:rgb(0 0 0/5%);--ring:var(--foreground);--destructive:#eb5757;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--background:#0a0a0a;--foreground:#fff;--foreground-secondary:rgb(255 255 255/56%);--border:rgb(255 255 255/10%);--hover:rgb(255 255 255/9%);--destructive:#f27979}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--background);color:var(--foreground);font:400 16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
main{width:100%;max-width:380px;background:var(--background);border:1px solid var(--border);border-radius:8px;padding:28px 24px}
h1{margin:0 0 4px;font-size:1.25rem;font-weight:600;line-height:1.3}
p{margin:0 0 20px;font-size:.875rem;color:var(--foreground-secondary)}
label{display:block;margin:12px 0 6px;font-size:.875rem;font-weight:500}
input{display:block;width:100%;padding:8px 12px;font:inherit;font-size:.875rem;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:6px;outline:0;transition:border-color .15s ease-in-out}
input:focus{border-color:var(--ring)}
input[type=checkbox]{accent-color:var(--foreground)}
button{display:flex;align-items:center;justify-content:center;width:100%;margin-top:14px;padding:8px 16px;font:inherit;font-size:.875rem;font-weight:500;line-height:1;color:var(--background);background:var(--foreground);border:1px solid var(--foreground);border-radius:8px;cursor:pointer;transition:opacity .3s ease-in-out,background-color .15s ease-in-out}
button:hover{opacity:.85}
button:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
button.secondary{color:var(--foreground);background:transparent;border-color:var(--border);margin-top:10px}
button.secondary:hover{opacity:1;background:var(--hover)}
.error{margin:14px 0 0;font-size:.75rem;color:var(--destructive)}
ul.scopes{list-style:none;padding:0;margin:16px 0}
li.scope{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;font-size:.875rem}
li.scope input{width:auto;margin-top:4px}
li.scope label{margin:0;font-weight:500}
li.scope small{display:block;font-weight:400;color:var(--foreground-secondary)}
.who{font-weight:600;color:var(--foreground);word-break:break-all}
.row{display:flex;gap:10px}
.row button{margin-top:0}
hr{border:0;border-top:1px solid var(--border);margin:20px 0 4px}
`;

export function Layout(props: { title: string; nonce: string; children?: Child }) {
	return (
		<html lang='en'>
			<head>
				<meta charset='utf-8' />
				<meta name='viewport' content='width=device-width, initial-scale=1' />
				<meta name='robots' content='noindex' />
				<title>{props.title}</title>
				<style nonce={props.nonce} dangerouslySetInnerHTML={{ __html: css }} />
			</head>
			<body>
				<main>{props.children}</main>
			</body>
		</html>
	);
}
