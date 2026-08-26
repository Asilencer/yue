import hljs from 'highlight.js/lib/common';
import { render as renderMath } from 'katex';
import 'katex/dist/katex.min.css';
import './index.css';
import pageTurnBackwardOne from './assets/audio/page-turn-backward-01.ogg';
import pageTurnBackwardTwo from './assets/audio/page-turn-backward-02.ogg';
import pageTurnForwardOne from './assets/audio/page-turn-forward-01.ogg';
import pageTurnForwardTwo from './assets/audio/page-turn-forward-02.ogg';
import distanceCoverTemplate from './assets/covers/backgrounds/distance.jpg';
import lakeCoverTemplate from './assets/covers/backgrounds/lake.jpg';
import lettersCoverTemplate from './assets/covers/backgrounds/letters.jpg';
import northCoverTemplate from './assets/covers/backgrounds/north.jpg';
import notesCoverTemplate from './assets/covers/backgrounds/notes.jpg';
import plantsCoverTemplate from './assets/covers/backgrounds/plants.jpg';
import routeCoverTemplate from './assets/covers/backgrounds/route.jpg';
import springCoverTemplate from './assets/covers/backgrounds/spring.jpg';
import landingCityDusk from './assets/scenes/landing-city-dusk-v2.png';
import landingCityMorning from './assets/scenes/landing-city-morning-v2.png';
import landingCoastAfternoon from './assets/scenes/landing-coast-afternoon-v2.png';
import landingImage from './assets/scenes/landing-mountain-morning-v2.png';
import type { ReaderCommand } from './global';
import {
  deleteImportedBook,
  loadImportedBook,
  loadImportedBookMetadata,
  parseImportedBook,
  saveImportedBook,
  type ImportedBookChapter,
  type ImportedBookFormat,
  type ImportedInlineRun,
  type ImportedBookMetadata,
  type ImportedBookRecord,
  type ImportedSourceFormat,
} from './library-store';
import {
  createTextSegments,
  type TextSegment,
} from './text-segments';
import {
  sampleBooks,
  sampleParagraphs,
  type SampleBook,
} from './sample-library';
import { createThinkingOrb } from './thinking-orb';

type AppMode = 'landing' | 'library' | 'opening' | 'reading' | 'closing';
type Direction = 'forward' | 'backward';
type ReaderPanel = 'appearance';
type LibraryPanel = 'search' | 'import' | 'background' | 'appearance';
type LibraryCategory = 'all' | 'reading' | 'finished';
type OpenBookResult = 'opened' | 'cancelled' | 'failed';
type BookMaterial = NonNullable<SampleBook['material']>;

const libraryCategoryLabels: Record<LibraryCategory, string> = {
  all: '全部',
  reading: '在读',
  finished: '已读',
};

const libraryPanelLabels: Record<LibraryPanel, string> = {
  search: '搜索书籍',
  import: '导入书籍',
  background: '背景图',
  appearance: 'UI 配置',
};

type SourcePage = {
  paragraphs: string[];
  segments?: TextSegment[];
  formats?: ImportedBookFormat[];
  sourceFormat?: ImportedSourceFormat;
};

type ReadingPage = SourcePage & {
  startOffset: number;
  endOffset: number;
};

type Book = SampleBook & {
  paragraphs?: string[];
  chapters?: ImportedBookChapter[];
  formats?: ImportedBookFormat[];
  sourceName?: string;
  sourceFormat?: ImportedSourceFormat;
  imported?: boolean;
};

type ReaderAppearance = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  foreground: string;
  background: string;
};

type StoredReaderAppearance = Partial<ReaderAppearance> & {
  font?: 'serif' | 'sans';
};

type ReaderLocation = { anchor: number } | { ratio: number };
type ReaderPins = Record<string, ReaderLocation>;
type ReaderProgress = Record<string, ReaderLocation>;

const HIDDEN_SAMPLE_BOOKS_KEY = 'hiddenSampleBooks:v1';
const FINISHED_BOOKS_KEY = 'finishedBooks:v1';
const hiddenSampleBookIds = new Set<string>(
  (() => {
    try {
      const stored = JSON.parse(localStorage.getItem(HIDDEN_SAMPLE_BOOKS_KEY) ?? '[]');

      return Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  })(),
);
const finishedBookIds = new Set<string>(
  (() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FINISHED_BOOKS_KEY) ?? '[]');

      return Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  })(),
);

const LANDING_SCENE_KEY = 'landingScene:v1';
const landingScenes = [
  {
    id: 'mountain',
    label: '清晨山野',
    src: landingImage,
    position: 'center 48%',
    ink: 'light',
  },
  {
    id: 'coast',
    label: '午后海岸',
    src: landingCoastAfternoon,
    position: 'center',
    ink: 'dark',
  },
  {
    id: 'city-dusk',
    label: '黄昏都市',
    src: landingCityDusk,
    position: 'center',
    ink: 'light',
  },
  {
    id: 'city-morning',
    label: '清晨街景',
    src: landingCityMorning,
    position: 'center',
    ink: 'dark',
  },
] as const;
const storedLandingScene = localStorage.getItem(LANDING_SCENE_KEY);
const initialLandingSceneIndex = Math.max(
  0,
  landingScenes.findIndex((scene) => scene.id === storedLandingScene),
);
const initialLandingScene = landingScenes[initialLandingSceneIndex] ?? landingScenes[0];

const books: Book[] = sampleBooks;

const emptyPage = (offset = 0): ReadingPage => ({
  paragraphs: [],
  startOffset: offset,
  endOffset: offset,
});

let readingDocument = emptyPage();

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found');
}

const queryRequired = <T extends Element>(
  selector: string,
  root: ParentNode = app,
) => {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }

  return element;
};

const reiconImageMountain = `
  <path
    d="M21.7719 16.8773 16.0746 9.128c-.5333-.724-1.616-.724-2.148 0
      l-4.4253 6.0187-1.9253-2.6187c-.5333-.7253-1.616-.7253-2.148 0
      l-3.1973 4.3493C1.5827 17.7573 2.212 19 3.3054 19h17.3919
      c1.0933 0 1.7213-1.2427 1.0746-2.1227Z"
  />
  <circle cx="7.3333" cy="5.3333" r="2.3333" />
`;

const reiconReply2 = `
  <path d="m10 6.5-5.5 5.5 5.5 5.5" />
  <path d="M4.5 12h10.25c3.45 0 5.75-2.3 5.75-5.75" />
`;

const reiconBookmark2 = `
  <path
    d="M14 2c2 0 3 1.01 3 3.03v7.05c0 1.99-1.41 2.76-3.14 1.72l-1.32-.8
      c-.3-.18-.78-.18-1.08 0l-1.32.8C8.41 14.84 7 14.07 7 12.08V5.03C7 3.01 8 2 10 2h4Z"
  />
  <path
    d="M6.82 4.99C3.41 5.56 2 7.66 2 11.9v3.03C2 19.98 4 22 9 22h6
      c5 0 7-2.02 7-7.07V11.9c0-4.31-1.46-6.42-5-6.94"
  />
`;

const reiconSetting4 = `
  <path d="M22 6.5h-6M6 6.5H2" />
  <circle cx="10" cy="6.5" r="3.5" />
  <path d="M22 17.5h-4M8 17.5H2" />
  <circle cx="14" cy="17.5" r="3.5" />
`;

const reiconFeather = `
  <path d="M17.2986 11.6413c-.6036 4.7-4.5831 5.4245-8.7144 4.7904" />
  <path
    d="M3.6667 20.3333S5.416 4.972 20.3333 3.6667
      c-.7467 1.3013-.764 3.4733-1.2613 5.652-.6987 2.6813-3.1133 3.0147-6.072 3.0147"
  />
`;

const reiconSize = `
  <path
    d="M16.97 12.25v4.5c0 3.75-1.5 5.25-5.25 5.25h-4.5
      c-3.75 0-5.25-1.5-5.25-5.25v-4.5C1.97 8.5 3.47 7 7.22 7h4.5
      c3.75 0 5.25 1.5 5.25 5.25Z"
  />
  <path
    d="M21.97 5.85v3.3c0 2.75-1.1 3.85-3.85 3.85h-1.15v-.75
      C16.97 8.5 15.47 7 11.72 7h-.75V5.85C10.97 3.1 12.07 2 14.82 2h3.3
      c2.75 0 3.85 1.1 3.85 3.85Z"
  />
`;

const reiconParagraphSpacing = `
  <path
    fill="currentColor"
    stroke="none"
    d="M3.25 3a.75.75 0 0 1 .75-.75h16a.75.75 0 0 1 0 1.5H4A.75.75 0 0 1 3.25 3Z"
  />
  <path
    fill="currentColor"
    stroke="none"
    d="M3.25 21a.75.75 0 0 1 .75-.75h16a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1-.75-.75Z"
  />
  <path
    fill="currentColor"
    stroke="none"
    d="M12.53 4.97a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 1 0 1.06 1.06l1.72-1.719v9.378l-1.72-1.719
      a.75.75 0 0 0-1.06 1.06l3 3a.75.75 0 0 0 1.06 0l3-3a.75.75 0 0 0-1.06-1.06l-1.72 1.719
      V7.311l1.72 1.719a.75.75 0 0 0 1.06-1.06l-3-3Z"
  />
`;

const reiconBrush3 = `
  <path
    d="M9.5 19.5V18h-5c-.55 0-1.05-.22-1.41-.59A1.96 1.96 0 0 1 2.5 16
      c0-1.03.8-1.89 1.81-1.99.06-.01.12-.01.19-.01h15c.07 0 .13 0 .19.01
      .48.04.9.25 1.22.58.41.4.63.97.58 1.59-.09 1.05-1.04 1.82-2.1 1.82H14.5v1.5
      a2.5 2.5 0 0 1-5 0Z"
  />
  <path
    d="m20.17 5.3-.48 8.71c-.06-.01-.12-.01-.19-.01h-15c-.07 0-.13 0-.19.01L3.83 5.3
      C3.65 3.53 5.04 2 6.81 2h10.38c1.77 0 3.16 1.53 2.98 3.3ZM7.99 2v5M12 2v2"
  />
`;

const reiconDocumentUpload = `
  <path d="M9 17V11L7 13M9 11L11 13" />
  <path
    d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14"
  />
  <path d="M22 10H18C15 10 14 9 14 6V2L22 10Z" />
`;

const reiconSearchNormal2 = `
  <path
    d="M11.5 21C16.7467 21 21 16.7467 21 11.5C21 6.25329 16.7467 2 11.5 2
      C6.25329 2 2 6.25329 2 11.5C2 16.7467 6.25329 21 11.5 21Z"
  />
  <path d="M22 22L20 20" />
`;

const reiconTrash9 = `
  <path d="M21 5.98C17.67 5.65 14.32 5.48 10.98 5.48C9 5.48 7.02 5.58 5.04 5.78L3 5.98" />
  <path d="M8.5 4.97L8.72 3.66C8.88 2.71 9 2 10.69 2H13.31C15 2 15.13 2.75 15.28 3.67L15.5 4.97" />
  <path d="M18.85 9.14L18.2 19.21C18.09 20.78 18 22 15.21 22H8.79C6 22 5.91 20.78 5.8 19.21L5.15 9.14" />
  <path d="M10.33 16.5H13.66M9.5 12.5H14.5" />
`;

const reiconTickCircle = `
  <path d="M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10Z" />
  <path d="m7.75 12 2.83 2.83 5.67-5.66" />
`;

const readerIconPaths = {
  minimapReturn: reiconReply2,
  minimapPin: reiconBookmark2,
  libraryBackground: reiconImageMountain,
  libraryAppearance: reiconSetting4,
  appearanceFont: reiconFeather,
  appearanceSize: reiconSize,
  appearanceLineHeight: reiconParagraphSpacing,
  appearanceForeground: reiconBrush3,
  libraryImport: reiconDocumentUpload,
  librarySearch: reiconSearchNormal2,
  trash: reiconTrash9,
  finished: reiconTickCircle,
  appearanceBackground: `
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="16.25" cy="8.25" r="1.5" />
    <path d="m5.5 17 4.25-4.5 3.1 3 2.15-2.25L18.5 17" />
  `,
} as const;

type ReaderIconName = keyof typeof readerIconPaths;

const renderReaderIcon = (name: ReaderIconName) => `
  <svg
    class="reader-icon reader-icon-${name}"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >${readerIconPaths[name]}</svg>
`;

const renderBackgroundSceneButtons = () => landingScenes
  .map((scene, index) => `
    <button
      type="button"
      class="landing-scene-option"
      data-background-scene-index="${index}"
      aria-label="使用${scene.label}作为背景图"
      aria-pressed="${index === initialLandingSceneIndex}"
    >
      <img src="${scene.src}" alt="" />
      <span>${scene.label}</span>
    </button>
  `)
  .join('');

app.innerHTML = `
  <main class="app-shell" data-mode="landing">
    <div class="window-drag" aria-hidden="true"></div>

    <section
      class="landing-view view"
      aria-label="余光开始页"
      data-ui-ink="${initialLandingScene.ink}"
    >
      <img
        class="landing-scene"
        data-landing-scene
        src="${initialLandingScene.src}"
        style="object-position: ${initialLandingScene.position}"
        alt="首页背景：${initialLandingScene.label}"
      />
      <div class="landing-atmosphere" aria-hidden="true"></div>
      <button
        class="landing-entry"
        data-enter-library
        aria-label="开始阅读，进入我的书架"
      >
        <canvas
          class="landing-entry-orb"
          data-thinking-orb
          aria-hidden="true"
        ></canvas>
        <span class="landing-entry-label" aria-hidden="true">
          <span style="--char-index: 0">开</span>
          <span style="--char-index: 1">始</span>
          <span style="--char-index: 2">阅</span>
          <span style="--char-index: 3">读</span>
          <span style="--char-index: 4">.</span>
          <span style="--char-index: 5">.</span>
          <span style="--char-index: 6">.</span>
        </span>
      </button>

    </section>

    <section
      class="library-view view"
      aria-label="我的书架"
      aria-hidden="true"
      inert
      data-phase="browsing"
      data-ui-ink="${initialLandingScene.ink}"
    >
      <img
        class="library-scene"
        data-library-scene
        src="${initialLandingScene.src}"
        style="object-position: ${initialLandingScene.position}"
        alt="书架背景：${initialLandingScene.label}"
      />
      <div class="library-atmosphere" aria-hidden="true"></div>

      <aside class="library-side-rail" aria-label="书架导航">
        <nav class="library-categories" aria-label="书籍分类">
          <button data-library-category="all" aria-pressed="true">
            全部 0 本
          </button>
          <button data-library-category="reading" aria-pressed="false">
            在读 0 本
          </button>
          <button data-library-category="finished" aria-pressed="false">
            已读 0 本
          </button>
        </nav>
      </aside>

      <section class="library-content" aria-label="书籍">
        <div
          class="book-hotspots library-card-grid"
          id="library-card-grid"
          data-library-grid
          aria-label="书架上的书"
        ></div>
        <div class="library-empty" data-library-empty hidden>
          <strong data-library-empty-title></strong>
          <button type="button" data-library-empty-action></button>
        </div>
      </section>

      <input
        class="visually-hidden"
        data-import-input
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        tabindex="-1"
        aria-hidden="true"
      />

      <div class="library-drop-hint" data-library-drop-hint aria-hidden="true">
        <span>把书放入书库</span>
        <small>仅支持 EPUB</small>
      </div>

      <nav class="landing-dock library-dock config-dock" aria-label="书架工具">
        <div class="library-dock-group" role="group" aria-label="书籍工具">
          <button
            class="landing-control-button config-button"
            data-library-action="search"
            aria-label="搜索书籍"
            title="搜索书籍"
            aria-expanded="false"
            aria-controls="library-control-hub"
          >${renderReaderIcon('librarySearch')}</button>
          <button
            class="landing-control-button config-button"
            data-library-action="import"
            aria-label="导入书籍"
            title="导入书籍"
            aria-expanded="false"
            aria-controls="library-control-hub"
          >${renderReaderIcon('libraryImport')}</button>
          <button
            class="landing-control-button config-button"
            data-library-action="background"
            aria-label="设置背景图"
            title="设置背景图"
            aria-expanded="false"
            aria-controls="library-control-hub"
          >${renderReaderIcon('libraryBackground')}</button>
          <button
            class="landing-control-button config-button"
            data-library-action="appearance"
            aria-label="UI 配置"
            title="UI 配置"
            aria-expanded="false"
            aria-controls="library-control-hub"
          >${renderReaderIcon('libraryAppearance')}</button>
        </div>
      </nav>

      <section
        class="landing-hub library-hub config-panel"
        id="library-control-hub"
        data-library-panel
        aria-label="书架工具"
        aria-hidden="true"
        inert
      >
        <div class="library-hub-view library-search-view" data-library-panel-view="search">
          <label class="library-search-field">
            ${renderReaderIcon('librarySearch')}
            <span class="visually-hidden">搜索书名或作者</span>
            <input
              data-library-search
              type="search"
              placeholder="书名或作者"
              autocomplete="off"
            />
            <span class="library-search-meta" data-library-search-meta aria-live="polite"></span>
          </label>
        </div>

        <div class="library-hub-view library-import-view" data-library-panel-view="import">
          <button class="library-import-entry" type="button" data-import-choose>
            ${renderReaderIcon('libraryImport')}
            <span>
              <strong>导入书籍</strong>
              <small>EPUB</small>
            </span>
          </button>
          <div class="library-import-feedback" data-import-feedback hidden>
            <div class="library-import-summary">
              ${renderReaderIcon('libraryImport')}
              <span data-import-status>正在导入</span>
              <strong data-import-percent>0%</strong>
            </div>
            <div
              class="segmented-progress library-import-progress"
              data-import-progress
              role="progressbar"
              aria-label="导入书籍进度"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="0"
              style="--progress: 0%"
            >
              <span class="segmented-progress-track" aria-hidden="true">
                <span class="segmented-progress-fill"></span>
                <span class="segmented-progress-glow"></span>
              </span>
            </div>
            <ul class="library-import-errors" data-import-errors hidden></ul>
          </div>
        </div>

        <div
          class="landing-hub-view library-background-view"
          data-library-panel-view="background"
        >
          <div class="landing-scene-options">
            ${renderBackgroundSceneButtons()}
          </div>
        </div>

        <div
          class="library-hub-view library-appearance-view"
          data-library-panel-view="appearance"
          data-library-appearance-mount
        ></div>
      </section>

    </section>

    <section
      class="reader-view view"
      aria-label="沉浸阅读"
      aria-hidden="true"
      tabindex="-1"
      inert
    >
      <img
        class="reader-scene"
        data-reader-scene
        src="${initialLandingScene.src}"
        style="object-position: ${initialLandingScene.position}"
        alt=""
        aria-hidden="true"
      />
      <div class="reader-ambient" aria-hidden="true"></div>
      <div class="reader-surface" tabindex="0" aria-label="连续阅读正文">
        <div class="book-copy">
          <article class="page-copy reading-document" data-reading-document></article>
        </div>
      </div>
      <div class="reader-scroll-fade reader-scroll-fade-top" aria-hidden="true"></div>
      <div class="reader-scroll-fade reader-scroll-fade-bottom" aria-hidden="true"></div>

      <aside
        class="reader-chrome reader-minimap"
        data-reader-minimap
        aria-label="阅读进度"
        tabindex="0"
      >
        <div class="reader-minimap-surface">
          <header class="reader-minimap-header">
            <strong class="reader-progress-percent" data-progress-percent>0%</strong>
          </header>

          <div class="reader-minimap-body">
            <div class="reader-minimap-rail" data-reader-progress>
              <div
                class="reader-minimap-bars"
                data-reader-minimap-bars
                aria-hidden="true"
              ></div>
              <span
                class="reader-progress-bookmarks"
                data-reader-progress-bookmarks
              ></span>
              <input
                data-progress-slider
                type="range"
                min="0"
                max="100"
                value="0"
                step="0.1"
                aria-label="阅读进度"
                aria-orientation="vertical"
              />
            </div>
            <div
              class="reader-minimap-label"
              data-reader-minimap-label
              role="tooltip"
              aria-hidden="true"
            ></div>
          </div>
          <nav class="reader-minimap-actions" aria-label="阅读快捷操作">
            <button
              class="reader-minimap-action"
              data-reader-return
              type="button"
              aria-label="返回书架"
              title="返回书架"
            >${renderReaderIcon('minimapReturn')}</button>
            <button
              class="reader-minimap-action"
              data-reader-action="bookmark"
              type="button"
              aria-label="固定当前阅读位置"
              aria-pressed="false"
              title="固定当前阅读位置"
            >${renderReaderIcon('minimapPin')}</button>
          </nav>
          <span class="visually-hidden" data-reader-title></span>
        </div>
      </aside>

      <section
        class="reader-hub config-panel"
        id="reader-control-hub"
        data-reader-panel
        aria-label="阅读面板"
        aria-hidden="true"
        inert
      >
        <div
          class="reader-hub-view"
          data-panel-view="appearance"
          data-reader-appearance-mount
        >
          <form
            class="settings-options"
            data-settings-options
            data-appearance-form
          >
              <label class="appearance-field appearance-font">
                <span class="appearance-field-label">
                  ${renderReaderIcon('appearanceFont')}
                  <span>字体</span>
                </span>
                <input
                  data-appearance-input="fontFamily"
                  type="text"
                  aria-label="字体"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Songti SC"
                />
              </label>
              <label class="appearance-field appearance-size">
                <span class="appearance-field-label">
                  ${renderReaderIcon('appearanceSize')}
                  <span>字号</span>
                </span>
                <span class="appearance-size-input">
                  <input
                    data-appearance-input="fontSize"
                    type="text"
                    aria-label="字号"
                    inputmode="numeric"
                    pattern="[0-9]*"
                  />
                  <small>px</small>
                </span>
              </label>
              <label class="appearance-field" data-reader-only>
                <span class="appearance-field-label">
                  ${renderReaderIcon('appearanceLineHeight')}
                  <span>行距</span>
                </span>
                <input
                  data-appearance-input="lineHeight"
                  type="text"
                  aria-label="行距"
                  inputmode="decimal"
                  pattern="[0-9.]*"
                  placeholder="1.75"
                />
              </label>
              <label class="appearance-field">
                <span class="appearance-field-label">
                  ${renderReaderIcon('appearanceForeground')}
                  <span>字体颜色</span>
                </span>
                <span class="appearance-color-input">
                  <span data-color-preview="foreground" aria-hidden="true"></span>
                  <input
                    data-appearance-input="foreground"
                    type="text"
                    aria-label="字体颜色"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="#252B2D"
                  />
                </span>
              </label>
              <label class="appearance-field" data-reader-only>
                <span class="appearance-field-label">
                  ${renderReaderIcon('appearanceBackground')}
                  <span>纸张颜色</span>
                </span>
                <span class="appearance-color-input">
                  <span data-color-preview="background" aria-hidden="true"></span>
                  <input
                    data-appearance-input="background"
                    type="text"
                    aria-label="纸张颜色"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="#FAF8F2"
                  />
                </span>
              </label>
          </form>
        </div>
      </section>
      <p class="visually-hidden" data-reader-status role="status" aria-live="polite"></p>
    </section>

    <div class="transition-book" aria-hidden="true">
      <div class="transition-pages"></div>
      <div class="transition-cover">
        <div class="transition-cover-face transition-cover-front">
          <span data-transition-title></span>
        </div>
        <div class="transition-cover-face transition-cover-back"></div>
      </div>
    </div>

    <p class="visually-hidden" data-app-status role="status" aria-live="polite"></p>
  </main>
`;

const shell = queryRequired<HTMLElement>('.app-shell');
const landingView = queryRequired<HTMLElement>('.landing-view');
const enterLibraryButton = queryRequired<HTMLButtonElement>('[data-enter-library]');
const thinkingOrbCanvas = queryRequired<HTMLCanvasElement>('[data-thinking-orb]');
const landingSceneImage = queryRequired<HTMLImageElement>('[data-landing-scene]');
const libraryView = queryRequired<HTMLElement>('.library-view');
const bookHotspots = queryRequired<HTMLElement>('.book-hotspots');
const librarySceneImage = queryRequired<HTMLImageElement>('[data-library-scene]');
const backgroundSceneButtons = [
  ...libraryView.querySelectorAll<HTMLButtonElement>('[data-background-scene-index]'),
];
const libraryCategoryButtons = [
  ...libraryView.querySelectorAll<HTMLButtonElement>('[data-library-category]'),
];
const libraryEmpty = queryRequired<HTMLElement>('[data-library-empty]');
const libraryEmptyTitle = queryRequired<HTMLElement>('[data-library-empty-title]');
const libraryEmptyAction = queryRequired<HTMLButtonElement>('[data-library-empty-action]');
const readerView = queryRequired<HTMLElement>('.reader-view');
const readerSceneImage = queryRequired<HTMLImageElement>('[data-reader-scene]');
const readerSurface = queryRequired<HTMLElement>('.reader-surface');
const transitionBook = queryRequired<HTMLElement>('.transition-book');
const transitionCover = queryRequired<HTMLElement>('.transition-cover');
const transitionTitle = queryRequired<HTMLElement>('[data-transition-title]');
const bookCopy = queryRequired<HTMLElement>('.book-copy');
const readingDocumentElement = queryRequired<HTMLElement>('[data-reading-document]');
const readerStatus = queryRequired<HTMLElement>('[data-reader-status]');
const appStatus = queryRequired<HTMLElement>('[data-app-status]');
const importInput = queryRequired<HTMLInputElement>('[data-import-input]');
const libraryDock = queryRequired<HTMLElement>('.library-dock');
const libraryPanel = queryRequired<HTMLElement>('[data-library-panel]');
const librarySearch = queryRequired<HTMLInputElement>('[data-library-search]');
const librarySearchMeta = queryRequired<HTMLElement>('[data-library-search-meta]');
const libraryActionButtons = [
  ...libraryView.querySelectorAll<HTMLButtonElement>('[data-library-action]'),
];
const libraryImportButton = queryRequired<HTMLButtonElement>(
  '[data-library-action="import"]',
);
const librarySearchButton = queryRequired<HTMLButtonElement>(
  '[data-library-action="search"]',
);
const libraryAppearanceButton = queryRequired<HTMLButtonElement>(
  '[data-library-action="appearance"]',
);
const libraryAppearanceMount = queryRequired<HTMLElement>(
  '[data-library-appearance-mount]',
);
const importProgress = queryRequired<HTMLElement>('[data-import-progress]');
const importStatus = queryRequired<HTMLElement>('[data-import-status]');
const importPercent = queryRequired<HTMLElement>('[data-import-percent]');
const importChooseButton = queryRequired<HTMLButtonElement>('[data-import-choose]');
const importFeedback = queryRequired<HTMLElement>('[data-import-feedback]');
const importErrors = queryRequired<HTMLUListElement>('[data-import-errors]');
const settingsOptions = queryRequired<HTMLFormElement>('[data-settings-options]');
const readerAppearanceMount = queryRequired<HTMLElement>('[data-reader-appearance-mount]');
const fontFamilyInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="fontFamily"]',
);
const fontSizeInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="fontSize"]',
);
const lineHeightInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="lineHeight"]',
);
const foregroundInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="foreground"]',
);
const backgroundInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="background"]',
);
const readerTitle = queryRequired<HTMLElement>('[data-reader-title]');
const readerMinimap = queryRequired<HTMLElement>('[data-reader-minimap]');
const readerMinimapBars = queryRequired<HTMLElement>('[data-reader-minimap-bars]');
const readerMinimapLabel = queryRequired<HTMLElement>('[data-reader-minimap-label]');
const readerProgress = queryRequired<HTMLElement>('[data-reader-progress]');
const progressSlider = queryRequired<HTMLInputElement>('[data-progress-slider]');
const progressPercent = queryRequired<HTMLElement>('[data-progress-percent]');
const progressBookmarks = queryRequired<HTMLElement>(
  '[data-reader-progress-bookmarks]',
);
const returnButton = queryRequired<HTMLButtonElement>('[data-reader-return]');
const bookmarkButton = queryRequired<HTMLButtonElement>(
  '[data-reader-action="bookmark"]',
);
const readerPanel = queryRequired<HTMLElement>('[data-reader-panel]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const APPEARANCE_KEY = 'readerAppearance:v4';
const PREVIOUS_APPEARANCE_KEY = 'readerAppearance:v3';
const OLDER_APPEARANCE_KEY = 'readerAppearance:v2';
const LEGACY_APPEARANCE_KEY = 'readerAppearance:v1';
const PROGRESS_KEY = 'readerProgress:v2';
const LEGACY_PROGRESS_KEY = 'readerProgress:v1';
const PINS_KEY = 'readerPins:v2';
const LEGACY_PINS_KEY = 'readerPins:v1';
const LAST_BOOK_KEY = 'lastOpenedBook:v1';
const PAGE_SOUND_KEY = 'pageSound:v1';
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const MIN_LINE_HEIGHT = 1.2;
const MAX_LINE_HEIGHT = 2.2;
const defaultAppearance: ReaderAppearance = {
  fontFamily: 'Songti SC',
  fontSize: 17,
  lineHeight: 1.75,
  foreground: '#252b2d',
  background: '#faf8f2',
};

let mode: AppMode = 'landing';
let activeBook = books[0];
let activeTrigger: HTMLButtonElement | null = null;
let activePageSound: HTMLAudioElement | null = null;
const pageSoundEnabled = localStorage.getItem(PAGE_SOUND_KEY) !== 'false';
let paperAudioWarningShown = false;
const lastPageSoundIndex: Record<Direction, number> = {
  forward: -1,
  backward: -1,
};
let activeAnimations: Animation[] = [];
let importedBooks: ImportedBookMetadata[] = [];
let openRequestRevision = 0;
let loadingBookId: string | null = null;
let readingDocumentPreparing = false;
let appearanceInputTimer: number | undefined;
let scrollProgressFrame: number | undefined;
let scrollProgressSaveTimer: number | undefined;
let minimapMotionFrame: number | undefined;
let progressScrubbing = false;
let activePanel: ReaderPanel | null = null;
let panelInvoker: HTMLElement | null = null;
let activeLibraryPanel: LibraryPanel | null = null;
let libraryPanelInvoker: HTMLElement | null = null;
let matchedLibraryBooks: Book[] = [];
let activeLibraryCategory: LibraryCategory = 'all';
let libraryOpenInProgress = false;
let importInProgress = false;
let importProgressTimer: number | undefined;
let libraryIdleTimer: number | undefined;
let libraryReturnInProgress = false;
let openImportOnLibraryEntry = false;
let landingSceneIndex = initialLandingSceneIndex;
let landingSceneRevision = 0;
let lastOpenedBookId = localStorage.getItem(LAST_BOOK_KEY) ?? '';
let appearance = { ...defaultAppearance };
let readingProgress: ReaderProgress = {};
let readerPins: ReaderPins = {};
let stopThinkingOrb: () => void = () => undefined;
const pendingRemovals = new Map<string, ImportedBookMetadata>();
const loadedBookCache = new Map<string, Book>();
const MAX_LOADED_BOOK_CACHE_ENTRIES = 3;
const LIBRARY_IDLE_RETURN_MS = 30 * 1000;

const cacheLoadedBook = (book: Book) => {
  loadedBookCache.delete(book.id);
  loadedBookCache.set(book.id, book);
  while (loadedBookCache.size > MAX_LOADED_BOOK_CACHE_ENTRIES) {
    const oldestId = loadedBookCache.keys().next().value as string | undefined;

    if (!oldestId) {
      return;
    }
    loadedBookCache.delete(oldestId);
  }
};

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const waitForAnimations = async (
  animations: Animation[],
  timeoutMs: number,
) => {
  let timeout: number | undefined;

  // Electron may leave animation.finished pending while a window is throttled.
  await Promise.race([
    Promise.all(
      animations.map((animation) => animation.finished.catch((): void => undefined)),
    ),
    new Promise<void>((resolve) => {
      timeout = window.setTimeout(resolve, timeoutMs);
    }),
  ]);
  window.clearTimeout(timeout);
};

const setLandingScene = (nextIndex: number) => {
  const scene = landingScenes[nextIndex];

  if (!scene || nextIndex === landingSceneIndex) {
    return;
  }

  const revision = ++landingSceneRevision;
  const preload = new Image();

  preload.addEventListener('load', () => {
    if (revision !== landingSceneRevision) {
      return;
    }

    landingSceneImage.classList.add('is-changing');
    window.setTimeout(() => {
      if (revision !== landingSceneRevision) {
        return;
      }

      landingSceneIndex = nextIndex;
      landingSceneImage.src = scene.src;
      landingSceneImage.style.objectPosition = scene.position;
      landingSceneImage.alt = `首页背景：${scene.label}`;
      landingView.dataset.uiInk = scene.ink;
      librarySceneImage.src = scene.src;
      librarySceneImage.style.objectPosition = scene.position;
      librarySceneImage.alt = `书架背景：${scene.label}`;
      libraryView.dataset.uiInk = scene.ink;
      readerSceneImage.src = scene.src;
      readerSceneImage.style.objectPosition = scene.position;
      backgroundSceneButtons.forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(Number(button.dataset.backgroundSceneIndex) === nextIndex),
        );
      });
      localStorage.setItem(LANDING_SCENE_KEY, scene.id);
      requestAnimationFrame(() => landingSceneImage.classList.remove('is-changing'));
    }, 140);
  }, { once: true });
  preload.src = scene.src;
};

const createTextElement = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
) => {
  const element = document.createElement(tagName);

  element.className = className;
  element.textContent = text;
  return element;
};

const AUTO_HIGHLIGHT_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'css',
  'go',
  'java',
  'javascript',
  'json',
  'markdown',
  'python',
  'rust',
  'sql',
  'typescript',
  'xml',
  'yaml',
];
const highlightedCodeCache = new Map<string, string>();

const highlightCode = (code: HTMLElement, source: string, declaredLanguage: string) => {
  const language = declaredLanguage.toLowerCase();
  const cacheKey = `${language}\0${source}`;
  const cached = highlightedCodeCache.get(cacheKey);

  code.className = 'hljs';
  if (cached !== undefined) {
    code.innerHTML = cached;
    return;
  }
  if (source.length > 20_000) {
    code.textContent = source;
    return;
  }

  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(source, { language, ignoreIllegals: true }).value
    : source.trim().length >= 24
      ? hljs.highlightAuto(source, AUTO_HIGHLIGHT_LANGUAGES).value
      : undefined;

  if (highlighted === undefined) {
    code.textContent = source;
    return;
  }
  code.innerHTML = highlighted;
  highlightedCodeCache.set(cacheKey, highlighted);
  if (highlightedCodeCache.size > 128) {
    const oldestKey = highlightedCodeCache.keys().next().value as string | undefined;

    if (oldestKey) {
      highlightedCodeCache.delete(oldestKey);
    }
  }
};

const createMathElement = (source: string, displayMode: boolean) => {
  const element = document.createElement(displayMode ? 'div' : 'span');

  element.className = displayMode ? 'markdown-math-block' : 'markdown-math-inline';
  renderMath(source, element, {
    displayMode,
    errorColor: 'currentColor',
    maxExpand: 1_000,
    maxSize: 20,
    output: 'htmlAndMathml',
    strict: 'ignore',
    throwOnError: false,
    trust: false,
  });
  return element;
};

const sliceInlineRuns = (
  runs: readonly ImportedInlineRun[],
  start: number,
  length: number,
) => {
  const end = start + length;
  const sliced: ImportedInlineRun[] = [];
  let offset = 0;

  runs.forEach((run) => {
    const runEnd = offset + run.value.length;
    const overlapStart = Math.max(start, offset);
    const overlapEnd = Math.min(end, runEnd);

    if (overlapStart < overlapEnd) {
      sliced.push({
        kind: run.kind,
        value: run.value.slice(overlapStart - offset, overlapEnd - offset),
        ...(run.marks ? { marks: run.marks } : {}),
      });
    }
    offset = runEnd;
  });
  return sliced;
};

const appendInlineRuns = (
  target: HTMLElement,
  runs: readonly ImportedInlineRun[],
) => {
  runs.forEach((run) => {
    if (run.kind === 'break') {
      target.append(document.createElement('br'));
      return;
    }
    let node: Node = run.kind === 'text'
      ? document.createTextNode(run.value)
      : run.kind === 'code'
        ? createTextElement(
            'code',
            run.value.includes('\n')
              ? 'markdown-inline-code markdown-inline-code-multiline'
              : 'markdown-inline-code',
            run.value,
          )
        : createMathElement(run.value, false);

    (run.marks ?? []).forEach((mark) => {
      const wrapper = document.createElement(
        mark === 'strong' ? 'strong' : mark === 'emphasis' ? 'em' : 's',
      );

      wrapper.append(node);
      node = wrapper;
    });
    target.append(node);
  });
};

const appendInlineContent = (
  target: HTMLElement,
  segment: TextSegment,
  format?: ImportedBookFormat,
) => {
  const inlines = format && 'inlines' in format ? format.inlines : undefined;
  if (!inlines) {
    target.append(document.createTextNode(segment.text));
    return;
  }

  appendInlineRuns(
    target,
    sliceInlineRuns(inlines, 0, segment.text.length),
  );
};

const createMarkdownTable = (
  segments: TextSegment[],
  formats: Extract<ImportedBookFormat, { kind: 'table-row' }>[],
) => {
  const wrapper = document.createElement('div');
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');

  wrapper.className = 'markdown-table-wrap';
  table.className = 'markdown-table';
  if (segments[0]) {
    wrapper.dataset.textOffset = String(segments[0].startOffset);
  }
  segments.forEach((segment, rowIndex) => {
    const format = formats[rowIndex];
    const row = document.createElement('tr');

    row.dataset.textOffset = String(segment.startOffset);
    format.cells.forEach((value, cellIndex) => {
      const cell = document.createElement(format.header ? 'th' : 'td');
      const alignment = format.alignments[cellIndex] ?? 'left';
      const inlines = format.cellInlines?.[cellIndex];

      if (inlines) {
        appendInlineRuns(cell, inlines);
      } else {
        cell.textContent = value;
      }
      cell.dataset.align = alignment;
      if (format.header) {
        cell.scope = 'col';
      }
      row.append(cell);
    });
    (format.header ? head : body).append(row);
  });
  if (head.children.length) {
    table.append(head);
  }
  if (body.children.length) {
    table.append(body);
  }
  wrapper.append(table);
  return wrapper;
};

type MarkdownListFormat = Extract<ImportedBookFormat, { kind: 'list-item' }>;
type MarkdownListEntry = {
  segment: TextSegment;
  format: MarkdownListFormat;
};

const createMarkdownListGroup = (entries: MarkdownListEntry[]) => {
  const fragment = document.createDocumentFragment();

  const appendLevel = (
    parent: DocumentFragment | HTMLLIElement,
    startIndex: number,
    depth: number,
  ) => {
    let index = startIndex;

    while (index < entries.length && entries[index].format.depth === depth) {
      const ordered = entries[index].format.ordered;
      const list = document.createElement(ordered ? 'ol' : 'ul');

      list.className = 'markdown-list';
      list.dataset.depth = String(depth);
      list.dataset.textOffset = String(entries[index].segment.startOffset);
      if (ordered) {
        (list as HTMLOListElement).start = entries[index].format.ordinal;
      }

      while (
        index < entries.length
        && entries[index].format.depth === depth
        && entries[index].format.ordered === ordered
      ) {
        const { segment, format } = entries[index];
        const item = document.createElement('li');

        item.dataset.textOffset = String(segment.startOffset);
        if (ordered) {
          item.value = format.ordinal;
        }
        if (format.checked !== undefined) {
          const marker = createTextElement(
            'span',
            'markdown-task-marker',
            format.checked ? '✓' : '',
          );

          marker.setAttribute('role', 'checkbox');
          marker.setAttribute('aria-checked', String(format.checked));
          item.classList.add('is-task');
          item.append(marker);
        }
        appendInlineContent(item, segment, format);
        list.append(item);
        index += 1;

        if (index < entries.length && entries[index].format.depth > depth) {
          index = appendLevel(item, index, entries[index].format.depth);
        }
        if (index < entries.length && entries[index].format.depth < depth) {
          break;
        }
      }
      parent.append(list);
      if (index < entries.length && entries[index].format.depth < depth) {
        break;
      }
    }
    return index;
  };

  let index = 0;
  while (index < entries.length) {
    index = appendLevel(fragment, index, entries[index].format.depth);
  }
  return fragment;
};

const appendStructuredPageContent = (pageBody: HTMLElement, page: SourcePage) => {
  const segments = page.segments ?? createTextSegments(page.paragraphs);
  const formatByParagraph = new Map(
    (page.formats ?? []).map((format) => [format.paragraphIndex, format]),
  );
  let index = 0;

  while (index < segments.length) {
    const segment = segments[index];
    const format = formatByParagraph.get(segment.paragraphIndex);

    if (!format) {
      const paragraph = createTextElement('p', '', segment.text);

      paragraph.dataset.textOffset = String(segment.startOffset);
      pageBody.append(paragraph);
      index += 1;
      continue;
    }
    if (format.kind === 'list-item') {
      const entries: MarkdownListEntry[] = [];

      while (index < segments.length) {
        const itemSegment = segments[index];
        const itemFormat = formatByParagraph.get(itemSegment.paragraphIndex);

        if (
          itemFormat?.kind !== 'list-item'
          || itemFormat.groupId !== format.groupId
        ) {
          break;
        }
        entries.push({ segment: itemSegment, format: itemFormat });
        index += 1;
      }
      pageBody.append(createMarkdownListGroup(entries));
      continue;
    }
    if (format.kind === 'table-row') {
      const tableSegments: TextSegment[] = [];
      const tableFormats: Extract<ImportedBookFormat, { kind: 'table-row' }>[] = [];

      while (index < segments.length) {
        const rowSegment = segments[index];
        const rowFormat = formatByParagraph.get(rowSegment.paragraphIndex);

        if (rowFormat?.kind !== 'table-row' || rowFormat.groupId !== format.groupId) {
          break;
        }
        tableSegments.push(rowSegment);
        tableFormats.push(rowFormat);
        index += 1;
      }
      pageBody.append(createMarkdownTable(tableSegments, tableFormats));
      continue;
    }
    if (format.kind === 'heading') {
      const level = Math.min(Math.max(format.level, 2), 6) as 2 | 3 | 4 | 5 | 6;
      const heading = document.createElement(`h${level}`);

      heading.className = 'markdown-heading';
      heading.dataset.textOffset = String(segment.startOffset);
      appendInlineContent(heading, segment, format);
      pageBody.append(heading);
    } else if (format.kind === 'blockquote') {
      const quote = document.createElement('blockquote');

      quote.className = 'markdown-blockquote';
      quote.dataset.textOffset = String(segment.startOffset);
      appendInlineContent(quote, segment, format);
      pageBody.append(quote);
    } else if (format.kind === 'code-block') {
      const code = document.createElement('code');
      const pre = document.createElement('pre');

      pre.className = 'markdown-code';
      pre.dataset.textOffset = String(segment.startOffset);
      if (format.language) {
        pre.dataset.language = format.language;
      }
      highlightCode(code, segment.text, format.language);
      pre.append(code);
      pageBody.append(pre);
    } else if (format.kind === 'math-block') {
      const math = createMathElement(segment.text, true);

      math.dataset.textOffset = String(segment.startOffset);
      pageBody.append(math);
    } else if (format.kind === 'rich-text') {
      const paragraph = document.createElement('p');

      paragraph.dataset.textOffset = String(segment.startOffset);
      appendInlineContent(paragraph, segment, format);
      pageBody.append(paragraph);
    } else {
      const rule = document.createElement('hr');

      rule.className = 'markdown-rule';
      rule.dataset.textOffset = String(segment.startOffset);
      pageBody.append(rule);
    }
    index += 1;
  }
};

const createPageElement = (page: SourcePage) => {
  const pageInner = document.createElement('div');
  const pageBody = document.createElement('div');

  pageInner.className = 'page-inner';
  if (page.sourceFormat) {
    pageInner.dataset.sourceFormat = page.sourceFormat;
  }
  pageBody.className = 'page-body';

  appendStructuredPageContent(pageBody, page);
  pageInner.append(pageBody);
  return pageInner;
};

const renderReadingDocument = () => {
  readingLayoutPoints = [];
  readingDocumentElement.replaceChildren(createPageElement(readingDocument));
  updateReaderNavigation();
  renderProgressBookmarks();
};

const normalizeHexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);

  if (!match) {
    return null;
  }
  const hex = match[1].length === 3
    ? [...match[1]].map((character) => character.repeat(2)).join('')
    : match[1];

  return `#${hex.toLowerCase()}`;
};

const parseFontFamilies = (value: unknown): string[] | null => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) {
    return null;
  }

  const families = value.split(',').map((item) => {
    const family = item.trim();
    const quote = family[0];

    if (quote === '"' || quote === "'") {
      if (family.at(-1) !== quote) {
        return '';
      }
      return family.slice(1, -1).trim();
    }
    return family;
  });

  const invalid = families.some((family) => (
    !family
    || family.length > 64
    || [...family].some((character) => (
      character.charCodeAt(0) < 32 || ';{}/,"\'\\'.includes(character)
    ))
  ));

  return invalid ? null : families;
};

const isFontFamily = (value: unknown): value is string => (
  Boolean(parseFontFamilies(value))
);

const toCssFontFamily = (value: string) => (
  `${parseFontFamilies(value)?.map((family) => JSON.stringify(family)).join(', ')}, serif`
);

const readAppearance = (): ReaderAppearance => {
  try {
    const currentRaw = localStorage.getItem(APPEARANCE_KEY);
    const previousRaw = localStorage.getItem(PREVIOUS_APPEARANCE_KEY);
    const olderRaw = localStorage.getItem(OLDER_APPEARANCE_KEY);
    const stored = JSON.parse(
      currentRaw
        ?? previousRaw
        ?? olderRaw
        ?? localStorage.getItem(LEGACY_APPEARANCE_KEY)
        ?? '{}',
    ) as StoredReaderAppearance;
    const fontFamily = isFontFamily(stored.fontFamily)
      ? stored.fontFamily.trim()
      : stored.font === 'sans'
        ? 'PingFang SC'
        : defaultAppearance.fontFamily;
    const fontSize = !currentRaw && !previousRaw && olderRaw && stored.fontSize === 18
      ? defaultAppearance.fontSize
      : typeof stored.fontSize === 'number'
      && Number.isFinite(stored.fontSize)
      && Number.isInteger(stored.fontSize)
      && stored.fontSize >= MIN_FONT_SIZE
      && stored.fontSize <= MAX_FONT_SIZE
        ? stored.fontSize
        : defaultAppearance.fontSize;
    const lineHeight = typeof stored.lineHeight === 'number'
      && Number.isFinite(stored.lineHeight)
      && stored.lineHeight >= MIN_LINE_HEIGHT
      && stored.lineHeight <= MAX_LINE_HEIGHT
        ? stored.lineHeight
        : defaultAppearance.lineHeight;
    const foreground = normalizeHexColor(stored.foreground)
      ?? defaultAppearance.foreground;
    const background = normalizeHexColor(stored.background)
      ?? defaultAppearance.background;

    const nextAppearance = {
      fontFamily,
      fontSize,
      lineHeight,
      foreground,
      background,
    };

    if (currentRaw !== JSON.stringify(nextAppearance)) {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(nextAppearance));
    }
    return nextAppearance;
  } catch {
    return { ...defaultAppearance };
  }
};

const readProgress = () => {
  try {
    const currentRaw = localStorage.getItem(PROGRESS_KEY);
    const stored = JSON.parse(
      currentRaw ?? localStorage.getItem(LEGACY_PROGRESS_KEY) ?? '{}',
    ) as unknown;

    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }

    const progress: ReaderProgress = {};

    Object.entries(stored).forEach(([bookId, value]) => {
      if (
        !currentRaw
        && typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
      ) {
        progress[bookId] = value <= 1 ? { ratio: value } : { anchor: value };
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      const candidate = value as Record<string, unknown>;

      if (
        typeof candidate.anchor === 'number'
        && Number.isFinite(candidate.anchor)
        && candidate.anchor >= 0
      ) {
        progress[bookId] = { anchor: candidate.anchor };
      } else if (
        typeof candidate.ratio === 'number'
        && Number.isFinite(candidate.ratio)
        && candidate.ratio >= 0
        && candidate.ratio <= 1
      ) {
        progress[bookId] = { ratio: candidate.ratio };
      }
    });
    if (!currentRaw && Object.keys(progress).length) {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    }
    return progress;
  } catch {
    return {};
  }
};

const readPins = (): ReaderPins => {
  try {
    const currentRaw = localStorage.getItem(PINS_KEY);
    const stored = JSON.parse(
      currentRaw ?? localStorage.getItem(LEGACY_PINS_KEY) ?? '{}',
    ) as unknown;

    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }

    const pins: ReaderPins = {};

    Object.entries(stored).forEach(([bookId, value]) => {
      if (
        !currentRaw
        && typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && value <= 1
      ) {
        pins[bookId] = { ratio: value };
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.anchor === 'number'
        && Number.isFinite(candidate.anchor)
        && candidate.anchor >= 0
      ) {
        pins[bookId] = { anchor: candidate.anchor };
        return;
      }
      if (
        typeof candidate.ratio === 'number'
        && Number.isFinite(candidate.ratio)
        && candidate.ratio >= 0
        && candidate.ratio <= 1
      ) {
        pins[bookId] = { ratio: candidate.ratio };
      }
    });

    if (!currentRaw && Object.keys(pins).length) {
      localStorage.setItem(PINS_KEY, JSON.stringify(pins));
    }
    return pins;
  } catch {
    return {};
  }
};

const updateColorPreview = (name: 'foreground' | 'background') => {
  const preview = queryRequired<HTMLElement>(`[data-color-preview="${name}"]`);
  const input = name === 'foreground' ? foregroundInput : backgroundInput;
  const value = input.value.trim();
  const normalized = normalizeHexColor(value);

  preview.style.backgroundColor = normalized ?? 'transparent';
  preview.classList.toggle('is-invalid', Boolean(value) && !normalized);
};

const updateAppearanceControls = () => {
  fontFamilyInput.value = appearance.fontFamily;
  fontSizeInput.value = String(appearance.fontSize);
  lineHeightInput.value = String(appearance.lineHeight);
  foregroundInput.value = appearance.foreground.toUpperCase();
  backgroundInput.value = appearance.background.toUpperCase();
  updateColorPreview('foreground');
  updateColorPreview('background');
};

const applyAppearance = (
  nextAppearance: ReaderAppearance,
  persist = true,
  syncControls = true,
) => {
  const readingAnchor = mode === 'reading' ? getCurrentAnchor() : null;

  appearance = nextAppearance;
  const fontFamily = toCssFontFamily(appearance.fontFamily);

  shell.style.setProperty('--reader-font', fontFamily);
  shell.style.setProperty('--reader-ui-font', fontFamily);
  shell.style.setProperty('--reader-font-size', `${appearance.fontSize}px`);
  readerView.style.setProperty('--reader-line-height', String(appearance.lineHeight));
  readerView.style.setProperty('--reader-ink', appearance.foreground);
  readerView.style.setProperty('--reader-paper-background', appearance.background);
  if (syncControls) {
    updateAppearanceControls();
  }

  if (persist) {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  }
  if (readingAnchor !== null) {
    void afterPaint().then(() => {
      refreshReadingLayout();
      renderReaderMinimapBars();
      scrollToAnchor(readingAnchor, 'auto');
      updateReaderNavigation();
      renderProgressBookmarks();
    });
  }
};

const readAppearanceForm = (): ReaderAppearance | null => {
  const fontFamily = fontFamilyInput.value.trim();
  const fontSize = Number(fontSizeInput.value);
  const lineHeight = Number(lineHeightInput.value);
  const foreground = normalizeHexColor(foregroundInput.value);
  const background = normalizeHexColor(backgroundInput.value);
  const validFont = isFontFamily(fontFamily);
  const validSize = Number.isFinite(fontSize)
    && Number.isInteger(fontSize)
    && fontSize >= MIN_FONT_SIZE
    && fontSize <= MAX_FONT_SIZE;
  const validLineHeight = Number.isFinite(lineHeight)
    && lineHeight >= MIN_LINE_HEIGHT
    && lineHeight <= MAX_LINE_HEIGHT;
  const validForeground = Boolean(foreground);
  const validBackground = Boolean(background);

  fontFamilyInput.setAttribute('aria-invalid', String(!validFont));
  fontSizeInput.setAttribute('aria-invalid', String(!validSize));
  lineHeightInput.setAttribute('aria-invalid', String(!validLineHeight));
  foregroundInput.setAttribute('aria-invalid', String(!validForeground));
  backgroundInput.setAttribute('aria-invalid', String(!validBackground));

  return validFont && validSize && validLineHeight && foreground && background
    ? { fontFamily, fontSize, lineHeight, foreground, background }
    : null;
};

const resetAppearanceFormState = () => {
  updateAppearanceControls();
  settingsOptions.querySelectorAll('input').forEach((input) => {
    input.removeAttribute('aria-invalid');
  });
};

const getScrollRange = () => Math.max(
  readerSurface.scrollHeight - readerSurface.clientHeight,
  0,
);

const getReadingBlocks = () => [
  ...readingDocumentElement.querySelectorAll<HTMLElement>('[data-text-offset]'),
];

type ReadingLayoutPoint = {
  anchor: number;
  top: number;
};

let readingLayoutPoints: ReadingLayoutPoint[] = [];

const refreshReadingLayout = () => {
  const surfaceBounds = readerSurface.getBoundingClientRect();

  readingLayoutPoints = getReadingBlocks().flatMap((element) => {
    const anchor = Number(element.dataset.textOffset);

    if (!Number.isFinite(anchor)) {
      return [];
    }
    return [{
      anchor,
      top: readerSurface.scrollTop
        + element.getBoundingClientRect().top
        - surfaceBounds.top,
    }];
  });
};

const findLayoutPoint = (value: number, key: keyof ReadingLayoutPoint) => {
  let low = 0;
  let high = readingLayoutPoints.length - 1;
  let match: ReadingLayoutPoint | undefined;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = readingLayoutPoints[middle];

    if (point[key] <= value) {
      match = point;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match ?? readingLayoutPoints[0];
};

const getAnchorScrollTop = (anchor: number) => {
  const range = getScrollRange();

  if (anchor >= readingDocument.endOffset) {
    return range;
  }
  const point = findLayoutPoint(anchor, 'anchor');
  if (!point) {
    return 0;
  }
  const top = point.top - Math.min(48, readerSurface.clientHeight * 0.08);

  return Math.max(0, Math.min(range, top));
};

const scrollToAnchor = (
  anchor: number,
  behavior: ScrollBehavior = reducedMotion.matches ? 'auto' : 'smooth',
) => {
  readerSurface.scrollTo({
    top: getAnchorScrollTop(anchor),
    behavior,
  });
};

const getAnchorAtScrollTop = (scrollTop: number) => {
  const range = getScrollRange();

  if (range === 0) {
    return readingDocument.startOffset;
  }
  if (scrollTop >= range - 1) {
    return readingDocument.endOffset;
  }
  const readingLine = Math.max(0, scrollTop)
    + Math.min(48, readerSurface.clientHeight * 0.08);

  return findLayoutPoint(readingLine, 'top')?.anchor ?? readingDocument.startOffset;
};

const getCurrentAnchor = () => getAnchorAtScrollTop(readerSurface.scrollTop);

const resolveReaderLocation = (location: ReaderLocation) => {
  if ('anchor' in location) {
    return Math.max(
      readingDocument.startOffset,
      Math.min(readingDocument.endOffset, location.anchor),
    );
  }
  return getAnchorAtScrollTop(getScrollRange() * location.ratio);
};

const persistReadingProgress = () => {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(readingProgress));
};

const persistReaderPins = () => {
  localStorage.setItem(PINS_KEY, JSON.stringify(readerPins));
};

const getPinnedAnchor = () => {
  const pin = readerPins[activeBook.id];

  if (!pin) {
    return undefined;
  }
  if ('ratio' in pin && !readingLayoutPoints.length) {
    return undefined;
  }

  const anchor = resolveReaderLocation(pin);

  if ('ratio' in pin) {
    readerPins[activeBook.id] = { anchor };
    persistReaderPins();
  }
  return anchor;
};

const getAnchorProgressRatio = (anchor: number) => {
  const range = getScrollRange();

  return range > 0
    ? getAnchorScrollTop(anchor) / range
    : anchor / Math.max(readingDocument.endOffset, 1);
};

const getBookLength = (book: Book) => getBookParagraphs(book)
  .reduce((length, paragraph) => length + paragraph.length + 1, 0);

const setSegmentedProgress = (
  root: HTMLElement,
  label: HTMLElement,
  value: number,
) => {
  const percent = Math.max(0, Math.min(100, value));

  root.style.setProperty('--progress', `${percent.toFixed(3)}%`);
  root.classList.toggle('is-empty', percent === 0);
  label.textContent = `${Math.round(percent)}%`;
};

const setImportPresentation = (importing: boolean) => {
  importChooseButton.hidden = importing;
  importFeedback.hidden = !importing;
};

const MINIMAP_BAR_COUNT = 32;

const renderReaderMinimapBars = () => {
  const scrollRange = getScrollRange();
  const chapters = getChapterEntries(activeBook).map((chapter) => ({
    title: chapter.title,
    position: scrollRange > 0
      ? getAnchorScrollTop(chapter.anchor) / scrollRange
      : chapter.anchor / Math.max(getBookLength(activeBook), 1),
  }));
  const bars = Array.from({ length: MINIMAP_BAR_COUNT }, (_, index) => {
    const ratio = index / (MINIMAP_BAR_COUNT - 1);
    const chapter = chapters.findLast((entry) => entry.position <= ratio);
    const bar = document.createElement('span');

    bar.className = 'reader-minimap-bar';
    bar.dataset.progress = String(ratio);
    bar.dataset.title = chapter?.title ?? activeBook.title;
    return bar;
  });

  readerMinimapBars.replaceChildren(...bars);
};

const updateMinimapBars = (ratio: number) => {
  const bars = [
    ...readerMinimapBars.querySelectorAll<HTMLElement>('.reader-minimap-bar'),
  ];
  let closestBar: HTMLElement | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  bars.forEach((bar) => {
    const barRatio = Number(bar.dataset.progress);
    const distance = Math.abs(barRatio - ratio);

    bar.classList.toggle('is-read', barRatio <= ratio);
    if (distance < closestDistance) {
      closestBar = bar;
      closestDistance = distance;
    }
  });
  bars.forEach((bar) => bar.classList.toggle('is-current', bar === closestBar));
};

const renderProgressBookmarks = () => {
  const pinnedAnchor = getPinnedAnchor();
  const markers = typeof pinnedAnchor === 'number' ? [pinnedAnchor].map((anchor) => {
    const marker = document.createElement('button');
    const ratio = getAnchorProgressRatio(anchor);
    const position = ratio * 100;

    marker.className = 'reader-progress-bookmark';
    marker.type = 'button';
    marker.textContent = '📌';
    marker.disabled = readingDocumentPreparing;
    marker.style.setProperty('--bookmark-position', `${position.toFixed(3)}%`);
    marker.setAttribute('aria-label', `跳到 Pin，约 ${Math.round(position)}%`);
    marker.addEventListener('click', () => scrollToAnchor(anchor));
    return marker;
  }) : [];

  progressBookmarks.replaceChildren(...markers);
};

function updateReaderNavigation() {
  const scrollRange = getScrollRange();
  const ratio = scrollRange > 0
    ? readerSurface.scrollTop / scrollRange
    : 0;
  const percent = ratio * 100;
  const pinnedAnchor = getPinnedAnchor();
  const currentAnchor = getCurrentAnchor();
  const pinnedHere = pinnedAnchor === currentAnchor;

  readerTitle.textContent = activeBook.title;
  progressSlider.min = '0';
  progressSlider.max = '100';
  progressSlider.step = '0.1';
  if (!progressScrubbing) {
    progressSlider.value = String(Math.max(0, Math.min(100, percent)));
  }
  progressSlider.disabled = readingDocumentPreparing || scrollRange === 0;
  progressSlider.setAttribute(
    'aria-valuetext',
    readingDocumentPreparing
      ? '正文正在载入'
      : `${Math.round(percent)}%`,
  );
  setSegmentedProgress(readerProgress, progressPercent, percent);
  updateMinimapBars(ratio);
  bookmarkButton.setAttribute('aria-pressed', String(typeof pinnedAnchor === 'number'));
  const bookmarkLabel = typeof pinnedAnchor !== 'number'
    ? '固定当前阅读位置'
    : pinnedHere ? '移除阅读标记' : '更新固定位置';

  bookmarkButton.setAttribute('aria-label', bookmarkLabel);
  bookmarkButton.title = bookmarkLabel;
}

const getBookChapters = (book: Book) => (
  book.imported
    ? book.chapters ?? []
    : [{ title: book.title, level: 1, paragraphIndex: 0 }]
);

const getChapterEntries = (book: Book) => {
  const segments = createTextSegments(getBookParagraphs(book));
  const chapters = getBookChapters(book);
  const minimumLevel = chapters.length
    ? Math.min(...chapters.map((chapter) => chapter.level))
    : 1;

  return chapters.flatMap((chapter) => {
    const anchor = segments[chapter.paragraphIndex]?.startOffset;

    if (typeof anchor !== 'number') {
      return [];
    }
    return [{
      ...chapter,
      level: Math.min(3, chapter.level - minimumLevel + 1) as 1 | 2 | 3,
      anchor,
    }];
  });
};

const setReaderPanel = (
  panel: ReaderPanel | null,
  options: { invoker?: HTMLElement; restoreFocus?: boolean } = {},
) => {
  const restoreTarget = panelInvoker?.isConnected ? panelInvoker : readerView;

  if (!panel && options.restoreFocus !== false) {
    restoreTarget.focus({ preventScroll: true });
  }
  if (panel && (options.invoker || !activePanel)) {
    const invoker = options.invoker
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : readerView);

    panelInvoker = invoker;
  }
  activePanel = panel;
  readerPanel.dataset.open = String(Boolean(panel));
  readerPanel.toggleAttribute('inert', !panel);
  readerPanel.setAttribute('aria-hidden', String(!panel));

  if (!panel) {
    delete readerPanel.dataset.panel;
    panelInvoker = null;
    return;
  }

  readerPanel.dataset.panel = panel;
  readerPanel.setAttribute('aria-label', '阅读显示');
  readerAppearanceMount.append(settingsOptions);
  resetAppearanceFormState();
  requestAnimationFrame(() => {
    fontFamilyInput.focus();
  });
};

const toggleBookmark = () => {
  const anchor = getCurrentAnchor();
  const pinnedAnchor = getPinnedAnchor();
  const pinnedHere = pinnedAnchor === anchor;

  if (pinnedHere) {
    delete readerPins[activeBook.id];
  } else {
    readerPins[activeBook.id] = { anchor };
  }
  persistReaderPins();
  updateReaderNavigation();
  renderProgressBookmarks();
};

const getBookParagraphs = (book: Book) => book.paragraphs
  ?? sampleParagraphs.get(book.id)
  ?? [];

const createReadingPage = (
  book: Book,
  segments: TextSegment[],
): ReadingPage => {
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  const page: ReadingPage = {
    paragraphs: segments.map((segment) => segment.text),
    segments: [...segments],
    formats: book.formats ?? [],
    sourceFormat: book.sourceFormat,
    startOffset: firstSegment?.startOffset ?? 0,
    endOffset: lastSegment
      ? lastSegment.startOffset + lastSegment.text.length
      : firstSegment?.startOffset ?? 0,
  };

  return page;
};

const saveCurrentProgress = () => {
  readingProgress[activeBook.id] = { anchor: getCurrentAnchor() };
  persistReadingProgress();
};

const prepareReadingDocument = async (
  book: Book,
  location: ReaderLocation,
) => {
  readingDocumentPreparing = true;
  bookCopy.setAttribute('aria-busy', 'true');
  readerStatus.textContent = '正在载入正文';

  try {
    await document.fonts.ready;
    readingDocument = createReadingPage(
      book,
      createTextSegments(getBookParagraphs(book)),
    );
    renderReadingDocument();
    await afterPaint();
    refreshReadingLayout();
    renderReaderMinimapBars();
    const anchor = resolveReaderLocation(location);

    if ('ratio' in location) {
      readingProgress[book.id] = { anchor };
      persistReadingProgress();
    }
    scrollToAnchor(anchor, 'auto');
    readerStatus.textContent = `已打开《${book.title}》`;
    return true;
  } catch {
    readerStatus.textContent = '正文载入失败';
    return false;
  } finally {
    readingDocumentPreparing = false;
    bookCopy.removeAttribute('aria-busy');
    updateReaderNavigation();
    renderProgressBookmarks();
  }
};

const announceStatus = (message: string) => {
  appStatus.textContent = '';
  requestAnimationFrame(() => {
    appStatus.textContent = message;
  });
};

const PAGE_TURN_VOLUME = 0.18;

const createPageTurnAudio = (source: string) => {
  const audio = new Audio(source);

  audio.preload = 'auto';
  audio.volume = PAGE_TURN_VOLUME;
  return audio;
};

const pageTurnAudio: Record<Direction, HTMLAudioElement[]> = {
  forward: [
    createPageTurnAudio(pageTurnForwardOne),
    createPageTurnAudio(pageTurnForwardTwo),
  ],
  backward: [
    createPageTurnAudio(pageTurnBackwardOne),
    createPageTurnAudio(pageTurnBackwardTwo),
  ],
};
const allPageTurnAudio = Object.values(pageTurnAudio).flat();

const resetPageTurnAudio = (audio: HTMLAudioElement) => {
  audio.pause();
  audio.currentTime = 0;
  audio.playbackRate = 1;
  audio.volume = PAGE_TURN_VOLUME;
};

const fadeOutPageTurnAudio = (audio: HTMLAudioElement, duration = 36) => {
  const startedAt = performance.now();
  const initialVolume = audio.volume;

  const fade = (now: number) => {
    if (audio.paused) {
      resetPageTurnAudio(audio);
      return;
    }

    const progress = Math.min((now - startedAt) / duration, 1);
    audio.volume = initialVolume * (1 - progress);

    if (progress < 1) {
      window.requestAnimationFrame(fade);
    } else {
      resetPageTurnAudio(audio);
    }
  };

  window.requestAnimationFrame(fade);
};

const primeAudio = () => {
  if (!pageSoundEnabled) {
    return;
  }
  allPageTurnAudio.forEach((audio) => {
    if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) {
      audio.load();
    }
  });
};

const playPageSound = (direction: Direction) => {
  if (!pageSoundEnabled) {
    return;
  }
  primeAudio();
  if (activePageSound && !activePageSound.paused) {
    fadeOutPageTurnAudio(activePageSound);
  }

  const pool = pageTurnAudio[direction];
  const available = pool
    .map((_, index) => index)
    .filter((index) => index !== lastPageSoundIndex[direction]);
  const firstIndex = available[Math.floor(Math.random() * available.length)] ?? 0;
  const candidates = [
    firstIndex,
    ...pool.map((_, index) => index).filter((index) => index !== firstIndex),
  ];

  const playCandidate = async () => {
    let playbackError: unknown;

    for (const index of candidates) {
      const audio = pool[index];

      resetPageTurnAudio(audio);
      audio.volume = PAGE_TURN_VOLUME * (0.97 + Math.random() * 0.06);
      activePageSound = audio;
      audio.onended = () => {
        resetPageTurnAudio(audio);
        if (activePageSound === audio) {
          activePageSound = null;
        }
      };

      try {
        await audio.play();
        lastPageSoundIndex[direction] = index;
        return;
      } catch (error) {
        playbackError = error;
        resetPageTurnAudio(audio);
      }
    }

    activePageSound = null;
    if (!paperAudioWarningShown) {
      paperAudioWarningShown = true;
      console.warn('真实翻页录音无法播放，已保持静音。', playbackError);
    }
  };

  void playCandidate();
};

const clearLibraryIdleTimer = () => {
  window.clearTimeout(libraryIdleTimer);
  libraryIdleTimer = undefined;
};

const canReturnToLanding = () => (
  mode === 'library'
  && !libraryOpenInProgress
  && !importInProgress
  && !loadingBookId
  && libraryView.dataset.phase !== 'placing'
);

const scheduleLibraryIdleReturn = () => {
  clearLibraryIdleTimer();
  if (
    !canReturnToLanding()
    || document.visibilityState !== 'visible'
    || !document.hasFocus()
  ) {
    return;
  }

  libraryIdleTimer = window.setTimeout(() => {
    if (canReturnToLanding()) {
      void returnToLanding();
    }
  }, LIBRARY_IDLE_RETURN_MS);
};

const setMode = (nextMode: AppMode) => {
  mode = nextMode;
  shell.dataset.mode = nextMode;
  const landingActive = nextMode === 'landing';
  const libraryActive = nextMode === 'library';
  const readerActive = nextMode === 'reading';
  landingView.inert = !landingActive;
  libraryView.inert = !libraryActive;
  readerView.inert = !readerActive;
  landingView.setAttribute('aria-hidden', String(!landingActive));
  libraryView.setAttribute('aria-hidden', String(!libraryActive));
  readerView.setAttribute('aria-hidden', String(!readerActive));
  if (libraryActive) {
    scheduleLibraryIdleReturn();
  } else {
    clearLibraryIdleTimer();
  }
};

const returnToLanding = async () => {
  if (!canReturnToLanding() || libraryReturnInProgress) {
    return;
  }

  libraryReturnInProgress = true;
  clearLibraryIdleTimer();
  setLibraryPanel(null, { restoreFocus: false });
  libraryView.classList.remove('is-dragging');
  const duration = reducedMotion.matches ? 90 : 260;
  const timing: KeyframeAnimationOptions = {
    duration,
    easing: 'cubic-bezier(.32,.72,.2,1)',
    fill: 'both',
  };
  const libraryAnimation = libraryView.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    timing,
  );
  const landingAnimation = landingView.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    timing,
  );

  setMode('landing');
  stopThinkingOrb();
  stopThinkingOrb = createThinkingOrb(thinkingOrbCanvas, reducedMotion);
  await waitForAnimations(
    [libraryAnimation, landingAnimation],
    duration + 240,
  );
  libraryAnimation.cancel();
  landingAnimation.cancel();
  libraryReturnInProgress = false;
  enterLibraryButton.focus({ preventScroll: true });
};

const enterLibrary = () => {
  if (
    mode !== 'landing'
    || libraryReturnInProgress
    || enterLibraryButton.classList.contains('is-entering')
  ) {
    return;
  }

  enterLibraryButton.classList.add('is-entering');
  landingView.classList.add('is-leaving');
  const duration = reducedMotion.matches ? 120 : 460;

  window.setTimeout(() => {
    stopThinkingOrb();
    setMode('library');
    enterLibraryButton.classList.remove('is-entering');
    landingView.classList.remove('is-leaving');
    const activeCategoryButton = libraryCategoryButtons.find((button) => (
      button.dataset.libraryCategory === activeLibraryCategory
    ));

    (activeCategoryButton ?? libraryCategoryButtons[0])?.focus({ preventScroll: true });
    if (openImportOnLibraryEntry) {
      openImportOnLibraryEntry = false;
      setLibraryPanel('import', { invoker: libraryImportButton });
      importInput.click();
    }
  }, duration);
};

const bookMaterials: BookMaterial[] = ['cloth', 'paper', 'aged'];
const importedCoverTemplates = [
  lakeCoverTemplate,
  springCoverTemplate,
  lettersCoverTemplate,
  northCoverTemplate,
  plantsCoverTemplate,
  routeCoverTemplate,
  notesCoverTemplate,
  distanceCoverTemplate,
];

const hashBookIdentity = (book: Book) => Array.from(book.id).reduce(
  (hash, character) => (
    (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  ),
  0,
);

const getBookCoverPresentation = (book: Book) => {
  const hash = hashBookIdentity(book);

  return {
    material: book.material ?? bookMaterials[hash % bookMaterials.length],
    variant: Math.floor(hash / 8) % 4,
    template: book.imported && !book.cover
      ? importedCoverTemplates[hash % importedCoverTemplates.length]
      : undefined,
    templateIndex: hash % importedCoverTemplates.length,
  };
};

const applyBookCoverArt = (
  element: HTMLElement,
  cover?: string,
  template?: string,
  templateIndex?: number,
) => {
  const art = cover ?? template;

  element.toggleAttribute('data-has-cover-art', Boolean(cover));
  element.toggleAttribute('data-has-cover-template', Boolean(!cover && template));
  if (!cover && template && templateIndex !== undefined) {
    element.dataset.coverTemplate = String(templateIndex);
  } else {
    delete element.dataset.coverTemplate;
  }
  if (art) {
    element.style.setProperty('--book-cover-art', `url("${art}")`);
  } else {
    element.style.removeProperty('--book-cover-art');
  }
};

const prepareTransitionBook = (book: Book) => {
  const presentation = getBookCoverPresentation(book);

  transitionTitle.textContent = book.title;
  transitionBook.style.setProperty('--book-color', book.color);
  transitionBook.dataset.material = presentation.material;
  transitionBook.dataset.coverVariant = String(presentation.variant);
  applyBookCoverArt(
    transitionBook,
    book.cover,
    presentation.template,
    presentation.templateIndex,
  );
  transitionBook.classList.add('is-visible');
};

const positionTransitionBook = () => {
  const width = Math.min(224, window.innerWidth * 0.18);
  const height = width * 1.38;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;

  transitionBook.style.left = `${left}px`;
  transitionBook.style.top = `${top}px`;
  transitionBook.style.width = `${width}px`;
  transitionBook.style.height = `${height}px`;

  return { width, height, left, top };
};

const getReaderExpansion = (bookWidth: number, bookHeight: number) => {
  const target = bookCopy.getBoundingClientRect();
  const scaleX = target.width / bookWidth;
  const scaleY = readerSurface.clientHeight / bookHeight;

  return {
    scaleX,
    scaleY,
    translateX: 0,
  };
};

const openBook = async (
  book: Book,
  trigger: HTMLButtonElement,
  transitionAlreadyCentered = false,
): Promise<OpenBookResult> => {
  if (mode !== 'library') {
    return 'cancelled';
  }

  activeBook = book;
  activeTrigger = trigger;
  setMode('opening');
  announceStatus('正在载入正文…');
  const location = readingProgress[book.id] ?? { anchor: 0 };
  const documentPromise = prepareReadingDocument(book, location);
  prepareTransitionBook(book);
  const frame = positionTransitionBook();
  const start = transitionAlreadyCentered
    ? frame
    : trigger.getBoundingClientRect();
  const translateX = transitionAlreadyCentered
    ? 0
    : start.left + start.width / 2 - (frame.left + frame.width / 2);
  const translateY = transitionAlreadyCentered
    ? 0
    : start.top + start.height / 2 - (frame.top + frame.height / 2);
  const scaleX = transitionAlreadyCentered
    ? 1
    : Math.max(start.width / frame.width, 0.08);
  const scaleY = transitionAlreadyCentered
    ? 1
    : Math.max(start.height / frame.height, 0.12);
  const readerTarget = getReaderExpansion(frame.width, frame.height);
  const duration = reducedMotion.matches ? 150 : transitionAlreadyCentered ? 520 : 720;

  playPageSound('forward');

  const timing: KeyframeAnimationOptions = {
    duration,
    easing: 'cubic-bezier(.2,.78,.2,1)',
    fill: 'both',
  };
  const bookAnimation = transitionBook.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : transitionAlreadyCentered
        ? [
            {
              transform: 'translate3d(0, 0, 0) scale(1)',
              opacity: 1,
            },
            {
              transform: 'translate3d(0, -4px, 22px) scale(1.035)',
              opacity: 1,
              offset: 0.34,
            },
            {
              transform: `translate3d(${readerTarget.translateX}px, 0, 0)
                scale(${readerTarget.scaleX}, ${readerTarget.scaleY}) rotateY(0)`,
              opacity: 0,
            },
          ]
        : [
          {
            transform: `translate3d(${translateX}px, ${translateY}px, 0)
              scale(${scaleX}, ${scaleY}) rotateX(58deg) rotateZ(2deg)`,
            opacity: 1,
          },
          {
            transform: `translate3d(${translateX * 0.48}px, ${translateY * 0.48 - 18}px, 72px)
              scale(.86) rotateX(18deg) rotateZ(-1deg)`,
            opacity: 1,
            offset: 0.24,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(.98) rotateX(0) rotateZ(0)',
            opacity: 1,
            offset: 0.44,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1.05) rotateX(0) rotateZ(0)',
            opacity: 1,
            offset: 0.61,
          },
          {
            transform: `translate3d(${readerTarget.translateX}px, 0, 0)
              scale(${readerTarget.scaleX}, ${readerTarget.scaleY}) rotateY(0)`,
            opacity: 0,
          },
        ],
    timing,
  );
  const coverAnimation = transitionCover.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'rotateY(0deg)' },
          {
            transform: 'rotateY(0deg)',
            offset: transitionAlreadyCentered ? 0.18 : 0.4,
          },
          {
            transform: 'rotateY(-158deg)',
            offset: transitionAlreadyCentered ? 0.7 : 0.72,
          },
          { transform: 'rotateY(-166deg)' },
        ],
    timing,
  );
  const readerAnimation = readerView.animate(
    reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'scale(.95)' },
          {
            opacity: 0,
            transform: 'scale(.96)',
            offset: transitionAlreadyCentered ? 0.48 : 0.62,
          },
          { opacity: 1, transform: 'scale(1)' },
        ],
    timing,
  );
  const animations = [bookAnimation, coverAnimation, readerAnimation];

  activeAnimations = animations;
  const [ready] = await Promise.all([
    documentPromise,
    waitForAnimations(animations, duration + 240),
  ]);
  activeAnimations = [];

  if (!ready || shell.dataset.mode !== 'opening' || activeBook.id !== book.id) {
    animations.forEach((animation) => animation.cancel());
    transitionBook.classList.remove('is-visible');
    if (shell.dataset.mode === 'opening') {
      setMode('library');
      announceStatus('暂时无法打开这本书');
    }
    return shell.dataset.mode === 'library' ? 'failed' : 'cancelled';
  }

  setMode('reading');
  animations.forEach((animation) => animation.cancel());
  transitionBook.classList.remove('is-visible');
  await afterPaint();
  scrollToAnchor(resolveReaderLocation(readingProgress[book.id] ?? location), 'auto');
  saveCurrentProgress();
  updateReaderNavigation();
  readerStatus.textContent = `已打开《${book.title}》`;
  announceStatus(`已打开《${book.title}》`);
  lastOpenedBookId = book.id;
  localStorage.setItem(LAST_BOOK_KEY, book.id);
  updateCurrentBookEntry();
  readerSurface.focus({ preventScroll: true });

  return 'opened';
};

const createBookReturnFlight = (
  translateX: number,
  translateY: number,
  scaleX: number,
  scaleY: number,
): Keyframe[] => {
  const distance = Math.hypot(translateX, translateY);
  const lift = Math.min(164, Math.max(76, distance * 0.24));
  const controlX = translateX * 0.56;
  const controlY = Math.min(translateY, 0) - lift;
  const quadraticFromCenter = (
    destination: number,
    control: number,
    progress: number,
  ) => (
    progress ** 2 * destination
    + 2 * progress * (1 - progress) * control
  );
  const pathProgress = [0, 0.22, 0.48, 0.74, 1];
  const pathOffsets = [0.44, 0.55, 0.69, 0.84, 0.96];

  return pathProgress.map((progress, index) => {
    const scaleProgress = progress ** 2;
    const currentScaleX = 1 + (scaleX - 1) * scaleProgress;
    const currentScaleY = 1 + (scaleY - 1) * scaleProgress;
    const depth = Math.sin(Math.PI * progress) * 138;

    return {
      transform: `translate3d(
        ${quadraticFromCenter(translateX, controlX, progress)}px,
        ${quadraticFromCenter(translateY, controlY, progress)}px,
        ${depth}px
      ) scale(${currentScaleX}, ${currentScaleY})
        rotateY(${-12 * progress}deg)
        rotateZ(${2.4 * Math.sin(Math.PI * progress)}deg)`,
      opacity: 1 - progress * 0.08,
      filter: `drop-shadow(0 ${4 + depth * 0.16}px ${6 + depth * 0.18}px
        rgba(22, 30, 33, ${0.2 - progress * 0.1}))`,
      offset: pathOffsets[index],
    };
  });
};

const closeBook = async () => {
  if (mode === 'opening') {
    readingDocumentPreparing = false;
    activeAnimations.forEach((animation) => animation.cancel());
    activeAnimations = [];
    bookCopy.removeAttribute('aria-busy');
    transitionBook.classList.remove('is-visible');
    setMode('library');
    announceStatus('已取消打开');
    if (activeTrigger?.isConnected) {
      activeTrigger.focus({ preventScroll: true });
    }
    return;
  }

  if (mode !== 'reading') {
    return;
  }

  const returnTrigger = getPhysicalBookButton(activeBook.id) ?? activeTrigger;

  if (!returnTrigger) {
    return;
  }
  activeTrigger = returnTrigger;

  readingDocumentPreparing = false;
  bookCopy.removeAttribute('aria-busy');
  setReaderPanel(null, { restoreFocus: false });
  saveCurrentProgress();
  setLibraryPhase('browsing');
  setMode('closing');
  prepareTransitionBook(activeBook);
  const frame = positionTransitionBook();
  const destinationVisual = returnTrigger.querySelector<HTMLElement>(
    '.library-book-cover',
  ) ?? returnTrigger;
  const destination = destinationVisual.getBoundingClientRect();
  const hasDestination = returnTrigger.isConnected
    && destination.width > 0
    && destination.height > 0;
  const translateX = destination.left + destination.width / 2
    - (frame.left + frame.width / 2);
  const translateY = destination.top + destination.height / 2
    - (frame.top + frame.height / 2);
  const scaleX = Math.max(destination.width / frame.width, 0.08);
  const scaleY = Math.max(destination.height / frame.height, 0.12);
  const readerTarget = getReaderExpansion(frame.width, frame.height);
  const duration = reducedMotion.matches ? 150 : 760;
  const returnFlight = hasDestination
    ? createBookReturnFlight(translateX, translateY, scaleX, scaleY)
    : [{
        transform: 'translate3d(0, -8px, 0) scale(.94)',
        opacity: 0.72,
        offset: 0.84,
      }];
  const finalBookFrame = returnFlight.at(-1) ?? {};

  playPageSound('backward');

  const timing: KeyframeAnimationOptions = {
    duration,
    easing: 'linear',
    fill: 'both',
  };
  const bookAnimation = transitionBook.animate(
    reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 0 }]
      : [
          {
            transform: `translate3d(${readerTarget.translateX}px, 0, 0)
              scale(${readerTarget.scaleX}, ${readerTarget.scaleY})`,
            opacity: 0,
            offset: 0,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1.04)',
            opacity: 0,
            offset: 0.22,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1.04)',
            opacity: 1,
            offset: 0.36,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1)',
            opacity: 1,
            offset: 0.44,
          },
          ...returnFlight,
          {
            ...finalBookFrame,
            opacity: 0,
            offset: 1,
          },
        ],
    timing,
  );
  const coverAnimation = transitionCover.animate(
    reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: 'rotateY(-166deg)' },
          { transform: 'rotateY(-166deg)', offset: 0.18 },
          { transform: 'rotateY(-148deg)', offset: 0.26 },
          { transform: 'rotateY(-36deg)', offset: 0.35 },
          { transform: 'rotateY(0deg)', offset: 0.42 },
          { transform: 'rotateY(0deg)' },
        ],
    timing,
  );
  const readerAnimation = readerView.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(.992)', offset: 0.16 },
          { opacity: 0, transform: 'scale(.965)', offset: 0.4 },
          { opacity: 0, transform: 'scale(.96)' },
        ],
    timing,
  );
  const libraryAnimation = libraryView.animate(
    [{ opacity: 1 }, { opacity: 1 }],
    timing,
  );
  const animations = [bookAnimation, coverAnimation, readerAnimation, libraryAnimation];

  activeAnimations = animations;
  await waitForAnimations(animations, duration + 240);
  activeAnimations = [];
  setMode('library');
  animations.forEach((animation) => animation.cancel());
  transitionBook.classList.remove('is-visible');
  readerStatus.textContent = '';
  updateCurrentBookEntry();
  if (returnTrigger.isConnected) {
    returnTrigger.focus({ preventScroll: true });
  }
};

const toBookMetadata = (book: ImportedBookRecord): ImportedBookMetadata => ({
  id: book.id,
  title: book.title,
  author: book.author,
  color: book.color,
  ...(book.cover ? { cover: book.cover } : {}),
  ...(book.sourceName ? { sourceName: book.sourceName } : {}),
  sourceFormat: book.sourceFormat,
  imported: true,
  createdAt: book.createdAt,
});

const getBookSummaryById = (bookId: string): Book | undefined => (
  books.find((book) => (
    book.id === bookId && !hiddenSampleBookIds.has(book.id)
  ))
  ?? importedBooks.find((book) => book.id === bookId)
);

const getManagedBooks = (): Book[] => [
  ...importedBooks.slice().sort((left, right) => right.createdAt - left.createdAt),
  ...books.filter((book) => !hiddenSampleBookIds.has(book.id)),
];

const matchesLibraryQuery = (book: Book, query: string) => (
  !query
  || book.title.toLocaleLowerCase().includes(query)
  || book.author.toLocaleLowerCase().includes(query)
);

const getPhysicalBookButton = (bookId: string) => (
  bookHotspots.querySelector<HTMLButtonElement>(
    `.library-book-card[data-book-id="${CSS.escape(bookId)}"]
      > .library-book-card-open`,
  )
);

const replaceRemovedBookReference = (removedBookId: string) => {
  if (lastOpenedBookId === removedBookId) {
    lastOpenedBookId = '';
    localStorage.removeItem(LAST_BOOK_KEY);
  }
};

const hasBookProgress = (bookId: string) => {
  const location = readingProgress[bookId];

  return location
    ? ('anchor' in location ? location.anchor : location.ratio) > 0
    : false;
};

const matchesLibraryCategory = (
  book: Book,
  category: LibraryCategory = activeLibraryCategory,
) => {
  if (category === 'finished') {
    return finishedBookIds.has(book.id);
  }
  if (category === 'reading') {
    return !finishedBookIds.has(book.id)
      && (hasBookProgress(book.id) || book.id === lastOpenedBookId);
  }
  return true;
};

const getCategoryBooks = (category: LibraryCategory = activeLibraryCategory) => (
  getManagedBooks().filter((book) => matchesLibraryCategory(book, category))
);

const persistFinishedBooks = () => {
  localStorage.setItem(FINISHED_BOOKS_KEY, JSON.stringify([...finishedBookIds]));
};

const clearStoredBookState = (bookId: string) => {
  finishedBookIds.delete(bookId);
  loadedBookCache.delete(bookId);
  delete readingProgress[bookId];
  delete readerPins[bookId];
  replaceRemovedBookReference(bookId);
};

const toggleBookFinished = (book: Book) => {
  const wasFinished = finishedBookIds.delete(book.id);

  if (!wasFinished) {
    finishedBookIds.add(book.id);
  }
  persistFinishedBooks();
  renderLibrarySearch();
  const nextButton = bookHotspots.querySelector<HTMLButtonElement>(
    `[data-finished-book-id="${CSS.escape(book.id)}"]`,
  );
  const fallback = libraryCategoryButtons.find((button) => (
    button.dataset.libraryCategory === activeLibraryCategory
  ));

  (nextButton ?? fallback)?.focus({ preventScroll: true });
  announceStatus(wasFinished ? `《${book.title}》已恢复为在读` : `《${book.title}》已读完`);
};

const bindBookButton = (button: HTMLButtonElement, book: Book) => {
  button.title = `${book.title} · ${book.author}`;
  button.addEventListener('pointerdown', primeAudio);
  button.addEventListener('click', () => void openBookSummary(book, button));
};

const createLibraryBookCard = (book: Book, query: string) => {
  const card = document.createElement('article');
  const openButton = document.createElement('button');
  const cover = document.createElement('span');
  const coverTitle = createTextElement('strong', 'library-book-cover-title', book.title);
  const coverAuthor = createTextElement('span', 'library-book-cover-author', book.author);
  const actions = document.createElement('div');
  const finishedButton = document.createElement('button');
  const removeButton = document.createElement('button');
  const finished = finishedBookIds.has(book.id);
  const matched = matchesLibraryQuery(book, query);
  const presentation = getBookCoverPresentation(book);

  card.className = 'library-book-card';
  card.dataset.bookId = book.id;
  card.dataset.finished = String(finished);
  card.dataset.material = presentation.material;
  card.dataset.coverVariant = String(presentation.variant);
  applyBookCoverArt(
    card,
    book.cover,
    presentation.template,
    presentation.templateIndex,
  );
  card.classList.toggle('is-search-match', Boolean(query) && matched);
  card.classList.toggle('is-search-miss', Boolean(query) && !matched);
  card.toggleAttribute('inert', Boolean(query) && !matched);
  card.style.setProperty('--book-color', book.color);
  openButton.type = 'button';
  openButton.className = 'library-book-card-open';
  openButton.dataset.bookId = book.id;
  openButton.setAttribute(
    'aria-label',
    book.id === lastOpenedBookId ? `继续阅读《${book.title}》` : `打开《${book.title}》`,
  );
  cover.className = 'library-book-cover';
  cover.append(coverTitle, coverAuthor);
  openButton.append(cover);
  actions.className = 'library-book-card-actions';
  finishedButton.type = 'button';
  finishedButton.className = 'library-book-finished';
  finishedButton.dataset.finishedBookId = book.id;
  finishedButton.setAttribute('aria-pressed', String(finished));
  finishedButton.setAttribute(
    'aria-label',
    finished ? `将《${book.title}》恢复为在读` : `标记《${book.title}》已读完`,
  );
  finishedButton.title = finished ? '恢复为在读' : '标记已读完';
  finishedButton.innerHTML = renderReaderIcon('finished');
  removeButton.type = 'button';
  removeButton.className = 'library-book-remove';
  removeButton.dataset.removeBookId = book.id;
  removeButton.setAttribute('aria-label', `从书库移出《${book.title}》`);
  removeButton.title = '移出书库';
  removeButton.innerHTML = renderReaderIcon('trash');
  actions.append(finishedButton, removeButton);
  card.append(openButton, actions);
  bindBookButton(openButton, book);
  finishedButton.addEventListener('click', () => toggleBookFinished(book));
  removeButton.addEventListener('click', () => {
    if (book.imported) {
      removeImportedBook(book.id);
    } else {
      removeSampleBook(book.id);
    }
  });
  return card;
};

const renderLibraryCards = (query: string) => {
  const allBooks = getManagedBooks();
  const categoryBooks = allBooks.filter((book) => matchesLibraryCategory(book));
  const fragment = document.createDocumentFragment();

  categoryBooks.forEach((book) => fragment.append(createLibraryBookCard(book, query)));
  bookHotspots.replaceChildren(fragment);
  libraryCategoryButtons.forEach((button) => {
    const category = button.dataset.libraryCategory as LibraryCategory;
    const count = getCategoryBooks(category).length;
    const categoryLabel = libraryCategoryLabels[category];

    button.textContent = `${categoryLabel} ${count} 本`;
    button.setAttribute('aria-label', `${categoryLabel}，${count} 本`);
    button.setAttribute('aria-pressed', String(category === activeLibraryCategory));
  });
  const noSearchResults = Boolean(query) && matchedLibraryBooks.length === 0;
  const emptyCategory = !query && categoryBooks.length === 0;

  libraryEmpty.hidden = !(allBooks.length === 0 || noSearchResults || emptyCategory);
  if (allBooks.length === 0) {
    libraryEmptyTitle.textContent = '还没有书';
    libraryEmptyAction.textContent = '导入第一本书';
    libraryEmptyAction.dataset.action = 'import';
  } else if (noSearchResults) {
    libraryEmptyTitle.textContent = '没有找到';
    libraryEmptyAction.textContent = '清除搜索';
    libraryEmptyAction.dataset.action = 'clear-search';
  } else if (emptyCategory) {
    libraryEmptyTitle.textContent = '此分类暂无书籍';
    libraryEmptyAction.textContent = '查看全部';
    libraryEmptyAction.dataset.action = 'show-all';
  }
};

const renderLibrarySearch = () => {
  const query = librarySearch.value.trim().toLocaleLowerCase();
  const categoryBooks = getCategoryBooks();

  matchedLibraryBooks = categoryBooks.filter((book) => matchesLibraryQuery(book, query));
  librarySearchMeta.textContent = query
    ? `${matchedLibraryBooks.length} 本`
    : `${categoryBooks.length} 本`;
  renderLibraryCards(query);
};

const setLibraryPanel = (
  panel: LibraryPanel | null,
  options: { invoker?: HTMLElement; restoreFocus?: boolean } = {},
) => {
  const restoreTarget = libraryPanelInvoker?.isConnected
    ? libraryPanelInvoker
    : librarySearchButton;

  if (!panel && options.restoreFocus !== false) {
    restoreTarget.focus({ preventScroll: true });
  }
  if (panel && (options.invoker || !activeLibraryPanel)) {
    libraryPanelInvoker = options.invoker
      ?? libraryActionButtons.find((button) => button.dataset.libraryAction === panel)
      ?? librarySearchButton;
  }

  activeLibraryPanel = panel;
  libraryPanel.dataset.open = String(Boolean(panel));
  libraryPanel.toggleAttribute('inert', !panel);
  libraryPanel.setAttribute('aria-hidden', String(!panel));
  libraryActionButtons.forEach((button) => {
    button.setAttribute(
      'aria-expanded',
      String(button.dataset.libraryAction === panel),
    );
  });

  if (!panel) {
    delete libraryPanel.dataset.panel;
    libraryPanelInvoker = null;
    librarySearch.value = '';
    if (!importInProgress) {
      setImportPresentation(false);
    }
    renderLibrarySearch();
    return;
  }

  libraryPanel.dataset.panel = panel;
  libraryPanel.setAttribute('aria-label', libraryPanelLabels[panel]);
  if (panel === 'search') {
    renderLibrarySearch();
    requestAnimationFrame(() => librarySearch.focus());
  } else if (panel === 'appearance') {
    libraryAppearanceMount.append(settingsOptions);
    resetAppearanceFormState();
    requestAnimationFrame(() => fontFamilyInput.focus());
  } else if (panel === 'import' && !importInProgress) {
    window.clearTimeout(importProgressTimer);
    setImportPresentation(false);
    requestAnimationFrame(() => importChooseButton.focus());
  }
};

const setLibraryPhase = (phase: 'browsing' | 'placing') => {
  const placing = phase === 'placing';
  const busy = placing || libraryOpenInProgress || importInProgress;

  libraryView.dataset.phase = phase;
  libraryView.toggleAttribute('aria-busy', busy);
  bookHotspots.inert = busy;
  libraryDock.inert = busy;
  if (busy) {
    clearLibraryIdleTimer();
  } else {
    scheduleLibraryIdleReturn();
  }
};

const animateBookToCenter = async (
  book: Book,
  trigger: HTMLButtonElement,
  requestRevision: number,
) => {
  setLibraryPhase('placing');
  prepareTransitionBook(book);
  const frame = positionTransitionBook();
  const visual = trigger.querySelector<HTMLElement>('.library-book-cover') ?? trigger;
  const start = visual.getBoundingClientRect();
  const frameCenterX = frame.left + frame.width / 2;
  const frameCenterY = frame.top + frame.height / 2;
  const startX = start.left + start.width / 2 - frameCenterX;
  const startY = start.top + start.height / 2 - frameCenterY;
  const startScaleX = Math.max(start.width / frame.width, 0.14);
  const startScaleY = Math.max(start.height / frame.height, 0.18);

  if (reducedMotion.matches) {
    await nextFrame();
    return requestRevision === openRequestRevision && mode === 'library';
  }

  const distance = Math.hypot(startX, startY);
  const lift = Math.min(164, Math.max(76, distance * 0.24));
  const controlX = startX * 0.56;
  const controlY = Math.min(startY, 0) - lift;
  const quadratic = (startValue: number, controlValue: number, progress: number) => (
    (1 - progress) ** 2 * startValue
    + 2 * (1 - progress) * progress * controlValue
  );
  const pathProgress = [0, 0.22, 0.48, 0.74, 1];
  const pathOffsets = [0, 0.19, 0.42, 0.65, 0.84];
  const keyframes: Keyframe[] = pathProgress.map((progress, index) => {
    const scaleProgress = 1 - (1 - progress) ** 2;
    const scaleX = startScaleX + (1 - startScaleX) * scaleProgress;
    const scaleY = startScaleY + (1 - startScaleY) * scaleProgress;
    const depth = Math.sin(Math.PI * progress) * 138;

    return {
      transform: `translate3d(
        ${quadratic(startX, controlX, progress)}px,
        ${quadratic(startY, controlY, progress)}px,
        ${depth}px
      ) scale(${scaleX}, ${scaleY})
        rotateY(${-12 * (1 - progress)}deg)
        rotateZ(${2.4 * Math.sin(Math.PI * progress)}deg)`,
      opacity: 0.88 + progress * 0.12,
      filter: `drop-shadow(0 ${4 + depth * 0.16}px ${6 + depth * 0.18}px
        rgba(22, 30, 33, ${0.1 + progress * 0.12}))`,
      offset: pathOffsets[index],
    };
  });

  keyframes.push(
    {
      transform: 'translate3d(0, 0, 0) scale(1.026)',
      opacity: 1,
      filter: 'drop-shadow(0 25px 34px rgba(22, 30, 33, .2))',
      offset: 0.93,
    },
    {
      transform: 'translate3d(0, 0, 0) scale(1)',
      opacity: 1,
      filter: 'drop-shadow(0 20px 28px rgba(22, 30, 33, .18))',
      offset: 1,
    },
  );
  const animation = transitionBook.animate(
    keyframes,
    {
      duration: 620,
      easing: 'linear',
      fill: 'both',
    },
  );

  activeAnimations = [animation];
  await waitForAnimations([animation], 860);
  activeAnimations = [];
  animation.cancel();
  return requestRevision === openRequestRevision && mode === 'library';
};

const openBookSummary = async (book: Book, trigger: HTMLButtonElement) => {
  if (
    mode !== 'library'
    || libraryReturnInProgress
    || libraryOpenInProgress
    || importInProgress
  ) {
    return;
  }

  const requestRevision = ++openRequestRevision;
  const physicalTrigger = getPhysicalBookButton(book.id) ?? trigger;

  libraryOpenInProgress = true;
  loadingBookId = book.id;
  setLibraryPhase('placing');
  const flightPromise = animateBookToCenter(book, physicalTrigger, requestRevision);
  setLibraryPanel(null, { restoreFocus: false });

  try {
    let readableBook = book;

    if (book.imported && !book.paragraphs) {
      announceStatus(`正在取出《${book.title}》…`);
      const cachedBook = loadedBookCache.get(book.id);

      readableBook = cachedBook ?? await loadImportedBook(book.id);
      if (cachedBook) {
        cacheLoadedBook(cachedBook);
      } else {
        cacheLoadedBook(readableBook);
      }
    }

    const centered = await flightPromise;
    if (!centered || requestRevision !== openRequestRevision || mode !== 'library') {
      return;
    }

    if (!reducedMotion.matches) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 72));
    }
    if (requestRevision !== openRequestRevision || mode !== 'library') {
      return;
    }
    loadingBookId = null;
    const returnTrigger = getPhysicalBookButton(book.id) ?? physicalTrigger;

    await openBook(readableBook, returnTrigger, true);
  } catch (error) {
    await flightPromise.catch((): void => undefined);
    transitionBook.classList.remove('is-visible');
    setLibraryPhase('browsing');
    if (requestRevision !== openRequestRevision) {
      return;
    }
    const message = error instanceof Error ? error.message : '暂时无法打开这本书';

    announceStatus(message);
  } finally {
    if (requestRevision === openRequestRevision) {
      loadingBookId = null;
    }
    libraryOpenInProgress = false;
    if (mode === 'library' || mode === 'reading') {
      setLibraryPhase('browsing');
    }
  }
};

const commitPendingRemovals = async () => {
  const removals = [...pendingRemovals.entries()];

  if (!removals.length) {
    return;
  }
  pendingRemovals.clear();
  const results = await Promise.allSettled(
    removals.map(([bookId]) => deleteImportedBook(bookId)),
  );
  const failedBooks: ImportedBookMetadata[] = [];
  const deletedIds = new Set<string>();

  results.forEach((result, index) => {
    const [bookId, metadata] = removals[index];

    if (result.status === 'fulfilled') {
      deletedIds.add(bookId);
      clearStoredBookState(bookId);
    } else {
      failedBooks.push(metadata);
    }
  });

  if (deletedIds.size) {
    persistReadingProgress();
    persistReaderPins();
    persistFinishedBooks();
  }

  if (failedBooks.length) {
    const knownIds = new Set(importedBooks.map((book) => book.id));

    failedBooks.forEach((book) => {
      if (!knownIds.has(book.id)) {
        importedBooks.push(book);
      }
    });
    announceStatus('有书籍未能移出，已放回书架');
  }
  renderLibrarySearch();
  updateCurrentBookEntry();
};

const removeImportedBook = (bookId: string) => {
  const metadata = importedBooks.find((book) => book.id === bookId);
  if (!metadata || pendingRemovals.has(bookId)) {
    return;
  }

  if (loadingBookId === bookId) {
    openRequestRevision += 1;
    loadingBookId = null;
  }
  pendingRemovals.set(bookId, metadata);
  importedBooks = importedBooks.filter((book) => book.id !== bookId);
  renderLibrarySearch();
  updateCurrentBookEntry();
  void commitPendingRemovals();
};

const removeSampleBook = (bookId: string) => {
  const book = books.find((item) => item.id === bookId);

  if (!book || hiddenSampleBookIds.has(bookId)) {
    return;
  }
  hiddenSampleBookIds.add(bookId);
  localStorage.setItem(HIDDEN_SAMPLE_BOOKS_KEY, JSON.stringify([...hiddenSampleBookIds]));
  clearStoredBookState(bookId);
  persistReadingProgress();
  persistReaderPins();
  persistFinishedBooks();
  renderLibrarySearch();
  updateCurrentBookEntry();
  announceStatus(`已移出《${book.title}》`);
};

const updateCurrentBookEntry = () => {
  bookHotspots.querySelectorAll<HTMLButtonElement>('.library-book-card-open').forEach((button) => {
    const book = getBookSummaryById(button.dataset.bookId ?? '');
    const current = button.dataset.bookId === lastOpenedBookId;

    button.closest('.library-book-card')?.classList.toggle('is-current', current);
    if (book) {
      button.setAttribute(
        'aria-label',
        current ? `继续阅读《${book.title}》` : `打开《${book.title}》`,
      );
    }
  });
};

type ImportedBookMatch = {
  duplicate: boolean;
  replacement?: ImportedBookMetadata;
};

const sameImportedContent = (
  existing: Book,
  incoming: ImportedBookRecord,
) => existing.paragraphs?.length === incoming.paragraphs.length
  && existing.paragraphs.every((paragraph, index) => (
    paragraph === incoming.paragraphs[index]
  ))
  && JSON.stringify(existing.chapters ?? []) === JSON.stringify(incoming.chapters)
  && JSON.stringify(existing.formats ?? []) === JSON.stringify(incoming.formats)
  && existing.sourceFormat === incoming.sourceFormat;

const matchImportedBook = async (record: ImportedBookRecord): Promise<ImportedBookMatch> => {
  const identityCandidates = importedBooks.filter((book) => (
    book.title === record.title
    && book.author === record.author
    && (!book.sourceFormat || book.sourceFormat === record.sourceFormat)
  ));
  const sourceCandidates = record.sourceName
    ? importedBooks.filter((book) => (
        book.sourceName === record.sourceName
        && (!book.sourceFormat || book.sourceFormat === record.sourceFormat)
      ))
    : [];
  const idCandidates = importedBooks.filter((book) => book.id === record.id);
  const candidates = [...new Map(
    [...idCandidates, ...sourceCandidates, ...identityCandidates]
      .map((book) => [book.id, book]),
  ).values()];
  const replacements: ImportedBookMetadata[] = [];

  for (const candidate of candidates) {
    try {
      const existing = loadedBookCache.get(candidate.id)
        ?? await loadImportedBook(candidate.id);

      if (sameImportedContent(existing, record)) {
        if (
          existing.title === record.title
          && existing.author === record.author
          && existing.cover === record.cover
        ) {
          return { duplicate: true };
        }
        replacements.push(candidate);
      }
    } catch {
      // 损坏记录不应阻止用户重新导入一份可读副本。
    }
  }
  return {
    duplicate: false,
    ...(replacements.length === 1 ? { replacement: replacements[0] } : {}),
  };
};

const importFiles = async (files: File[]) => {
  if (!files.length) {
    return;
  }
  if (mode !== 'library' || libraryOpenInProgress || importInProgress) {
    announceStatus('上一批书仍在导入');
    return;
  }

  const importedIds = new Set<string>();
  const failures: string[] = [];
  let duplicateCount = 0;
  let updatedCount = 0;

  importInProgress = true;
  window.clearTimeout(importProgressTimer);
  setLibraryPanel('import', { invoker: libraryImportButton });
  setImportPresentation(true);
  setLibraryPhase('browsing');
  libraryImportButton.disabled = true;
  setSegmentedProgress(importProgress, importPercent, 0);
  importErrors.replaceChildren();
  importErrors.hidden = true;
  importProgress.setAttribute('aria-valuenow', '0');
  importStatus.textContent = files.length === 1 ? files[0].name : `${files.length} 本书`;

  const updateProgress = (fileIndex: number, stage: number, status: string) => {
    const value = Math.round((fileIndex + stage) / files.length * 100);

    setSegmentedProgress(importProgress, importPercent, value);
    importProgress.setAttribute('aria-valuenow', String(value));
    importProgress.setAttribute('aria-valuetext', status);
    importStatus.textContent = status;
  };

  for (const [fileIndex, file] of files.entries()) {
    try {
      const record = await parseImportedBook(file, {
        onProgress: (progress) => {
          updateProgress(fileIndex, progress * 0.62, file.name);
        },
      });

      updateProgress(fileIndex, 0.7, '检查重复');
      const match = await matchImportedBook(record);
      if (match.duplicate) {
        duplicateCount += 1;
        updateProgress(fileIndex, 1, `${fileIndex + 1} / ${files.length}`);
        continue;
      }
      const savedRecord = match.replacement
        ? {
            ...record,
            id: match.replacement.id,
            createdAt: match.replacement.createdAt,
          }
        : record;

      if (match.replacement) {
        updatedCount += 1;
      }
      updateProgress(fileIndex, 0.84, '放上书架');
      await saveImportedBook(savedRecord, Boolean(match.replacement));
      cacheLoadedBook(savedRecord);
      const metadata = toBookMetadata(savedRecord);
      const existingIndex = importedBooks.findIndex((book) => book.id === savedRecord.id);

      if (existingIndex >= 0) {
        importedBooks[existingIndex] = metadata;
      } else {
        importedBooks.push(metadata);
      }
      importedIds.add(savedRecord.id);
      updateProgress(fileIndex, 1, `${fileIndex + 1} / ${files.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法导入这本书';

      failures.push(`${file.name}：${message}`);
      updateProgress(fileIndex, 1, `${fileIndex + 1} / ${files.length}`);
    }
  }

  const importedCount = importedIds.size;

  if (importedCount) {
    renderLibrarySearch();
  }

  setSegmentedProgress(importProgress, importPercent, 100);
  importProgress.setAttribute('aria-valuenow', '100');
  importProgress.setAttribute('aria-valuetext', '导入完成');
  importStatus.textContent = failures.length
    ? `${importedCount} 本成功，${failures.length} 本失败`
    : '完成';
  importErrors.replaceChildren(...failures.map((failure) => {
    const item = document.createElement('li');

    item.textContent = failure;
    return item;
  }));
  importErrors.hidden = failures.length === 0;
  importInProgress = false;
  setLibraryPhase('browsing');
  libraryImportButton.disabled = false;
  if (!failures.length) {
    importProgressTimer = window.setTimeout(() => {
      if (activeLibraryPanel === 'import') {
        setLibraryPanel(null, { restoreFocus: false });
      }
    }, 1_200);
  }

  if (failures.length) {
    announceStatus(
      `导入 ${importedCount} 本，${failures.length} 本失败。${failures[0]}`,
    );
  } else if (importedCount && duplicateCount) {
    announceStatus(`已导入 ${importedCount} 本，跳过 ${duplicateCount} 本重复书籍`);
  } else if (importedCount && updatedCount === importedCount) {
    announceStatus(`已更新 ${updatedCount} 本书的封面与排版`);
  } else if (importedCount) {
    announceStatus(`已把 ${importedCount} 本书放入书库`);
  } else if (duplicateCount) {
    announceStatus(duplicateCount === 1 ? '这本书已在书库中' : '这些书已在书库中');
  }
};

importInput.addEventListener('change', () => {
  const files = Array.from(importInput.files ?? []);

  importInput.value = '';
  void importFiles(files);
});
importChooseButton.addEventListener('click', () => importInput.click());

enterLibraryButton.addEventListener('click', enterLibrary);
backgroundSceneButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const sceneIndex = Number(button.dataset.backgroundSceneIndex);

    if (Number.isInteger(sceneIndex)) {
      setLandingScene(sceneIndex);
    }
  });
});

libraryCategoryButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const category = button.dataset.libraryCategory as LibraryCategory;

    activeLibraryCategory = category;
    bookHotspots.scrollTop = 0;
    renderLibrarySearch();
    button.focus({ preventScroll: true });
  });
});
libraryEmptyAction.addEventListener('click', () => {
  const action = libraryEmptyAction.dataset.action;

  if (action === 'import') {
    libraryImportButton.click();
  } else if (action === 'clear-search') {
    librarySearch.value = '';
    renderLibrarySearch();
    librarySearch.focus();
  } else if (action === 'show-all') {
    activeLibraryCategory = 'all';
    renderLibrarySearch();
    libraryCategoryButtons[0]?.focus({ preventScroll: true });
  }
});

libraryActionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.libraryAction;

    if (
      action === 'search'
      || action === 'import'
      || action === 'background'
      || action === 'appearance'
    ) {
      setLibraryPanel(
        activeLibraryPanel === action ? null : action,
        { invoker: button },
      );
    }
  });
});
librarySearch.addEventListener('input', renderLibrarySearch);
librarySearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && librarySearch.value.trim()) {
    const firstMatch = matchedLibraryBooks[0];

    if (firstMatch) {
      event.preventDefault();
      const trigger = getPhysicalBookButton(firstMatch.id) ?? librarySearchButton;

      void openBookSummary(firstMatch, trigger);
    }
  }
});

libraryView.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    libraryView.classList.add('is-dragging');
  }
});
libraryView.addEventListener('dragleave', (event) => {
  if (!(event.relatedTarget instanceof Node) || !libraryView.contains(event.relatedTarget)) {
    libraryView.classList.remove('is-dragging');
  }
});
libraryView.addEventListener('drop', (event) => {
  event.preventDefault();
  libraryView.classList.remove('is-dragging');
  const files = Array.from(event.dataTransfer?.files ?? []);

  if (files.length) {
    void importFiles(files);
  }
});

returnButton.addEventListener('click', () => {
  void closeBook();
});
bookmarkButton.addEventListener('click', toggleBookmark);
readerProgress.addEventListener('pointermove', (event) => {
  window.cancelAnimationFrame(minimapMotionFrame ?? 0);
  const pointerY = event.clientY;

  minimapMotionFrame = requestAnimationFrame(() => {
    const bars = [
      ...readerMinimapBars.querySelectorAll<HTMLElement>('.reader-minimap-bar'),
    ];
    let closestBar: HTMLElement | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;

    bars.forEach((bar) => {
      const bounds = bar.getBoundingClientRect();
      const distance = Math.abs(pointerY - bounds.top - bounds.height / 2);
      const wave = Math.exp(-0.5 * (distance / 22) ** 2);

      if (!reducedMotion.matches) {
        bar.style.setProperty('--hover-wave', (wave < 0.01 ? 0 : wave).toFixed(3));
      }
      if (distance < closestDistance) {
        closestBar = bar;
        closestDistance = distance;
      }
    });
    if (!closestBar) {
      return;
    }
    bars.forEach((bar) => bar.classList.toggle(
      'is-preview-current',
      bar === closestBar,
    ));
    readerMinimap.dataset.previewing = 'true';
    const barBounds = closestBar.getBoundingClientRect();
    const bodyBounds = readerMinimapLabel.parentElement?.getBoundingClientRect();
    const labelY = bodyBounds
      ? barBounds.top + barBounds.height / 2 - bodyBounds.top
      : 0;

    readerMinimapLabel.textContent = closestBar.dataset.title ?? activeBook.title;
    readerMinimapLabel.style.setProperty('--label-y', `${labelY.toFixed(1)}px`);
    readerMinimapLabel.setAttribute('aria-hidden', 'false');
    readerMinimap.dataset.labelVisible = 'true';
  });
});
readerProgress.addEventListener('pointerleave', () => {
  window.cancelAnimationFrame(minimapMotionFrame ?? 0);
  readerMinimapBars.querySelectorAll<HTMLElement>('.reader-minimap-bar')
    .forEach((bar) => {
      bar.style.removeProperty('--hover-wave');
      bar.classList.remove('is-preview-current');
    });
  delete readerMinimap.dataset.previewing;
  delete readerMinimap.dataset.labelVisible;
  readerMinimapLabel.setAttribute('aria-hidden', 'true');
});

const startProgressScrub = () => {
  progressScrubbing = true;
  readerSurface.classList.add('is-scrubbing');
};

const finishProgressScrub = () => {
  if (!progressScrubbing) {
    return;
  }
  progressScrubbing = false;
  readerSurface.classList.remove('is-scrubbing');
  updateReaderNavigation();
  saveCurrentProgress();
};

progressSlider.addEventListener('pointerdown', startProgressScrub);
progressSlider.addEventListener('input', () => {
  if (readingDocumentPreparing) {
    return;
  }

  startProgressScrub();
  readerSurface.scrollTop = getScrollRange() * Number(progressSlider.value) / 100;
  const percent = Number(progressSlider.value);

  setSegmentedProgress(readerProgress, progressPercent, percent);
  updateMinimapBars(percent / 100);
});
progressSlider.addEventListener('change', finishProgressScrub);
progressSlider.addEventListener('pointerup', finishProgressScrub);
progressSlider.addEventListener('pointercancel', finishProgressScrub);
progressSlider.addEventListener('blur', finishProgressScrub);
readerSurface.addEventListener('scroll', () => {
  if (scrollProgressFrame !== undefined) {
    return;
  }
  scrollProgressFrame = requestAnimationFrame(() => {
    scrollProgressFrame = undefined;
    updateReaderNavigation();
    readingProgress[activeBook.id] = { anchor: getCurrentAnchor() };
    window.clearTimeout(scrollProgressSaveTimer);
    scrollProgressSaveTimer = window.setTimeout(() => {
      persistReadingProgress();
    }, 180);
  });
}, { passive: true });

const changeFontSize = (step: number) => {
  const nextSize = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, appearance.fontSize + step),
  );

  if (nextSize === appearance.fontSize) {
    return;
  }

  applyAppearance({ ...appearance, fontSize: nextSize });
};

settingsOptions.addEventListener('submit', (event) => {
  event.preventDefault();
  window.clearTimeout(appearanceInputTimer);
  const nextAppearance = readAppearanceForm();

  if (!nextAppearance) {
    return;
  }
  applyAppearance(nextAppearance);
});

settingsOptions.addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }
  event.target.removeAttribute('aria-invalid');
  if (event.target === foregroundInput || event.target === backgroundInput) {
    event.target.value = event.target.value.toUpperCase();
    updateColorPreview(event.target === foregroundInput ? 'foreground' : 'background');
  }

  const appearancePanelOpen = (
    mode === 'library' && activeLibraryPanel === 'appearance'
  ) || (
    mode === 'reading' && activePanel === 'appearance'
  );

  if (!appearancePanelOpen) {
    return;
  }
  window.clearTimeout(appearanceInputTimer);
  appearanceInputTimer = window.setTimeout(() => {
    const nextAppearance = readAppearanceForm();

    if (!nextAppearance) {
      return;
    }
    applyAppearance(nextAppearance, true, false);
  }, 160);
});

settingsOptions.addEventListener('change', () => {
  window.clearTimeout(appearanceInputTimer);
  const nextAppearance = readAppearanceForm();

  if (!nextAppearance) {
    return;
  }
  applyAppearance(nextAppearance);
});

document.addEventListener('pointerdown', (event) => {
  if (mode === 'library') {
    scheduleLibraryIdleReturn();
  }
  if (
    activePanel
    && event.target instanceof Node
    && !readerPanel.contains(event.target)
  ) {
    setReaderPanel(null, { restoreFocus: false });
  }
  if (
    activeLibraryPanel
    && !importInProgress
    && event.target instanceof Node
    && !libraryPanel.contains(event.target)
    && !(event.target instanceof Element && event.target.closest('[data-library-action]'))
  ) {
    setLibraryPanel(null, { restoreFocus: false });
  }
});

libraryView.addEventListener('wheel', scheduleLibraryIdleReturn, { passive: true });
libraryView.addEventListener('pointermove', scheduleLibraryIdleReturn, { passive: true });
libraryView.addEventListener('drop', scheduleLibraryIdleReturn);
window.addEventListener('focus', scheduleLibraryIdleReturn);
window.addEventListener('blur', clearLibraryIdleTimer);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleLibraryIdleReturn();
  } else {
    clearLibraryIdleTimer();
  }
});

const handleReaderCommand = (command: ReaderCommand) => {
  if (command === 'open-book') {
    if (mode === 'library') {
      importInput.click();
    } else if (mode === 'landing') {
      openImportOnLibraryEntry = true;
      enterLibrary();
    } else if (mode === 'reading') {
      void closeBook().then(() => {
        if (mode === 'library') {
          setLibraryPanel('import', { invoker: libraryImportButton });
          importInput.click();
        }
      });
    } else {
      announceStatus('当前操作完成后即可导入书籍');
    }
    return;
  }

  if (mode !== 'reading') {
    announceStatus('打开一本书后即可使用这项操作');
    return;
  }

  if (command === 'toggle-bookmark') {
    toggleBookmark();
  }
};

const unsubscribeReaderCommands = window.yuguang?.onReaderCommand(handleReaderCommand);
window.addEventListener('beforeunload', () => {
  if (mode === 'reading' || mode === 'opening') {
    window.clearTimeout(scrollProgressSaveTimer);
    saveCurrentProgress();
  }
  unsubscribeReaderCommands?.();
  clearLibraryIdleTimer();
  stopThinkingOrb();
});

window.addEventListener('keydown', (event) => {
  if (mode === 'library') {
    scheduleLibraryIdleReturn();
  }
  if (event.metaKey && event.key === ',') {
    if (mode === 'library') {
      event.preventDefault();
      setLibraryPanel(
        activeLibraryPanel === 'appearance' ? null : 'appearance',
        { invoker: libraryAppearanceButton },
      );
    } else if (mode === 'reading') {
      event.preventDefault();
      setReaderPanel(
        activePanel === 'appearance' ? null : 'appearance',
        { invoker: readerSurface },
      );
    }
    return;
  }

  if (event.metaKey && (event.key === '+' || event.key === '=')) {
    if (mode === 'library') {
      event.preventDefault();
      setLibraryPanel('appearance', { invoker: libraryAppearanceButton });
      changeFontSize(1);
    } else if (mode === 'reading') {
      event.preventDefault();
      setReaderPanel('appearance', { invoker: readerSurface });
      changeFontSize(1);
    }
    return;
  }

  if (event.metaKey && event.key === '-') {
    if (mode === 'library') {
      event.preventDefault();
      setLibraryPanel('appearance', { invoker: libraryAppearanceButton });
      changeFontSize(-1);
    } else if (mode === 'reading') {
      event.preventDefault();
      setReaderPanel('appearance', { invoker: readerSurface });
      changeFontSize(-1);
    }
    return;
  }

  if (event.metaKey && event.key === '0') {
    if (
      (mode === 'library' || mode === 'reading')
      && appearance.fontSize !== defaultAppearance.fontSize
    ) {
      event.preventDefault();
      applyAppearance({ ...appearance, fontSize: defaultAppearance.fontSize });
    }
    return;
  }

  if (event.metaKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (mode === 'library' && !libraryOpenInProgress) {
      setLibraryPanel('search', { invoker: librarySearchButton });
    }
    return;
  }

  if (event.key === 'Escape' && activeLibraryPanel && !importInProgress) {
    event.preventDefault();
    setLibraryPanel(null);
    return;
  }

  if (event.key === 'Escape' && loadingBookId) {
    event.preventDefault();
    openRequestRevision += 1;
    loadingBookId = null;
    activeAnimations.forEach((animation) => animation.cancel());
    activeAnimations = [];
    transitionBook.classList.remove('is-visible');
    setLibraryPhase('browsing');
    announceStatus('已取消打开');
    return;
  }

  if (event.key === 'Escape' && activePanel) {
    event.preventDefault();
    setReaderPanel(null);
    return;
  }

  if (event.key === 'Escape' && (mode === 'opening' || mode === 'reading')) {
    event.preventDefault();
    void closeBook();
    return;
  }

  if (mode !== 'reading') {
    return;
  }
});

const handleLayoutGeometryChange = () => {
  if (mode !== 'reading' && mode !== 'opening') {
    return;
  }
  const anchor = getCurrentAnchor();

  requestAnimationFrame(() => {
    refreshReadingLayout();
    scrollToAnchor(anchor, 'auto');
    renderReaderMinimapBars();
    updateReaderNavigation();
    renderProgressBookmarks();
  });
};

const readerResizeObserver = new ResizeObserver(handleLayoutGeometryChange);
readerResizeObserver.observe(readerSurface);
window.addEventListener('resize', handleLayoutGeometryChange);

appearance = readAppearance();
readingProgress = readProgress();
readerPins = readPins();
applyAppearance(appearance, false);
setReaderPanel(null, { restoreFocus: false });
setLibraryPanel(null, { restoreFocus: false });
setMode('landing');
stopThinkingOrb = createThinkingOrb(thinkingOrbCanvas, reducedMotion);
renderLibrarySearch();
updateCurrentBookEntry();
void loadImportedBookMetadata()
  .then((storedBooks) => {
    importedBooks = storedBooks;
    if (lastOpenedBookId && !getBookSummaryById(lastOpenedBookId)) {
      lastOpenedBookId = '';
      localStorage.removeItem(LAST_BOOK_KEY);
    }
    renderLibrarySearch();
    updateCurrentBookEntry();
  })
  .catch(() => announceStatus('本地书库暂时无法读取'));
