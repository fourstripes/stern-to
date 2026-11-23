import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(path.join(root, 'src/game.js'), 'utf8');
const names = [...new Set([
  ...[...source.matchAll(/\bT3\.([A-Za-z0-9_]+)/g)].map(match => match[1]),
  'REVISION', 'ShaderChunk'
])].sort();
const packageJson = JSON.parse(await readFile(path.join(root, 'node_modules/three/package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const vendor = path.join(root, 'vendor');
await mkdir(vendor, { recursive: true });
await build({
  stdin: {
    contents: `export { ${names.join(', ')} } from 'three';`,
    resolveDir: root,
    sourcefile: 'stern-to-three-entry.js',
    loader: 'js'
  },
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  legalComments: 'inline',
  outfile: path.join(vendor, 'three.module.min.js')
});
await copyFile(path.join(root, 'node_modules/three/LICENSE'), path.join(vendor, 'THREE-LICENSE.txt'));
const output = await readFile(path.join(vendor, 'three.module.min.js'));
await writeFile(path.join(vendor, 'manifest.json'), JSON.stringify({
  package: 'three',
  version: packageJson.version,
  source: `https://www.npmjs.com/package/three/v/${packageJson.version}`,
  integrity: lock.packages['node_modules/three'].integrity,
  sha256: createHash('sha256').update(output).digest('hex'),
  exports: names
}, null, 2) + '\n');
console.log(`Vendored Three.js ${packageJson.version}: ${names.length} exports, ${output.length.toLocaleString('en-AU')} bytes.`);
