type EpubSourceProfile = {
  id: 'generic' | 'project-gutenberg';
  ignoredParagraphs: RegExp[];
};

type EpubReflowContext = {
  profile: EpubSourceProfile;
  collapseEastAsianSpacing: boolean;
};

type EpubBlockFeatures = {
  className: string;
  marginTopEm: number;
  plainText: string;
};

type EpubBlock =
  | { kind: 'paragraph'; content: string; features: EpubBlockFeatures }
  | { kind: 'heading'; content: string; level: number }
  | { kind: 'blockquote'; content: string }
  | { kind: 'markdown'; content: string };

const localNameElements = (document: Document | Element, name: string) => (
  Array.from(document.getElementsByTagNameNS('*', name))
);

const cleanText = (value: unknown) => (
  typeof value === 'string'
    ? Array.from(value, (character) => {
        const code = character.codePointAt(0) ?? 0;

        return code <= 0x1f || code === 0x7f ? ' ' : character;
      }).join('').replace(/\s+/g, ' ').trim()
    : ''
);

const sourceProfiles: EpubSourceProfile[] = [
  {
    id: 'project-gutenberg',
    ignoredParagraphs: [/^Produced by\b/i],
  },
  {
    id: 'generic',
    ignoredParagraphs: [],
  },
];

const ignoredInlineTags = new Set([
  'script',
  'style',
  'svg',
  'audio',
  'video',
  'form',
  'rt',
  'rp',
]);

const ignoredBlockTags = new Set([
  'script',
  'style',
  'svg',
  'audio',
  'video',
  'form',
  'nav',
]);
const genericImageAltPattern = /^(?:图|图片|图像|插图|照片|封面|image|img|picture|photo)$/iu;

const blockContainerTags = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'ul',
  'ol',
  'table',
  'blockquote',
  'pre',
  'hr',
  'figure',
]);

const eastAsianCharacters = [
  '\\p{Script=Han}',
  '\\p{Script=Hiragana}',
  '\\p{Script=Katakana}',
  '\\p{Script=Hangul}',
  '\\u3000-\\u303f',
  '\\uff01-\\uff60',
].join('');
const eastAsianCharacterPattern = new RegExp(`[${eastAsianCharacters}]`, 'gu');
const eastAsianSpacingPattern = new RegExp(
  `([${eastAsianCharacters}])[\\t \\u00a0\\u3000]+(?=[${eastAsianCharacters}])`,
  'gu',
);
const hanSpacingPattern = /(\p{Script=Han})[\t \u00a0\u3000]+(?=\p{Script=Han})/gu;
const eastAsianLineBreakPattern = new RegExp(
  `([${eastAsianCharacters}])\\n+(?=[${eastAsianCharacters}])`,
  'gu',
);
const chineseSectionOrdinal = '[一二三四五六七八九十百千\\d]+';
const chineseSectionTitleSuffix = '(?:(?:[·•・：:、.．—-]\\s*|\\s+)[^。！？；]{1,32})?';
const numberedSectionHeadingPattern = new RegExp(
  `^第${chineseSectionOrdinal}[卷章节篇回]${chineseSectionTitleSuffix}$`,
  'u',
);
const volumeSectionHeadingPattern = new RegExp(
  `^卷(?:第)?${chineseSectionOrdinal}${chineseSectionTitleSuffix}$`,
  'u',
);
const chronicleSectionHeadingPattern = /^.+传第[一二三四五六七八九十百千\d]+$/u;
const ordinalLinePattern = /^(?:\d{1,4}|[一二三四五六七八九十百千]{1,6})[.．、]?$/u;
const structuredLinePatterns = [
  /^【[^】\n]{1,16}】/u,
  /^[（(]?(?:\d{1,4}|[一二三四五六七八九十百千]{1,6})[）)、.．]/u,
  /^[●◆■▪•◦\u0084]/u,
  /^à\s*示例/iu,
];
const paragraphSentencePattern = new RegExp(
  '[^。！？!?；;]+(?:[。！？!?；;]+[”’」』）》】]*)?|[^。！？!?；;]+$',
  'gu',
);
const MAX_REFLOW_PARAGRAPH_LENGTH = 900;
const TARGET_REFLOW_PARAGRAPH_LENGTH = 520;

const normalizeBlockText = (value: string) => value
  .replace(/[\t\f\v ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .trim();

export const escapeEpubMarkdownText = (value: string) => Array.from(
  value,
  (character) => {
    const code = character.charCodeAt(0);
    const punctuation = (code >= 0x21 && code <= 0x2f)
      || (code >= 0x3a && code <= 0x40)
      || (code >= 0x5b && code <= 0x60)
      || (code >= 0x7b && code <= 0x7e);

    return punctuation ? `\\${character}` : character;
  },
).join('');

const parseEpubMarkup = (source: string) => {
  if (/<!ENTITY\b/i.test(source)) {
    throw new Error('EPUB 正文包含不支持的实体声明');
  }

  let document: Document;

  try {
    document = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  } catch {
    document = new DOMParser().parseFromString(source, 'text/html');
  }
  if (document.getElementsByTagName('parsererror').length) {
    document = new DOMParser().parseFromString(source, 'text/html');
  }
  return document;
};

const selectSourceProfile = (document: Document) => {
  const generatedByProjectGutenberg = localNameElements(document, 'meta').some((meta) => (
    meta.getAttribute('name')?.toLowerCase() === 'generator'
    && /project gutenberg|ebookmaker/i.test(meta.getAttribute('content') ?? '')
  ));

  return sourceProfiles.find((profile) => (
    profile.id === (generatedByProjectGutenberg ? 'project-gutenberg' : 'generic')
  )) ?? sourceProfiles.at(-1) as EpubSourceProfile;
};

const shouldCollapseEastAsianSpacing = (value: string) => {
  const eastAsianCharacterCount = value.match(eastAsianCharacterPattern)?.length ?? 0;
  const spacedPairCount = value.match(eastAsianSpacingPattern)?.length ?? 0;
  const ratio = spacedPairCount / Math.max(eastAsianCharacterCount, 1);

  return (spacedPairCount >= 6 && ratio >= 0.08)
    || (spacedPairCount >= 16 && ratio >= 0.015);
};

const createReflowContext = (
  document: Document,
  body: Element,
): EpubReflowContext => ({
  profile: selectSourceProfile(document),
  collapseEastAsianSpacing: shouldCollapseEastAsianSpacing(body.textContent ?? ''),
});

const normalizeInlineText = (value: string, context: EpubReflowContext) => {
  const normalized = value.replace(hanSpacingPattern, '$1');

  return context.collapseEastAsianSpacing
    ? normalized.replace(eastAsianSpacingPattern, '$1')
    : normalized;
};

const recoverEscapedParagraphBoundaries = (value: string) => value
  .replace(/<\/p>\s*<p(?:\s[^<>]*?)?>/gi, '\n')
  .replace(/(^|\n)[\t ]*<p(?:\s[^<>]*?)?>[\t ]*/gi, '$1')
  .replace(/<\/p>(?=[\t ]*(?:$|\n))/gim, '');

const isSourceBoilerplate = (element: Element, context: EpubReflowContext) => {
  if (context.profile.id !== 'project-gutenberg') {
    return false;
  }

  const id = (element.getAttribute('id') ?? '').toLowerCase();
  const classes = (element.getAttribute('class') ?? '').toLowerCase().split(/\s+/);

  return classes.includes('pg-boilerplate')
    || classes.includes('pgheader')
    || id === 'pg-header'
    || id === 'pg-footer'
    || id === 'project-gutenberg-license'
    || /^pg-(?:start|end)-separator$/.test(id);
};

const shouldIgnoreParagraph = (element: Element, context: EpubReflowContext) => {
  const text = cleanText(element.textContent);

  return context.profile.ignoredParagraphs.some((pattern) => pattern.test(text));
};

const wrapMarkdownInline = (value: string, marker: string) => {
  const leading = value.match(/^\s*/u)?.[0] ?? '';
  const trailing = value.match(/\s*$/u)?.[0] ?? '';
  const content = value.slice(leading.length, value.length - trailing.length);

  return content ? `${leading}${marker}${content}${marker}${trailing}` : value;
};

const markdownCodeSpan = (value: string) => {
  const longestFence = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = '`'.repeat(longestFence + 1);
  const padding = /^\s|\s$/u.test(value) ? ' ' : '';

  return `${fence}${padding}${value}${padding}${fence}`;
};

const mathOperatorTex = new Map([
  ['−', '-'],
  ['×', '\\times '],
  ['÷', '\\div '],
  ['·', '\\cdot '],
  ['≤', '\\le '],
  ['≥', '\\ge '],
  ['≠', '\\ne '],
  ['≈', '\\approx '],
  ['∞', '\\infty '],
  ['∑', '\\sum '],
  ['∏', '\\prod '],
  ['∫', '\\int '],
  ['∂', '\\partial '],
  ['√', '\\sqrt{}'],
  ['→', '\\to '],
  ['←', '\\leftarrow '],
  ['↔', '\\leftrightarrow '],
  ['∈', '\\in '],
  ['∉', '\\notin '],
]);

const escapeTexText = (value: string) => value.replace(
  /[#$%&_{}]/g,
  (character) => `\\${character}`,
);

const mathMlToTex = (math: Element) => {
  const annotation = localNameElements(math, 'annotation').find((item) => (
    /tex$/i.test(item.getAttribute('encoding') ?? '')
    || /latex/i.test(item.getAttribute('encoding') ?? '')
  ));
  const annotatedTex = cleanText(annotation?.textContent);

  if (annotatedTex) {
    return annotatedTex;
  }

  const convert = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.replace(/\s+/g, ' ') ?? '';
    }
    if (!(node instanceof Element)) {
      return '';
    }

    const tag = node.localName.toLowerCase();
    const children = Array.from(node.childNodes).map(convert);
    const child = (index: number) => children[index]?.trim() ?? '';
    const joined = children.join('').trim();

    if (tag === 'annotation' || tag === 'annotation-xml') {
      return '';
    }
    if (tag === 'math' || tag === 'mrow' || tag === 'mstyle' || tag === 'mpadded') {
      return joined;
    }
    if (tag === 'semantics') {
      const primary = Array.from(node.children).find((element) => (
        !['annotation', 'annotation-xml'].includes(element.localName.toLowerCase())
      ));

      return primary ? convert(primary) : '';
    }
    if (tag === 'mi' || tag === 'mn') {
      return escapeTexText(cleanText(node.textContent));
    }
    if (tag === 'mo') {
      const operator = cleanText(node.textContent);

      return mathOperatorTex.get(operator) ?? escapeTexText(operator);
    }
    if (tag === 'mtext' || tag === 'ms') {
      return `\\text{${escapeTexText(cleanText(node.textContent))}}`;
    }
    if (tag === 'mfrac') {
      return `\\frac{${child(0)}}{${child(1)}}`;
    }
    if (tag === 'msqrt') {
      return `\\sqrt{${joined}}`;
    }
    if (tag === 'mroot') {
      return `\\sqrt[${child(1)}]{${child(0)}}`;
    }
    if (tag === 'msup') {
      return `{${child(0)}}^{${child(1)}}`;
    }
    if (tag === 'msub') {
      return `{${child(0)}}_{${child(1)}}`;
    }
    if (tag === 'msubsup') {
      return `{${child(0)}}_{${child(1)}}^{${child(2)}}`;
    }
    if (tag === 'mover') {
      return `\\overset{${child(1)}}{${child(0)}}`;
    }
    if (tag === 'munder') {
      return `\\underset{${child(1)}}{${child(0)}}`;
    }
    if (tag === 'munderover') {
      return `\\overset{${child(2)}}{\\underset{${child(1)}}{${child(0)}}}`;
    }
    if (tag === 'mfenced') {
      const open = node.getAttribute('open') ?? '(';
      const close = node.getAttribute('close') ?? ')';
      const separators = node.getAttribute('separators') || ',';
      const content = children.map((value, index) => (
        index ? `${separators[Math.min(index - 1, separators.length - 1)]}${value}` : value
      )).join('');

      return `\\left${open}${content}\\right${close}`;
    }
    if (tag === 'mtable') {
      const rows = Array.from(node.children)
        .filter((row) => row.localName.toLowerCase() === 'mtr')
        .map((row) => Array.from(row.children).map(convert).join(' & '));

      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`;
    }
    if (tag === 'mtr') {
      return Array.from(node.children).map(convert).join(' & ');
    }
    if (tag === 'mtd') {
      return joined;
    }
    if (tag === 'mspace') {
      return '\\,';
    }

    return joined;
  };

  return convert(math).trim();
};

const markdownInlineText = (
  node: Node,
  context: EpubReflowContext,
): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = recoverEscapedParagraphBoundaries(node.textContent ?? '');

    return escapeEpubMarkdownText(normalizeInlineText(text, context));
  }
  if (!(node instanceof Element)) {
    return '';
  }

  const tag = node.localName.toLowerCase();
  if (ignoredInlineTags.has(tag)) {
    return '';
  }
  if (tag === 'math') {
    const tex = mathMlToTex(node);

    return tex ? `$${tex}$` : escapeEpubMarkdownText(node.textContent ?? '');
  }
  if (tag === 'br') {
    return '<br>';
  }
  if (tag === 'img') {
    const alt = cleanText(node.getAttribute('alt'));

    return genericImageAltPattern.test(alt) ? '' : escapeEpubMarkdownText(alt);
  }
  if (tag === 'code' && node.parentElement?.localName.toLowerCase() !== 'pre') {
    return markdownCodeSpan(node.textContent ?? '');
  }

  const value = Array.from(node.childNodes)
    .map((child) => markdownInlineText(child, context))
    .join('')
    .replace(/\*{4}/g, '')
    .replace(/~{4}/g, '');

  if (tag === 'strong' || tag === 'b') {
    return wrapMarkdownInline(value, '**');
  }
  if (tag === 'em' || tag === 'i') {
    return wrapMarkdownInline(value, '*');
  }
  if (tag === 'del' || tag === 's' || tag === 'strike') {
    return wrapMarkdownInline(value, '~~');
  }
  return value;
};

const markdownTable = (table: Element, context: EpubReflowContext) => {
  const rowElements = localNameElements(table, 'tr');
  const rows = rowElements.map((row) => (
    Array.from(row.children)
      .filter((cell) => ['th', 'td'].includes(cell.localName.toLowerCase()))
      .map((cell) => normalizeBlockText(markdownInlineText(cell, context))
        .replace(/\|/g, '\\|')
        .replace(/\n/g, '<br>'))
  )).filter((row) => row.length);

  if (!rows.length) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row: string[]) => {
    const cells = [...row];

    while (cells.length < columnCount) {
      cells.push('');
    }
    return `| ${cells.slice(0, columnCount).join(' | ')} |`;
  };
  const hasHeader = Array.from(rowElements[0]?.children ?? []).some((cell) => (
    cell.localName.toLowerCase() === 'th'
  ));
  const header = hasHeader ? rows[0] : Array.from({ length: columnCount }, () => '');

  return [
    normalizeRow(header),
    normalizeRow(Array.from({ length: columnCount }, () => '---')),
    ...(hasHeader ? rows.slice(1) : rows).map(normalizeRow),
  ].join('\n');
};

const markdownList = (
  list: Element,
  context: EpubReflowContext,
  depth = 0,
): string[] => {
  const ordered = list.localName.toLowerCase() === 'ol';
  const start = Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1;
  const lines: string[] = [];
  const items = Array.from(list.children).filter(
    (child) => child.localName.toLowerCase() === 'li',
  );

  items.forEach((item, index) => {
    const text = normalizeBlockText(
      Array.from(item.childNodes)
        .filter((child) => !(
          child instanceof Element
          && ['ul', 'ol'].includes(child.localName.toLowerCase())
        ))
        .map((child) => markdownInlineText(child, context))
        .join(' '),
    ).replace(/\n+/g, ' ');
    const explicitValue = Number.parseInt(item.getAttribute('value') ?? '', 10);
    const ordinal = Number.isFinite(explicitValue) ? explicitValue : start + index;
    const marker = ordered ? `${ordinal}.` : '-';

    if (text) {
      lines.push(`${'    '.repeat(Math.min(depth, 3))}${marker} ${text}`);
    }
    Array.from(item.children)
      .filter((child) => ['ul', 'ol'].includes(child.localName.toLowerCase()))
      .forEach((child) => lines.push(...markdownList(child, context, depth + 1)));
  });
  return lines;
};

const createBlockFeatures = (
  element: Element,
  context: EpubReflowContext,
): EpubBlockFeatures => ({
  className: element.getAttribute('class') ?? '',
  marginTopEm: Number.parseFloat(
    element.getAttribute('style')?.match(/margin-top\s*:\s*([\d.]+)em/i)?.[1] ?? '0',
  ),
  plainText: normalizeInlineText(cleanText(element.textContent), context),
});

const extractEpubBlocks = (
  body: Element,
  context: EpubReflowContext,
): EpubBlock[] => {
  const blocks: EpubBlock[] = [];

  const collect = (container: Element) => {
    Array.from(container.childNodes).forEach((node) => {
      if (!(node instanceof Element)) {
        const text = normalizeBlockText(node.textContent ?? '');

        if (text) {
          blocks.push({
            kind: 'paragraph',
            content: escapeEpubMarkdownText(normalizeInlineText(text, context)),
            features: { className: '', marginTopEm: 0, plainText: text },
          });
        }
        return;
      }

      const element = node;
      const tag = element.localName.toLowerCase();

      if (
        ignoredBlockTags.has(tag)
        || isSourceBoilerplate(element, context)
      ) {
        return;
      }
      if (tag === 'math') {
        const tex = mathMlToTex(element);

        if (tex) {
          blocks.push({ kind: 'markdown', content: `$$\n${tex}\n$$` });
        }
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        const content = normalizeBlockText(markdownInlineText(element, context));

        if (content) {
          blocks.push({ kind: 'heading', content, level: Number(tag[1]) });
        }
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        const lines = markdownList(element, context);

        if (lines.length) {
          blocks.push({ kind: 'markdown', content: lines.join('\n') });
        }
        return;
      }
      if (tag === 'table') {
        const content = markdownTable(element, context);

        if (content) {
          blocks.push({ kind: 'markdown', content });
        }
        return;
      }
      if (tag === 'blockquote') {
        const content = normalizeBlockText(markdownInlineText(element, context));

        if (content) {
          blocks.push({ kind: 'blockquote', content });
        }
        return;
      }
      if (tag === 'pre') {
        const content = (element.textContent ?? '').replace(/^\n|\n$/g, '');
        const longestFence = Math.max(
          2,
          ...Array.from(content.matchAll(/~+/g), (match) => match[0].length),
        );
        const fence = '~'.repeat(longestFence + 1);
        const codeClass = localNameElements(element, 'code')[0]
          ?.getAttribute('class') ?? '';
        const language = codeClass
          .match(/(?:^|\s)language-([\w+-]+)/)?.[1] ?? '';

        blocks.push({
          kind: 'markdown',
          content: `${fence}${language}\n${content}\n${fence}`,
        });
        return;
      }
      if (tag === 'hr') {
        blocks.push({ kind: 'markdown', content: '---' });
        return;
      }
      if (['p', 'figcaption', 'caption', 'dt', 'dd'].includes(tag)) {
        const content = normalizeBlockText(markdownInlineText(element, context));

        if (!content || (tag === 'p' && shouldIgnoreParagraph(element, context))) {
          return;
        }
        blocks.push({
          kind: 'paragraph',
          content,
          features: createBlockFeatures(element, context),
        });
        return;
      }

      const hasBlockChildren = Array.from(element.children).some((child) => {
        const childTag = child.localName.toLowerCase();

        return /^h[1-6]$/.test(childTag) || blockContainerTags.has(childTag);
      });

      if (hasBlockChildren) {
        collect(element);
      } else {
        const content = normalizeBlockText(markdownInlineText(element, context));

        if (content) {
          blocks.push({
            kind: 'paragraph',
            content,
            features: createBlockFeatures(element, context),
          });
        }
      }
    });
  };

  collect(body);
  return blocks;
};

type ParagraphLine = {
  raw: string;
  text: string;
};

const isStructuredParagraphLine = (line: ParagraphLine) => (
  /^\u3000{2,}/u.test(line.raw)
  || ordinalLinePattern.test(line.text)
  || structuredLinePatterns.some((pattern) => pattern.test(line.text))
);

const splitStructuredParagraph = (content: string) => {
  const lines = content
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .split('\n')
    .map((raw) => ({ raw, text: raw.trim() }))
    .filter((line) => line.text);
  const boundaryCount = lines.filter(isStructuredParagraphLine).length;

  if (boundaryCount < 2) {
    return [content];
  }

  const sections: string[] = [];
  let current: string[] = [];

  lines.forEach((line) => {
    if (isStructuredParagraphLine(line) && current.length) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line.text);
  });
  if (current.length) {
    sections.push(current.join('\n'));
  }
  return sections;
};

const hasBalancedMarkdown = (content: string) => {
  const unescaped = content.replace(/\\./g, '');
  const codeMarkers = unescaped.match(/`+/g)?.length ?? 0;
  const strikeMarkers = unescaped.match(/~~/g)?.length ?? 0;
  const withoutPairedMarkers = unescaped.replace(/~~|\*\*/g, '');
  const emphasisMarkers = withoutPairedMarkers.match(/\*/g)?.length ?? 0;
  const strongMarkers = unescaped.match(/\*\*/g)?.length ?? 0;

  return codeMarkers % 2 === 0
    && strikeMarkers % 2 === 0
    && emphasisMarkers % 2 === 0
    && strongMarkers % 2 === 0;
};

const groupTextUnits = (units: string[]) => {
  const groups: string[] = [];
  let current = '';

  units.forEach((unit) => {
    if (
      current
      && current.length + unit.length > MAX_REFLOW_PARAGRAPH_LENGTH
      && current.length >= TARGET_REFLOW_PARAGRAPH_LENGTH
      && hasBalancedMarkdown(current)
    ) {
      groups.push(current.trim());
      current = '';
    }
    current += unit;
  });
  if (current.trim()) {
    groups.push(current.trim());
  }
  return groups;
};

const splitAtReadableBoundary = (content: string) => {
  const characters = Array.from(content);
  const sections: string[] = [];
  let offset = 0;

  while (characters.length - offset > MAX_REFLOW_PARAGRAPH_LENGTH) {
    const maximumEnd = offset + MAX_REFLOW_PARAGRAPH_LENGTH;
    const minimumEnd = offset + TARGET_REFLOW_PARAGRAPH_LENGTH;
    let end = maximumEnd;

    for (let index = maximumEnd; index >= minimumEnd; index -= 1) {
      if (/\s|[，,、：:]/u.test(characters[index] ?? '')) {
        end = index + 1;
        break;
      }
    }

    let section = characters.slice(offset, end).join('').trim();
    while (!hasBalancedMarkdown(section) && end < characters.length) {
      end += 1;
      section = characters.slice(offset, end).join('').trim();
    }
    if (!section || end >= characters.length) {
      break;
    }
    sections.push(section);
    offset = end;
  }

  const remainder = characters.slice(offset).join('').trim();

  return remainder ? [...sections, remainder] : sections;
};

const splitOversizedText = (content: string) => {
  const clauses = content.match(/[^，,、]+(?:[，,、]+|$)/gu) ?? [];

  if (clauses.length > 1) {
    return groupTextUnits(clauses).flatMap((section) => (
      section.length > MAX_REFLOW_PARAGRAPH_LENGTH
        ? splitAtReadableBoundary(section)
        : [section]
    ));
  }

  const words = content.match(/\S+\s*/gu) ?? [];

  if (words.length > 1) {
    return groupTextUnits(words).flatMap((section) => (
      section.length > MAX_REFLOW_PARAGRAPH_LENGTH
        ? splitAtReadableBoundary(section)
        : [section]
    ));
  }
  return splitAtReadableBoundary(content);
};

const splitLongParagraph = (content: string) => {
  if (content.length <= MAX_REFLOW_PARAGRAPH_LENGTH) {
    return [content];
  }

  const sentences = content.match(paragraphSentencePattern) ?? [];
  const sections = sentences.length > 1
    ? groupTextUnits(sentences)
    : [content];

  return sections.flatMap((section) => (
    section.length > MAX_REFLOW_PARAGRAPH_LENGTH
      ? splitOversizedText(section)
      : [section]
  ));
};

const normalizeParagraphFlow = (
  content: string,
  context: EpubReflowContext,
) => {
  let normalized = content
    .replace(eastAsianLineBreakPattern, '$1')
    .replace(/\n+/g, ' ');

  if (context.collapseEastAsianSpacing) {
    normalized = normalized.replace(eastAsianSpacingPattern, '$1');
  }
  return normalizeBlockText(normalized);
};

const inferHeadingLevel = (features: EpubBlockFeatures) => {
  const text = features.plainText;
  const length = Array.from(text).length;

  if (
    !text
    || length > 56
    || /[撰著译校注编]$/u.test(text)
    || /[。！？；：，、．.!?;:]$/u.test(text)
  ) {
    return undefined;
  }
  if (
    numberedSectionHeadingPattern.test(text)
    || volumeSectionHeadingPattern.test(text)
    || chronicleSectionHeadingPattern.test(text)
  ) {
    return 2;
  }
  if (/^《卷[^》]{1,24}》$/u.test(text)) {
    return 2;
  }
  if (/^《[^》]{1,40}》$/u.test(text)) {
    return 3;
  }

  const semanticHeading = /(?:^|[\s_-])(?:chapter|heading|section|subhead|title)(?:[\s_-]|$)/i
    .test(features.className);
  let score = semanticHeading ? 3 : 0;

  if (features.marginTopEm >= 5) {
    score += 3;
  } else if (features.marginTopEm >= 3) {
    score += 2;
  } else if (features.marginTopEm >= 1.8 && length <= 24) {
    score += 1;
  }
  if (length <= 40) {
    score += 1;
  }
  if (length <= 26) {
    score += 1;
  }
  if (score < 3) {
    return undefined;
  }
  return features.marginTopEm >= 3 || length > 26 ? 2 : 3;
};

const normalizeEpubBlocks = (
  blocks: EpubBlock[],
  context: EpubReflowContext,
): EpubBlock[] => blocks.flatMap(
  (block): EpubBlock[] => {
    if (block.kind !== 'paragraph') {
      return [block];
    }

    const paragraphs = splitStructuredParagraph(block.content)
      .map((content) => normalizeParagraphFlow(content, context))
      .flatMap(splitLongParagraph)
      .filter(Boolean);
    if (paragraphs.length > 1) {
      return paragraphs.map((content) => ({
        kind: 'paragraph' as const,
        content,
        features: { ...block.features, plainText: cleanText(content) },
      }));
    }

    const content = paragraphs[0] ?? '';
    const features = {
      ...block.features,
      plainText: cleanText(content.replace(/<br\s*\/?\s*>/gi, ' ')),
    };
    const headingLevel = inferHeadingLevel(features);

    return headingLevel
      ? [{ kind: 'heading', content, level: headingLevel }]
      : [{ ...block, content, features }];
  },
);

const serializeEpubBlocks = (blocks: EpubBlock[]) => blocks.map((block) => {
  if (block.kind === 'heading') {
    return `${'#'.repeat(block.level)} ${block.content}`;
  }
  if (block.kind === 'blockquote') {
    return block.content.split('\n').map((line) => `> ${line}`).join('\n');
  }
  return block.content;
}).join('\n\n');

const ensureNavigationHeading = (markdown: string, title: string) => {
  const blocks = markdown.split(/\n{2,}/);
  const comparable = (value: string) => cleanText(value)
    .replace(/[*_~`\\]+/g, '')
    .normalize('NFKC')
    .toLowerCase();
  const heading = `## ${escapeEpubMarkdownText(title)}`;
  const titleKey = comparable(title);
  const existingHeading = blocks.some((block) => {
    const match = block.match(/^#{1,6}\s+(.+)$/s);

    return match ? comparable(match[1]) === titleKey : false;
  });

  if (existingHeading) {
    return markdown;
  }

  const matchingBlockIndex = blocks.findIndex((block) => (
    !/^#{1,6}\s/.test(block)
    && comparable(block) === titleKey
  ));

  if (matchingBlockIndex >= 0) {
    blocks[matchingBlockIndex] = heading;
    return blocks.join('\n\n');
  }

  const leadingHeadingCount = blocks.findIndex((block) => !/^#{1,6}\s/.test(block));
  const insertionIndex = leadingHeadingCount < 0 ? blocks.length : leadingHeadingCount;

  blocks.splice(insertionIndex, 0, heading);
  return blocks.join('\n\n');
};

export const reflowEpubChapter = (source: string, navigationTitle?: string) => {
  const document = parseEpubMarkup(source);
  const body = localNameElements(document, 'body')[0] ?? document.documentElement;
  const context = createReflowContext(document, body);
  const markdown = serializeEpubBlocks(
    normalizeEpubBlocks(extractEpubBlocks(body, context), context),
  );

  return markdown && navigationTitle
    ? ensureNavigationHeading(markdown, navigationTitle)
    : markdown;
};
