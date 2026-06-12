import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTranscodedFnt, loadTranscodedLib } from '../src/assets/assets.node.ts';
import { ovlFromJson } from '../src/assets/ovl.ts';
import { picFromJson } from '../src/assets/pic.ts';
import { defaultAssetSpec, defaultRenderSpec } from '../src/spec/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const repoDir = path.resolve(webDir, '..');
const assetDir = path.join(webDir, 'public', 'assets');
const outDir = path.join(repoDir, 'output', 'decompiled-assets');

const manifestFile = path.join(outDir, 'manifest.json');
const htmlFile = path.join(outDir, 'index.html');

function assetUrl(name) {
  return path.join(assetDir, name);
}

async function readJsonAsset(name) {
  return JSON.parse(await readFile(assetUrl(name), 'utf8'));
}

function createFontGlyphs(fontData, glyphHeight) {
  const glyphs = [];

  for (let codePoint = 0; codePoint < 256; codePoint += 1) {
    const offset = codePoint * glyphHeight;
    const rows = Array.from(fontData.slice(offset, offset + glyphHeight));
    glyphs.push({
      codePoint,
      rows,
    });
  }

  return glyphs;
}

function spriteSummary(sprite) {
  const values = [...new Set(sprite.pixels)].sort((a, b) => a - b);

  return {
    index: sprite.index,
    width: sprite.width,
    height: sprite.height,
    offset: sprite.offset,
    sizeBlocks: sprite.sizeBlocks,
    values,
    pixels: Array.from(sprite.pixels),
  };
}

function serializeForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function buildHtml(manifest) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pole Chudes 2 Decompiled Assets</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #efe7c9;
        --panel: #fff9eb;
        --border: #6e5f2d;
        --ink: #18150d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font: 14px/1.4 "PT Mono", "IBM Plex Mono", monospace;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, #fff3c7 0, rgba(255,243,199,0.2) 32%, transparent 50%),
          linear-gradient(180deg, var(--bg), #d7bf7c);
      }
      main {
        width: min(1400px, calc(100vw - 32px));
        margin: 16px auto 40px;
        display: grid;
        gap: 16px;
      }
      section {
        background: rgba(255, 249, 235, 0.95);
        border: 2px solid var(--border);
        border-radius: 10px;
        padding: 12px;
      }
      h1, h2, p { margin: 0 0 10px; }
      .sprites {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px;
      }
      .sprite-card {
        border: 1px solid #aa9a67;
        border-radius: 8px;
        padding: 8px;
        background: #fffdf5;
      }
      .sprite-card canvas {
        display: block;
        width: 100%;
        height: auto;
        image-rendering: pixelated;
        background: #000;
        border: 1px solid #333;
      }
      .font-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .font-grid canvas {
        width: 100%;
        height: auto;
        image-rendering: pixelated;
        background: #111;
        border: 1px solid #333;
      }
      .lists {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #cabb8c;
        padding: 4px 6px;
        text-align: left;
        vertical-align: top;
      }
      code {
        white-space: pre-wrap;
      }
      .meta {
        color: #5b4f28;
      }
      @media (max-width: 900px) {
        .font-grid, .lists { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Pole Chudes 2 Decompiled Assets</h1>
        <p class="meta">Generated from original DOS binaries. This viewer is for reverse-engineering/debugging, not gameplay.</p>
        <pre id="meta"></pre>
      </section>
      <section>
        <h2>Sprites</h2>
        <div id="sprites" class="sprites"></div>
      </section>
      <section>
        <h2>Fonts</h2>
        <div id="fonts" class="font-grid"></div>
      </section>
      <section>
        <h2>Questions / Leaderboard</h2>
        <div class="lists">
          <div>
            <h3>POLE.OVL</h3>
            <table>
              <thead><tr><th>#</th><th>Word</th><th>Theme</th></tr></thead>
              <tbody id="ovl"></tbody>
            </table>
          </div>
          <div>
            <h3>POLE.PIC</h3>
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>
              <tbody id="pic"></tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
    <script id="manifest" type="application/json">${serializeForHtml(manifest)}</script>
    <script type="module">
      const manifest = JSON.parse(document.querySelector('#manifest').textContent);
      const palette = manifest.render.palette;
      const meta = document.querySelector('#meta');
      const spriteRoot = document.querySelector('#sprites');
      const fontRoot = document.querySelector('#fonts');
      const ovlRoot = document.querySelector('#ovl');
      const picRoot = document.querySelector('#pic');

      meta.textContent = JSON.stringify({
        executable: manifest.asset.oracle.executableFile,
        bits: manifest.asset.oracle.executableBits,
        spriteCount: manifest.lib.spriteCount,
        questionPairs: manifest.ovl.questions.length,
        leaderboardEntries: manifest.pic.length,
      }, null, 2);

      function drawIndexed(canvas, width, height, pixels) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        for (let i = 0, j = 0; i < pixels.length; i += 1, j += 4) {
          const [r, g, b] = palette[pixels[i]];
          imageData.data[j] = r;
          imageData.data[j + 1] = g;
          imageData.data[j + 2] = b;
          imageData.data[j + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      for (const sprite of manifest.lib.sprites) {
        const card = document.createElement('article');
        card.className = 'sprite-card';
        const title = document.createElement('div');
        title.innerHTML = '<strong>#' + sprite.index + '</strong> ' + sprite.width + 'x' + sprite.height;
        const details = document.createElement('div');
        details.className = 'meta';
        details.textContent = 'blocks=' + sprite.sizeBlocks + ' values=' + sprite.values.join(',');
        const canvas = document.createElement('canvas');
        drawIndexed(canvas, sprite.width, sprite.height, sprite.pixels);
        card.append(title, details, canvas);
        spriteRoot.append(card);
      }

      for (const font of manifest.fnt) {
        const wrap = document.createElement('div');
        const title = document.createElement('div');
        title.innerHTML = '<strong>Font ' + font.height + '</strong>';
        const canvas = document.createElement('canvas');
        const cols = 16;
        const rows = 16;
        const glyphWidth = 8;
        canvas.width = cols * glyphWidth;
        canvas.height = rows * font.height;
        const pixels = new Array(canvas.width * canvas.height).fill(0);
        for (const glyph of font.glyphs) {
          const gx = (glyph.codePoint % cols) * glyphWidth;
          const gy = Math.floor(glyph.codePoint / cols) * font.height;
          glyph.rows.forEach((rowByte, rowIndex) => {
            for (let bit = 0; bit < 8; bit += 1) {
              if (rowByte & (0x80 >> bit)) {
                pixels[(gy + rowIndex) * canvas.width + gx + bit] = 15;
              }
            }
          });
        }
        drawIndexed(canvas, canvas.width, canvas.height, pixels);
        wrap.append(title, canvas);
        fontRoot.append(wrap);
      }

      ovlRoot.innerHTML = manifest.ovl.questions.slice(0, 200).map((question, index) =>
        '<tr><td>' + (index + 1) + '</td><td><code>' + question.word + '</code></td><td><code>' + question.theme + '</code></td></tr>'
      ).join('');

      picRoot.innerHTML = manifest.pic.map((entry, index) =>
        '<tr><td>' + (index + 1) + '</td><td><code>' + entry.name + '</code></td><td>' + entry.score + '</td></tr>'
      ).join('');
    </script>
  </body>
</html>
`;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const lib = await loadTranscodedLib();
  const fonts = await loadTranscodedFnt();
  const ovl = ovlFromJson(await readJsonAsset('POLE.OVL.json'));
  const pic = picFromJson(await readJsonAsset('POLE.PIC.json'));

  const manifest = {
    asset: defaultAssetSpec,
    render: {
      palette: defaultRenderSpec.palette,
    },
    lib: {
      spriteCount: lib.spriteCount,
      sprites: lib.sprites.map(spriteSummary),
    },
    fnt: [
      { height: 6, glyphs: createFontGlyphs(fonts.font6, 6) },
      { height: 8, glyphs: createFontGlyphs(fonts.font8, 8) },
      { height: 14, glyphs: createFontGlyphs(fonts.font14, 14) },
    ],
    ovl,
    pic,
  };

  await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`, 'utf8');
  await writeFile(htmlFile, `${buildHtml(manifest)}\n`, 'utf8');

  console.log(`Decompiled assets written to ${outDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
