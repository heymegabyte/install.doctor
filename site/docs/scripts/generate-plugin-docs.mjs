#!/usr/bin/env node
import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const docsSiteRoot = resolve(process.env.DOCS_SITE_ROOT || join(scriptDir, '..'));
const installDoctorRoot = resolve(process.env.INSTALL_DOCTOR_ROOT || join(docsSiteRoot, '..', '..'));

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.avif',
]);

const EXCLUDED_DOC_NAMES = new Set([
  'CODEOWNERS',
  'CODE_OF_CONDUCT.md',
  'ECOSYSTEM.md',
  'CONTRIBUTING.md',
  'TODO.md',
  'INSPIRATION.md',
  'logo-full.png',
]);

function hasExecutableOnPath(cmd) {
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathDirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, `${cmd}${suffix}`);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return true;
        }
      } catch {
        // Ignore unreadable PATH entries
      }
    }
  }
  return false;
}

function canDelegateToPosixMarkdownSh() {
  if (process.platform === 'win32') return false;
  if (process.env.FORCE_PORTABLE_DOCS_MIRROR === '1') return false;
  if (!existsSync(join(scriptDir, 'markdown.sh'))) return false;
  if (process.env.MARKDOWN_COPY_ONLY === '1') {
    return hasExecutableOnPath('bash') && hasExecutableOnPath('rsync');
  }
  return ['bash', 'rsync', 'shdoc', 'task'].every(hasExecutableOnPath);
}

if (canDelegateToPosixMarkdownSh()) {
  const res = spawnSync('bash', [join(scriptDir, 'markdown.sh')], {
    cwd: docsSiteRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

if (
  !existsSync(join(installDoctorRoot, 'software.yml')) ||
  !existsSync(join(installDoctorRoot, 'docs'))
) {
  console.error(`Unable to locate the Install Doctor source tree at ${installDoctorRoot}`);
  process.exit(1);
}

function cleanGeneratedMarkdown(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanGeneratedMarkdown(fullPath);
    } else if (!IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      rmSync(fullPath, { force: true });
    }
  }
}

function makeScriptFolders() {
  for (const folder of [
    'docs/scripts/after',
    'docs/scripts/before',
    'docs/scripts/profile',
    'docs/scripts/utility',
    'docs/cli/commands',
  ]) {
    mkdirSync(join(docsSiteRoot, folder), { recursive: true });
  }
}

function copyCanonicalDocs(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (EXCLUDED_DOC_NAMES.has(entry.name)) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyCanonicalDocs(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function walkFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, acc);
    } else if (entry.isFile() && predicate(fullPath, entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function sanitizeMdxProse(text) {
  const normalized = text
    .replace(/\{\{-?\s*\.AppName\s*-?\}\}/g, 'Install Doctor')
    .replace(/\{\{[\s\S]*?\}\}/g, '');
  const parts = normalized.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/<(?=[A-Za-z!/])/g, '&lt;');
    })
    .join('');
}

function extractShdocSummary(source, fallbackName) {
  const lines = source.split(/\r?\n/);
  let title = '';
  let brief = '';
  const descLines = [];
  let inDescription = false;

  for (const line of lines) {
    const fileMatch = line.match(/^#\s*@file\s+(.+)$/);
    if (fileMatch) {
      title = fileMatch[1].trim();
      inDescription = false;
      continue;
    }
    const briefMatch = line.match(/^#\s*@brief\s+(.+)$/);
    if (briefMatch) {
      brief = briefMatch[1].trim();
      inDescription = false;
      continue;
    }
    if (/^#\s*@description\b/.test(line)) {
      inDescription = true;
      continue;
    }
    if (inDescription) {
      if (/^#\s*@\w+/.test(line) || !/^#/.test(line)) {
        inDescription = false;
      } else {
        descLines.push(line.replace(/^#\s? ? ? ?/, ''));
      }
    }
  }

  const finalTitle = (title || fallbackName).replace(/\{\{.*?\}\}/g, '').trim() || fallbackName;
  const finalBrief =
    (brief || descLines.find((l) => l.trim().length > 0) || `Generated reference for ${fallbackName}`)
      .replace(/\{\{.*?\}\}/g, '')
      .trim();
  const body = sanitizeMdxProse(descLines.join('\n').trim());
  return { title: finalTitle, description: finalBrief, body };
}

function toPosixRelative(rootDir, targetPath) {
  return relative(rootDir, targetPath).split(sep).join(posix.sep);
}

function populateScriptDocs() {
  const homeScripts = walkFiles(
    join(installDoctorRoot, 'home'),
    (_full, name) => name.endsWith('.sh.tmpl'),
  ).sort();

  for (const scriptPath of homeScripts) {
    const fileName = basename(scriptPath);
    const repoPath = toPosixRelative(installDoctorRoot, scriptPath);
    let tag = 'profile';
    if (repoPath.includes('after_')) tag = 'after';
    else if (repoPath.includes('before_')) tag = 'before';

    const numMatch = fileName.match(/(\d{2})/);
    const numberPrefix = numMatch ? `${numMatch[1]} ` : '';
    const raw = readFileSync(scriptPath, 'utf8');
    const { title, description, body } = extractShdocSummary(raw, fileName);
    const mdFile = join(docsSiteRoot, 'docs', 'scripts', tag, `${fileName}.md`);

    const content = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(description)}`,
      `sidebar_label: ${JSON.stringify(`${numberPrefix}${title}`)}`,
      `slug: /scripts/${tag}/${fileName}`,
      `githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/${repoPath}`,
      `scriptLocation: https://github.com/heymegabyte/install.doctor/raw/master/${repoPath}`,
      `repoLocation: ${repoPath}`,
      '---',
      body ? `\n${body}\n` : '',
      '## Source Code',
      '',
      '```shell',
      raw.trimEnd(),
      '```',
      '',
    ].join('\n');
    writeFileSync(mdFile, content, 'utf8');
  }

  const utilityDir = join(installDoctorRoot, 'scripts');
  if (existsSync(utilityDir)) {
    const utilityScripts = readdirSync(utilityDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sh'))
      .map((entry) => join(utilityDir, entry.name))
      .sort();

    for (const scriptPath of utilityScripts) {
      const fileName = basename(scriptPath);
      const repoPath = toPosixRelative(installDoctorRoot, scriptPath);
      const raw = readFileSync(scriptPath, 'utf8');
      const { title, description, body } = extractShdocSummary(raw, fileName);
      const mdFile = join(docsSiteRoot, 'docs', 'scripts', 'utility', `${fileName}.md`);

      const content = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `description: ${JSON.stringify(description)}`,
        `sidebar_label: ${JSON.stringify(title)}`,
        `slug: /scripts/utility/${fileName}`,
        `githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/${repoPath}`,
        `scriptLocation: https://github.com/heymegabyte/install.doctor/raw/master/${repoPath}`,
        `repoLocation: ${repoPath}`,
        '---',
        body ? `\n${body}\n` : '',
        '## Source Code',
        '',
        '```shell',
        raw.trimEnd(),
        '```',
        '',
      ].join('\n');
      writeFileSync(mdFile, content, 'utf8');
    }
  }
}

function populateTaskfileDocs() {
  const taskfilePath = join(installDoctorRoot, 'home', 'dot_config', 'task', 'Taskfile.yml');
  if (!existsSync(taskfilePath)) return;

  const lines = readFileSync(taskfilePath, 'utf8').split(/\r?\n/);
  let inTasksSection = false;
  const tasks = new Map();
  let current = null;
  let inSummaryBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^tasks:\s*$/.test(line)) {
      inTasksSection = true;
      continue;
    }
    if (!inTasksSection) continue;
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      inTasksSection = false;
      break;
    }

    const taskMatch = line.match(/^  ([A-Za-z0-9_:-]+):\s*$/);
    if (taskMatch) {
      current = {
        name: taskMatch[1],
        lineNumber: i + 1,
        desc: '',
        summaryLines: [],
      };
      tasks.set(current.name, current);
      inSummaryBlock = false;
      continue;
    }

    if (!current) continue;

    if (inSummaryBlock) {
      if (/^      /.test(line) || /^\s*$/.test(line)) {
        current.summaryLines.push(line.replace(/^      /, ''));
        continue;
      }
      inSummaryBlock = false;
    }

    const descMatch = line.match(/^    desc:\s*(.+)$/);
    if (descMatch) {
      current.desc = descMatch[1].replace(/^['"]|['"]$/g, '').trim();
      continue;
    }

    if (/^    summary:\s*\|/.test(line)) {
      inSummaryBlock = true;
    }
  }

  for (const task of tasks.values()) {
    if (!task.desc && task.summaryLines.length === 0) continue;
    const slugName = task.name.replace(/:/g, '-');
    const mdFile = join(docsSiteRoot, 'docs', 'cli', 'commands', `${slugName}.md`);

    const cleanedSummary = sanitizeMdxProse(task.summaryLines.join('\n')).trim();
    const headingMatch = cleanedSummary.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : task.name;
    const bodyWithoutH1 = cleanedSummary.replace(/^#\s+.+\r?\n?/, '').trim();
    const description =
      sanitizeMdxProse(task.desc).trim() || `Install Doctor CLI task ${task.name}`;

    const content = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(description)}`,
      `sidebar_label: ${JSON.stringify(task.name)}`,
      `slug: /cli/commands/${slugName}`,
      `githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/task/Taskfile.yml#L${task.lineNumber}`,
      'repoLocation: home/dot_config/task/Taskfile.yml',
      '---',
      bodyWithoutH1 ? `\n${bodyWithoutH1}\n` : `\n${description}\n`,
    ].join('\n');
    writeFileSync(mdFile, content, 'utf8');
  }
}

cleanGeneratedMarkdown(join(docsSiteRoot, 'docs'));
makeScriptFolders();
copyCanonicalDocs(join(installDoctorRoot, 'docs'), join(docsSiteRoot, 'docs'));

if (process.env.MARKDOWN_COPY_ONLY === '1') {
  process.exit(0);
}

populateScriptDocs();
populateTaskfileDocs();
