// FND-04 documentation consistency check. Exits non-zero on any finding.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'tmp', 'test-results', 'playwright-report', '.superpowers', 'evidence']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

// 1. Instruction parity
const instructionFiles = ['AGENTS.md', 'CLAUDE.md', 'agent.md'];
const hashes = instructionFiles.map((f) => {
  if (!existsSync(f)) {
    errors.push(`missing instruction file ${f}`);
    return null;
  }
  return createHash('sha256').update(readFileSync(f)).digest('hex');
});
if (new Set(hashes).size !== 1) errors.push(`instruction files differ: ${instructionFiles.map((f, i) => `${f}=${hashes[i]?.slice(0, 12)}`).join(' ')}`);

// 2. Local Markdown links and code fences
const mdFiles = walk(root);
const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const file of mdFiles) {
  const text = readFileSync(file, 'utf8');
  const fences = text.split('\n').filter((l) => /^\s*```/.test(l)).length;
  if (fences % 2 !== 0) errors.push(`${path.relative(root, file)}: unbalanced code fence`);
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of withoutCode.matchAll(linkRe)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = decodeURIComponent(target.split('#')[0]);
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(file), clean);
    if (!existsSync(resolved)) errors.push(`${path.relative(root, file)}: broken link ${target}`);
  }
}

// 3. Acceptance IDs are unique
const catalog = readFileSync('docs/acceptance-tests.md', 'utf8');
const defined = [];
for (const line of catalog.split('\n')) {
  const m = line.match(/^\| ([A-Z]+-\d{2}) \|/);
  if (m) defined.push(m[1]);
}
const dupes = defined.filter((id, i) => defined.indexOf(id) !== i);
if (dupes.length) errors.push(`duplicate acceptance IDs: ${[...new Set(dupes)].join(', ')}`);
const definedSet = new Set(defined);

// 4. Phase gate references resolve and cover the catalog
function expandRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(/\b([A-Z]+)-(\d{2}) through \1-(\d{2})\b/g)) {
    for (let n = Number(m[2]); n <= Number(m[3]); n++) refs.add(`${m[1]}-${String(n).padStart(2, '0')}`);
  }
  for (const m of text.matchAll(/\b([A-Z]{2,})-(\d{2})\b/g)) refs.add(`${m[1]}-${m[2]}`);
  return refs;
}
const phaseDir = 'docs/implementation';
const phaseText = [readFileSync('docs/implementation-plan.md', 'utf8'), ...readdirSync(phaseDir).map((f) => readFileSync(path.join(phaseDir, f), 'utf8'))].join('\n');
const referenced = expandRefs(phaseText);
for (const id of referenced) if (!definedSet.has(id)) errors.push(`phase docs reference undefined test ID ${id}`);
for (const id of definedSet) if (!referenced.has(id)) errors.push(`acceptance ID ${id} is not assigned to any phase gate`);

// 5. Traceability covers every ID once it exists
if (existsSync('docs/test-traceability.md')) {
  const trace = readFileSync('docs/test-traceability.md', 'utf8');
  for (const id of definedSet) {
    if (!new RegExp(`\\|\\s*${id}\\s*\\|`).test(trace)) errors.push(`docs/test-traceability.md lacks a row for ${id}`);
  }
}

if (errors.length) {
  console.error(`docs:check found ${errors.length} problem(s):`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`docs:check ok: ${mdFiles.length} Markdown files, ${definedSet.size} acceptance IDs, instruction SHA-256 ${hashes[0]}`);
