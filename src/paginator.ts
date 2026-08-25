export type TextSegment = {
  text: string;
  startOffset: number;
  paragraphStartOffset: number;
  paragraphIndex: number;
  continued: boolean;
  breakStrategy?: 'line';
};

export type PaginateTextSegmentsOptions = {
  segments: readonly TextSegment[];
  fits: (segments: readonly TextSegment[], pageIndex: number) => boolean;
  isCancelled: () => boolean;
  onPage?: (pageSegments: readonly TextSegment[], pageIndex: number) => void;
  frameBudgetMs?: number;
};

const DEFAULT_FRAME_BUDGET_MS = 8;
const MINIMUM_PUNCTUATION_BREAK_RATIO = 0.72;
const punctuationPattern = /[。！？；，、：,.!?;:\s]/u;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

type FrameClock = {
  startedAt: number;
};

const yieldChannel = new MessageChannel();
const pendingYields: Array<() => void> = [];

yieldChannel.port1.onmessage = () => pendingYields.shift()?.();
yieldChannel.port1.start();

const yieldToMainThread = () => new Promise<void>((resolve) => {
  pendingYields.push(resolve);
  yieldChannel.port2.postMessage(undefined);
});

const yieldToNextTask = async (clock: FrameClock) => {
  await yieldToMainThread();
  clock.startedAt = performance.now();
};

export const createTextSegments = (
  paragraphs: readonly string[],
): TextSegment[] => {
  let offset = 0;

  return paragraphs.map((text, paragraphIndex) => {
    const segment = {
      text,
      startOffset: offset,
      paragraphStartOffset: offset,
      paragraphIndex,
      continued: false,
    };

    offset += text.length + 1;
    return segment;
  });
};

const findFittingPrefix = async (
  segment: TextSegment,
  pageIndex: number,
  fits: PaginateTextSegmentsOptions['fits'],
  isCancelled: PaginateTextSegmentsOptions['isCancelled'],
  frameBudgetMs: number,
  clock: FrameClock,
) => {
  const graphemes: string[] = [];
  let collected = 0;

  for (const item of graphemeSegmenter.segment(segment.text)) {
    graphemes.push(item.segment);
    collected += 1;

    if (collected % 128 === 0) {
      if (isCancelled()) {
        return null;
      }
      if (performance.now() - clock.startedAt >= frameBudgetMs) {
        await yieldToNextTask(clock);
        if (isCancelled()) {
          return null;
        }
      }
    }
  }

  if (!graphemes.length || isCancelled()) {
    return null;
  }

  let lower = 1;
  let upper = graphemes.length;
  let best = 0;

  while (lower <= upper) {
    if (isCancelled()) {
      return null;
    }
    if (performance.now() - clock.startedAt >= frameBudgetMs) {
      await yieldToNextTask(clock);
      if (isCancelled()) {
        return null;
      }
    }

    const middle = Math.floor((lower + upper) / 2);
    const candidate = {
      ...segment,
      text: graphemes.slice(0, middle).join(''),
    };

    if (fits([candidate], pageIndex)) {
      best = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  if (best === 0) {
    throw new Error('The reading page cannot fit one grapheme.');
  }

  if (segment.breakStrategy === 'line') {
    const candidate = graphemes.slice(0, best).join('');
    const lineBreak = candidate.lastIndexOf('\n');

    if (lineBreak >= 0) {
      return candidate.slice(0, lineBreak + 1);
    }
  }
  const minimumBreak = Math.floor(best * MINIMUM_PUNCTUATION_BREAK_RATIO);

  for (let index = best - 1; index >= minimumBreak; index -= 1) {
    if (punctuationPattern.test(graphemes[index])) {
      best = index + 1;
      break;
    }
  }

  return graphemes.slice(0, best).join('');
};

export const paginateTextSegments = async (
  options: PaginateTextSegmentsOptions,
): Promise<TextSegment[][] | null> => {
  const frameBudgetMs = Math.max(options.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS, 0);
  const pages: TextSegment[][] = [];
  const clock = { startedAt: performance.now() };
  let cursor = 0;
  let remainder: TextSegment | null = null;

  const hasNext = () => remainder !== null || cursor < options.segments.length;
  const consumeCurrent = (nextRemainder: TextSegment | null = null) => {
    if (remainder === null) {
      cursor += 1;
    }
    remainder = nextRemainder;
  };

  while (hasNext()) {
    if (options.isCancelled()) {
      return null;
    }

    const pageIndex = pages.length;
    const pageSegments: TextSegment[] = [];

    while (hasNext()) {
      if (options.isCancelled()) {
        return null;
      }
      if (performance.now() - clock.startedAt >= frameBudgetMs) {
        await yieldToNextTask(clock);
        if (options.isCancelled()) {
          return null;
        }
      }

      const segment = remainder ?? options.segments[cursor];

      if (!segment.text) {
        consumeCurrent();
        continue;
      }

      // Reuse the page array so repeated measurements do not allocate a candidate array.
      pageSegments.push(segment);
      const candidateFits = options.fits(pageSegments, pageIndex);

      if (options.isCancelled()) {
        return null;
      }
      if (candidateFits) {
        consumeCurrent();
        continue;
      }

      pageSegments.pop();
      if (pageSegments.length) {
        break;
      }

      const prefix = await findFittingPrefix(
        segment,
        pageIndex,
        options.fits,
        options.isCancelled,
        frameBudgetMs,
        clock,
      );

      if (prefix === null || options.isCancelled()) {
        return null;
      }

      const head = { ...segment, text: prefix };
      const tailText = segment.text.slice(prefix.length);
      const tail = tailText
        ? {
            ...segment,
            text: tailText,
            startOffset: segment.startOffset + prefix.length,
            continued: true,
          }
        : null;

      pageSegments.push(head);
      consumeCurrent(tail);
      break;
    }

    if (!pageSegments.length) {
      break;
    }

    pages.push(pageSegments);
    options.onPage?.(pageSegments, pageIndex);
  }

  return options.isCancelled() ? null : pages;
};
