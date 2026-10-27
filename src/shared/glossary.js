// Glossary helpers: vocabulary prompt + post-transcription replacements.
//
// Both layers are engine-agnostic: the prompt is passed to whisper.cpp as
// `--prompt <text>` and the replacements are applied to the text that comes
// back, so nothing here depends on which model is configured.

const MAX_PROMPT_LENGTH = 600;
const MAX_SUBSTITUTIONS_LENGTH = 4000;
const MAX_RULES = 200;
const MAX_RULE_TERM_LENGTH = 80;
const MAX_SUBSTITUTION_OUTPUT_LENGTH = 500000;
const MAX_SUBSTITUTION_MATCHES = 100000;

// whisper.cpp uses at most n_text_ctx/2 tokens for the initial prompt.
const PROMPT_TOKEN_LIMIT = 224;

// Generic Catalan + English vocabulary for software teams. Opt-in only: the
// user loads it with a button and then edits it. No personal terms here.
const STARTER_VOCABULARY = [
  'Kubernetes',
  'deploy',
  'release',
  'build',
  'pipeline',
  'commit',
  'branch',
  'merge',
  'pull request',
  'code review',
  'rollback',
  'staging',
  'production',
  'hotfix',
  'backlog',
  'sprint',
  'standup',
  'deadline',
  'roadmap',
  'dashboard',
  'logs',
  'bug',
  'feature',
  'repo',
  'framework',
  'backend',
  'frontend',
  'API',
  'endpoint',
  'cache',
  'query',
  'onboarding',
  'feedback',
  'workshop',
  'kickoff'
];

// Word-ish characters. Used to avoid replacing inside larger words, so that
// "desbord" never rewrites "desbordament".
const EDGE_START = '(?<![\\p{L}\\p{N}_])';
const EDGE_END = '(?![\\p{L}\\p{N}_])';

/**
 * Turns free-form user input into a single-line prompt suitable for
 * `whisper-cli --prompt`. Newlines, semicolons and pipes become commas,
 * wrapping quotes are dropped and the result is capped in length.
 */
function normalizeGlossaryPrompt(raw) {
  if (typeof raw !== 'string') return '';

  let text = raw.replace(/[\r\n\t]+/g, ', ');
  text = text.replace(/^[\s"']+|[\s"']+$/g, '');
  text = text.replace(/\s*[;|]\s*/g, ', ');
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/(?:\s*,\s*)+/g, ', ');
  text = text.replace(/^[,\s]+|[,\s]+$/g, '');

  return text.slice(0, MAX_PROMPT_LENGTH).trim();
}

/**
 * Parses the replacements textarea. One rule per line, written as
 * `wrong => right` (`->` and `=` are accepted too). Blank lines and lines
 * starting with `#` are ignored. Duplicated keys keep the first rule.
 */
function parseSubstitutions(raw) {
  return validateSubstitutions(raw).rules;
}

function getSubstitutionsLengthError(raw) {
  return typeof raw === 'string' && raw.trim().length > MAX_SUBSTITUTIONS_LENGTH
    ? `Replacements exceed the ${MAX_SUBSTITUTIONS_LENGTH}-character limit. Shorten the list before saving or applying it.`
    : '';
}

/**
 * Reports skipped rules. Optional source lines keep import diagnostics tied
 * to the original file, including references to the first duplicated key.
 */
function validateSubstitutions(raw, lineNumbers = []) {
  const rules = [];
  const problems = [];

  if (typeof raw !== 'string') return { rules, problems };

  const lengthError = getSubstitutionsLengthError(raw);
  if (lengthError) {
    problems.push({ line: 0, text: '', reason: lengthError });
    return { rules, problems };
  }

  const seen = new Map();
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lineNumbers[index] ?? index + 1;
    const trimmed = lines[index].trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(.*?)\s*(?:=>|->|=)\s*(.*)$/);
    if (!match) {
      problems.push({ line, text: trimmed, reason: 'missing separator (use =>, -> or =)' });
      continue;
    }

    const from = match[1].trim();
    const to = match[2].trim();

    if (!from) {
      problems.push({ line, text: trimmed, reason: 'empty left side' });
      continue;
    }

    if (!to) {
      problems.push({ line, text: trimmed, reason: 'empty right side' });
      continue;
    }

    if (from.length > MAX_RULE_TERM_LENGTH) {
      problems.push({
        line,
        text: trimmed,
        reason: `left side longer than ${MAX_RULE_TERM_LENGTH} characters`
      });
      continue;
    }

    const key = from.toLowerCase();

    if (key === to.toLowerCase()) {
      problems.push({ line, text: trimmed, reason: 'both sides are the same' });
      continue;
    }

    if (seen.has(key)) {
      problems.push({ line, text: trimmed, reason: `duplicate of line ${seen.get(key)}` });
      continue;
    }

    if (rules.length >= MAX_RULES) {
      problems.push({ line, text: trimmed, reason: `limit of ${MAX_RULES} rules reached` });
      continue;
    }

    seen.set(key, line);
    rules.push({ from, to });
  }

  return { rules, problems };
}

/**
 * Rough token count for the vocabulary prompt. whisper uses a BPE tokenizer we
 * do not bundle here. This legacy characters/4 heuristic remains in the IPC
 * response for compatibility, but must not drive the UI or budget warnings.
 */
function estimatePromptTokens(prompt) {
  if (typeof prompt !== 'string') return 0;
  const text = prompt.trim();
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function starterPrompt() {
  return STARTER_VOCABULARY.join(', ');
}

const GLOSSARY_FILE_HEADER = '# LocalWhisper glossary v1';
const MAX_GLOSSARY_FILE_LENGTH = 128 * 1024;

/**
 * Serializes the glossary as an editable, diff-friendly text file.
 */
function serializeGlossary({ glossaryPrompt, substitutions }) {
  const prompt = normalizeGlossaryPrompt(glossaryPrompt);
  const rules = typeof substitutions === 'string' ? substitutions.trim() : '';
  const lengthError = getSubstitutionsLengthError(rules);
  if (lengthError) throw new Error(lengthError);

  return [
    GLOSSARY_FILE_HEADER,
    '# Share this file, or keep it as a backup. Edit it with any text editor.',
    '',
    '[prompt]',
    prompt,
    '',
    '[substitutions]',
    rules,
    ''
  ].join('\n');
}

/**
 * Parses a glossary file. Sections are optional: a file without headers is
 * treated as a plain list of replacement rules, which is what people usually
 * paste around. Unknown sections are reported instead of silently dropped.
 */
function parseGlossaryFile(text) {
  const result = { glossaryPrompt: '', substitutions: '', problems: [] };

  if (typeof text !== 'string' || !text.trim()) {
    result.problems.push({ line: 0, text: '', reason: 'file is empty' });
    return result;
  }

  if (text.length > MAX_GLOSSARY_FILE_LENGTH) {
    result.problems.push({ line: 0, text: '', reason: 'file is too large' });
    return result;
  }

  const lines = text.split(/\r?\n/);
  let section = null;
  let sawSection = false;
  const promptLines = [];
  const substitutionLines = [];
  const looseLines = [];

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const trimmed = lines[index].trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      const name = header[1].toLowerCase();
      sawSection = true;
      if (name === 'prompt' || name === 'substitutions') {
        section = name;
      } else {
        section = null;
        result.problems.push({
          line,
          text: trimmed,
          reason: `unknown section [${name}] (expected [prompt] or [substitutions])`
        });
      }
      continue;
    }

    if (section === 'prompt') {
      promptLines.push(trimmed);
    } else if (section === 'substitutions') {
      substitutionLines.push({ text: trimmed, line });
    } else if (!sawSection) {
      looseLines.push({ text: trimmed, line });
    }
  }

  result.glossaryPrompt = normalizeGlossaryPrompt(promptLines.join('\n'));
  const selectedLines = sawSection ? substitutionLines : looseLines;
  result.substitutions = selectedLines.map((entry) => entry.text).join('\n');

  const { problems } = validateSubstitutions(
    result.substitutions,
    selectedLines.map((entry) => entry.line)
  );
  for (const problem of problems) {
    result.problems.push(problem);
  }

  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies the replacement rules to a transcription. Matching is
 * case-insensitive and whole-word (multi-word keys allowed). Longer keys are
 * applied first so overlapping rules resolve predictably.
 */
function applySubstitutions(text, rules) {
  if (typeof text !== 'string' || !text) return text;
  if (!Array.isArray(rules) || rules.length === 0) return text;

  if (text.length > MAX_SUBSTITUTION_OUTPUT_LENGTH) {
    throw new Error(`Replacement input exceeds the ${MAX_SUBSTITUTION_OUTPUT_LENGTH}-character limit.`);
  }

  const sorted = [...rules].sort((a, b) => b.from.length - a.from.length);
  let output = text;
  let matches = 0;

  for (const rule of sorted) {
    const body = rule.from
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join('\\s+');

    if (!body) continue;

    const pattern = new RegExp(`${EDGE_START}${body}${EDGE_END}`, 'giu');
    // Check the prospective size before replace allocates the result. Keep
    // sequential chaining, but bound both its output and total match count.
    let outputLength = output.length;
    output = output.replace(pattern, (match) => {
      matches++;
      outputLength += rule.to.length - match.length;
      if (outputLength > MAX_SUBSTITUTION_OUTPUT_LENGTH || matches > MAX_SUBSTITUTION_MATCHES) {
        throw new Error('Replacement expansion limit exceeded. Simplify the chained rules.');
      }
      // Function replacement keeps `$&`/`$1` in the right side literal.
      return rule.to;
    });
  }

  return output;
}

module.exports = {
  normalizeGlossaryPrompt,
  parseSubstitutions,
  validateSubstitutions,
  getSubstitutionsLengthError,
  applySubstitutions,
  estimatePromptTokens,
  starterPrompt,
  serializeGlossary,
  parseGlossaryFile,
  STARTER_VOCABULARY,
  GLOSSARY_FILE_HEADER,
  MAX_GLOSSARY_FILE_LENGTH,
  PROMPT_TOKEN_LIMIT,
  MAX_PROMPT_LENGTH,
  MAX_SUBSTITUTIONS_LENGTH,
  MAX_SUBSTITUTION_OUTPUT_LENGTH,
  MAX_SUBSTITUTION_MATCHES,
  MAX_RULES
};
