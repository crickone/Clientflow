import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(here, '../../app/public');
const output = join(publicRoot, 'sites/adonisagent');
const assets = join(here, 'assets');
mkdirSync(join(output, 'assets'), { recursive: true });
for (const [source, target] of [
  ['space-grotesk-latin-400-normal.woff', 'space-grotesk.woff'],
  ['manrope-latin-400-normal.woff', 'manrope.woff'],
  ['LICENSE-space-grotesk.txt', 'LICENSE-space-grotesk.txt'],
  ['LICENSE-manrope.txt', 'LICENSE-manrope.txt'],
]) {
  copyFileSync(join(publicRoot, 'fonts', source), join(assets, target));
  copyFileSync(join(assets, target), join(output, 'assets', target));
}
copyFileSync(resolve(here, '../../brand/favicon.svg'), join(assets, 'favicon.svg'));
copyFileSync(join(assets, 'favicon.svg'), join(output, 'assets/favicon.svg'));
let html = readFileSync(join(here, 'index.html'), 'utf8');
const css = readFileSync(join(assets, 'site.css'), 'utf8');
const script = readFileSync(join(assets, 'site.js'), 'utf8');
if (/<\/script/i.test(script) || /<\/style/i.test(css)) throw new Error('Unsafe closing tag in inline asset');
html = html.replace(/<link[^>]*data-adonis-style>/, () => `<style data-adonis-style>\n${css}\n</style>`);
html = html.replace(/<script[^>]*data-adonis-script><\/script>/, () => `<script data-adonis-script>\n${script}\n</script>`);
writeFileSync(join(output, 'index.html'), html);
console.log(`Built ${html.length.toLocaleString()} characters → app/public/sites/adonisagent/index.html`);
