const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const THREE_VER = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules/three/package.json'), 'utf8')).version;
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VER}`;
const IMPORTMAP = `<script type="importmap">{"imports":{"three":"${CDN}/build/three.module.min.js","three/examples/jsm/":"${CDN}/examples/jsm/"}}</script>`;

function escapeScript(js) { return js.includes('</script') ? js.replace(/<\/script/g, '<\\/script') : js; }

(async () => {
  const common = { entryPoints: [path.join(__dirname, 'src/app.js')], bundle: true, minify: true, target: 'es2020', write: false, legalComments: 'none', logLevel: 'warning' };
  // published page: three.js comes from the CDN (allowed for artifacts), so the document is small and appears at once
  const cdn = await esbuild.build({ ...common, format: 'esm', external: ['three', 'three/examples/jsm/*'] });
  // local test page: everything inlined, for the sandbox, which cannot reach a CDN
  const inline = await esbuild.build({ ...common, format: 'esm' });

  const src = fs.readFileSync(path.join(__dirname, 'src/page.html'), 'utf8');
  const pageCdn = src.replace('/*IMPORTMAP*/', () => IMPORTMAP).replace('/*BUNDLE*/', () => escapeScript(cdn.outputFiles[0].text));
  const pageInline = src.replace('/*IMPORTMAP*/', '').replace('/*BUNDLE*/', () => escapeScript(inline.outputFiles[0].text));
  const skeleton = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui;background:#f7f7f5}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>' + body + '</body></html>';

  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist/frame-and-reed.html'), pageCdn);
  fs.writeFileSync(path.join(__dirname, 'dist/test.html'), skeleton(pageInline));
  fs.writeFileSync(path.join(__dirname, 'dist/test-cdn.html'), skeleton(pageCdn));
  // standalone site: a complete document for any static host (GitHub Pages, Netlify, Cloudflare Pages, a plain web server)
  const site = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="description" content="Design a 3D-printable jaw harp case from a photo or a stock size, check the fit, and download the print files.">\n<meta name="color-scheme" content="light dark">\n<title>Frame & Reed — jaw harp case builder</title>\n<style>[hidden]:not([hidden=until-found i]){display:none!important}</style>\n</head>\n<body>\n' + pageCdn.replace('<title>Frame & Reed</title>\n', '') + '\n</body>\n</html>\n';
  fs.mkdirSync(path.join(__dirname, 'dist/site'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist/site/index.html'), site);
  console.log('published page', (pageCdn.length / 1024).toFixed(0), 'KB (app', (cdn.outputFiles[0].text.length / 1024).toFixed(0), 'KB); inline test page', (pageInline.length / 1024).toFixed(0), 'KB; three', THREE_VER);
})();
