import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const distDir = resolve(root, 'dist');
const docsDir = resolve(root, 'docs');

if (!existsSync(distDir)) {
  throw new Error('dist folder not found. Run build before preparing Pages output.');
}

rmSync(docsDir, { recursive: true, force: true });
mkdirSync(docsDir, { recursive: true });
cpSync(distDir, docsDir, { recursive: true });

// Ensure GitHub Pages serves static files as-is.
writeFileSync(resolve(docsDir, '.nojekyll'), '');

console.log('Prepared docs/ from dist/ for Deploy-from-branch mode.');
