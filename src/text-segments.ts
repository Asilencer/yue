export type TextSegment = {
  text: string;
  startOffset: number;
  paragraphIndex: number;
};

export const createTextSegments = (
  paragraphs: readonly string[],
): TextSegment[] => {
  let offset = 0;

  return paragraphs.map((text, paragraphIndex) => {
    const segment = {
      text,
      startOffset: offset,
      paragraphIndex,
    };

    offset += text.length + 1;
    return segment;
  });
};
