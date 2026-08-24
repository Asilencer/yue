/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';
import libraryImage from './assets/scenes/city-morning-library.png';
import landingImage from './assets/scenes/landing-mountain-morning-v2.png';
import coastOutlook from './assets/scenes/outlook-coast-afternoon.png';
import duskOutlook from './assets/scenes/outlook-city-dusk.png';
import mountainOutlook from './assets/scenes/outlook-mountain-morning.png';
import type { ReaderCommand } from './global';
import {
  deleteImportedBook,
  loadImportedBook,
  loadImportedBookMetadata,
  parseImportedBook,
  saveImportedBook,
  type ImportedBookMetadata,
  type ImportedBookRecord,
} from './library-store';
import {
  createTextSegments,
  paginateTextSegments,
  type TextSegment,
} from './paginator';
import { createThinkingOrb } from './thinking-orb';

type AppMode = 'landing' | 'library' | 'opening' | 'reading' | 'closing';
type Direction = 'forward' | 'backward';
type ReaderPanel = 'progress' | 'contents' | 'appearance';
type LandingPanel = 'background' | 'appearance';

type SourcePage = {
  runningTitle: string;
  eyebrow?: string;
  heading?: string;
  paragraphs: string[];
};

type ReadingPage = SourcePage & {
  startOffset: number;
  endOffset: number;
};

type Book = {
  id: string;
  title: string;
  author: string;
  color: string;
  position?: [number, number, number, number];
  chapterTitle?: string;
  paragraphs?: string[];
  imported?: boolean;
};

type ReaderAppearance = {
  fontFamily: string;
  fontSize: number;
  foreground: string;
  background: string;
};

type StoredReaderAppearance = Partial<ReaderAppearance> & {
  font?: 'serif' | 'sans';
  theme?: 'day' | 'night';
  paper?: 'warm' | 'neutral' | 'sage';
};

type ReaderBookmarks = Record<string, number[]>;

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
    src: coastOutlook,
    position: 'center',
    ink: 'dark',
  },
  {
    id: 'city-dusk',
    label: '黄昏都市',
    src: duskOutlook,
    position: 'center',
    ink: 'light',
  },
  {
    id: 'city-morning',
    label: '清晨街景',
    src: libraryImage,
    position: 'right center',
    ink: 'dark',
  },
] as const;
const storedLandingScene = localStorage.getItem(LANDING_SCENE_KEY);
const initialLandingSceneIndex = Math.max(
  0,
  landingScenes.findIndex((scene) => scene.id === storedLandingScene),
);
const initialLandingScene = landingScenes[initialLandingSceneIndex] ?? landingScenes[0];

const OUTLOOK_SCENE_KEY = 'outlookScene:v1';
const outlookScenes = [
  { id: 'mountain', label: '清晨山野', src: mountainOutlook, position: 'center' },
  { id: 'city-morning', label: '清晨街景', src: libraryImage, position: 'right center' },
  { id: 'city-dusk', label: '黄昏都市', src: duskOutlook, position: 'center' },
  { id: 'coast', label: '午后海岸', src: coastOutlook, position: 'center' },
] as const;
const storedOutlookScene = localStorage.getItem(OUTLOOK_SCENE_KEY);
const initialOutlookSceneIndex = Math.max(
  0,
  outlookScenes.findIndex((scene) => scene.id === storedOutlookScene),
);
const initialOutlookScene = outlookScenes[initialOutlookSceneIndex] ?? outlookScenes[0];

const books: Book[] = [
  {
    id: 'lake',
    title: '湖边散记',
    author: '林望',
    color: '#5276c7',
    position: [5.3, 4.23, 1.2, 18.04],
  },
  {
    id: 'spring',
    title: '春日庭院',
    author: '许青禾',
    color: '#86b99c',
    position: [6.56, 4.23, 1.58, 18.35],
  },
  {
    id: 'letters',
    title: '薄暮书简',
    author: '周野',
    color: '#ef8b74',
    position: [10.53, 4.23, 1.77, 19.25],
  },
  {
    id: 'north',
    title: '北方手札',
    author: '沈舟',
    color: '#273f58',
    position: [12.48, 4.23, 3.03, 19.96],
  },
  {
    id: 'plants',
    title: '寂静植物学',
    author: '简森',
    color: '#5c7f70',
    position: [15.57, 4.23, 1.45, 20.56],
  },
  {
    id: 'route',
    title: '微光航线',
    author: '陈屿',
    color: '#f2d164',
    position: [12.74, 33.06, 1.13, 25.1],
  },
  {
    id: 'notes',
    title: '月下笔记',
    author: '白榆',
    color: '#5276c7',
    position: [2.4, 36.59, 2.59, 22.18],
  },
  {
    id: 'distance',
    title: '远方来信',
    author: '陶然',
    color: '#ef8b74',
    position: [15.07, 35.79, 2.27, 22.08],
  },
];

const importedBookPositions = [
  [5.04, 39.31, 2.08, 19.25],
  [9.27, 34.98, 1.2, 23.39],
  [10.53, 32.76, 2.14, 25.5],
  [17.4, 35.58, 1.13, 22.08],
] as const;

const sourceSpreads: Array<[SourcePage, SourcePage]> = [
  [
    {
      runningTitle: '湖边散记',
      eyebrow: '第一章',
      heading: '窗外并不遥远',
      paragraphs: [
        '读一本书，并不是为了暂时离开生活。恰恰相反，是为了回来时能够看见更多。'
          + '清晨的光越过窗框，落在纸页，也落在街道上，文字与现实共享着同一份安静。',
        '我们常把远方理解成另一个地点，仿佛只有走出熟悉的房间，世界才会重新展开。'
          + '可是许多真正重要的变化，发生在目光停留得更久之后：一棵树不再只是背景，'
          + '一段沉默也不再只是没有声音。',
        '书给人的并非第二个世界，而是一种重新进入这个世界的方法。它把习以为常的事物'
          + '放慢，让经验里被忽略的纹理重新浮现。我们读到别人的犹疑，也更能辨认自己的犹疑。',
        '于是阅读开始像一扇向内打开的窗。我们没有离开座位，却已经移动了观看的位置；'
          + '当视线再次越过纸面，眼前的一切仍旧寻常，却不再只是从前的样子。',
      ],
    },
    {
      runningTitle: '湖边散记',
      paragraphs: [
        '窗外的公交车在路口停下，树叶被风吹向同一个方向。这样的景象每天都会发生，'
          + '通常只在余光中掠过。可当一段文字让注意力慢下来，熟悉的街道便显出新的层次。',
        '我们从作者那里借来一双眼睛，却不会永远沿用他的结论。阅读真正珍贵的部分，'
          + '恰恰是借来的目光与自身经验发生摩擦的时刻。赞同、迟疑和反驳，都在提醒我们：'
          + '思考并不是接收，而是一种参与。',
        '这种参与不会在合上书时结束。它可能进入下午的一次会议，让人多问一个问题；'
          + '也可能进入一段争执，使原本急于回应的人愿意先听完对方的话。文字离开纸面，'
          + '变成判断和行动，才真正获得了重量。',
        '因此，读得慢并不等于停滞。停顿有时是一种更深的前进：它让模糊的感受得到名字，'
          + '让未经检查的习惯显出边界，也让我们有机会决定，下一步是否还要沿着旧路走下去。',
        '城市仍然喧闹，屏幕上的消息仍不断亮起。但人在一页文字里建立的秩序，可以短暂地'
          + '抵抗这种牵引。不是拒绝世界，而是把注意力重新交还给自己。',
      ],
    },
  ],
  [
    {
      runningTitle: '窗外并不遥远',
      paragraphs: [
        '阅读需要安静，却不必把自己封闭起来。窗外的光线、远处车辆经过的声音，以及房间里'
          + '缓慢移动的影子，都在提醒人：书页之外还有一个正在发生的世界。',
        '正因为现实从未停止，纸上的问题才不会只是纸上的问题。关于勇气的句子，会在一次'
          + '需要表态的时刻回来；关于体谅的故事，会在我们准备轻易判断一个人时，留下片刻迟疑。',
        '一本书很少直接替人完成选择。它更像在心里增加了一些可以调用的路径，使我们面对'
          + '复杂情境时，不必只依赖最熟悉、最快速的反应。选择依然属于自己，但选择的空间变大了。',
        '这种变化往往细小得难以察觉。也许只是把一句绝对的话换成一个开放的问题，或是在忙碌'
          + '之中注意到同伴的疲惫。阅读的反馈并不总是宏大的，它首先发生在日常尺度里。',
        '当这些细小的改变积累起来，一个人的生活方式也会随之改变。思想并没有高悬在现实之上，'
          + '它落在每一次具体的观看、回应和承担里。',
      ],
    },
    {
      runningTitle: '窗外并不遥远',
      paragraphs: [
        '书架像一张私人地图。那些已经读过的书，并不只是完成过的项目；它们记录了人在不同'
          + '阶段愿意停留的问题。多年以后重新翻开，文字没有变化，读者却已经站在另一处。',
        '这也是重读的意义。第一次读到的是情节，第二次或许是人物没有说出口的话；年轻时关注'
          + '远方，后来却更在意归来。书没有替我们保存时间，却让不同时期的自己得以在同一页相遇。',
        '阅读因此不是一条笔直的道路。人会跳过，会回看，会在一句话旁停得比预想更久。真正舒适'
          + '的阅读空间，应该允许这些节奏发生，而不是不断提示进度、成就和剩余时间。',
        '工具越安静，注意力越容易抵达文字。翻页只需要回应手指的意图，界面只在被需要时出现。'
          + '纸张的触感可以被暗示，却不应成为遮挡内容的表演。',
        '当形式退到合适的位置，读者才会忘记自己正在使用一款软件。留下来的，是句子本身的速度，'
          + '以及句子在心里逐渐形成的回声。',
      ],
    },
  ],
  [
    {
      runningTitle: '湖边散记',
      paragraphs: [
        '好的文字不会替人结束思考。它留下一个仍在发热的问题，让读者把它带回工作、关系和'
          + '独处的时刻。问题没有立即的答案，却持续改变我们观察现实的方式。',
        '有些答案必须经过生活才能成立。书中关于失去的理解，可能要到真正告别时才显出分量；'
          + '关于自由的想象，也需要在承担后果时才变得完整。阅读提前埋下语言，经验后来使它发芽。',
        '因此，不必急着把每一本书归纳成几条结论。被记住的有时只是一幅画面、一种语气，或某个'
          + '尚未解决的矛盾。它们看似零散，却会在未来与新的经历彼此照亮。',
        '读者真正拥有的并不是书里的句子，而是句子穿过自身之后留下的变化。相同的文字经过不同'
          + '生命，会抵达不同的位置。这种差异不是误读，而是阅读得以继续发生的原因。',
        '当我们允许问题保持开放，世界也不再急于被简化。复杂并没有消失，但人可以更从容地与它'
          + '相处，在确定与未知之间，为下一次理解保留空间。',
      ],
    },
    {
      runningTitle: '窗外并不遥远',
      paragraphs: [
        '读到这里，阳光已经从窗框的一侧移向另一侧。房间没有因为一本书而突然改变，远处的楼宇'
          + '仍被晨雾包围，街上的人仍沿着各自的方向前行。',
        '改变的是注意力。它从狭窄的惯性里松开，开始容纳更多真实的声音，也更愿意承认自己的判断'
          + '可能有限。轻盈不是逃避重量，而是知道什么值得带走，什么可以暂时留在原地。',
        '每次翻页都像一次小小的练习：承认尚未知道，越过熟悉的边界，然后在另一侧重新站稳。'
          + '这种练习最终并不指向书本，而指向我们将如何面对下一件真实发生的事。',
        '窗户始终开着。书中的远方与脚下的街道，从来属于同一个世界。阅读让人短暂停下，不是为了'
          + '退出现实，而是为了带着更清楚、更柔软也更坚定的目光重新进入。',
        '合上书以后，思想仍会继续。它藏在一次耐心的倾听、一项更诚实的选择，或一条终于愿意走出'
          + '去的路里。那是文字在现实中得到的回答，也是阅读真正完成的地方。',
      ],
    },
  ],
];

const paragraphStream = sourceSpreads
  .flatMap((spread) => spread)
  .flatMap((page) => page.paragraphs);

const emptyPage = (offset = 0): ReadingPage => ({
  runningTitle: '',
  paragraphs: [],
  startOffset: offset,
  endOffset: offset,
});

let pages: ReadingPage[] = [emptyPage(), emptyPage()];
let spreads: Array<[ReadingPage, ReadingPage]> = [[pages[0], pages[1]]];

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

const renderBookButtons = (items: Book[]) => items
  .map((book) => {
    const position = book.position ?? [0, 0, 0, 0];

    return `
      <button
        class="book-hit book-spine"
        data-book-id="${book.id}"
        aria-label="打开《${book.title}》"
        title="${book.title} · ${book.author}"
        style="--x: ${position[0]}%; --y: ${position[1]}%;
          --w: ${position[2]}%; --h: ${position[3]}%;
          --book-color: ${book.color}"
      >
        <span class="book-spine-title">${book.title}</span>
        <span class="book-spine-author">${book.author}</span>
      </button>
    `;
  })
  .join('');

const reiconImageMountain = `
  <path
    d="M21.7719 16.8773 16.0746 9.128c-.5333-.724-1.616-.724-2.148 0
      l-4.4253 6.0187-1.9253-2.6187c-.5333-.7253-1.616-.7253-2.148 0
      l-3.1973 4.3493C1.5827 17.7573 2.212 19 3.3054 19h17.3919
      c1.0933 0 1.7213-1.2427 1.0746-2.1227Z"
  />
  <circle cx="7.3333" cy="5.3333" r="2.3333" />
`;

const reiconSettings4 = `
  <circle cx="12" cy="12" r="4.5" />
  <path d="M2 12h5M17 12h5" />
`;

const reiconTextHighlight = `
  <path d="M8.7266 20.3333H19" />
  <path
    d="m13.052 16.164-6.512-3.288c-.7187-.3627-.9547-1.276-.5-1.9413
      l5.0213-7.364c.7533-1.1053 2.2107-1.4813 3.4053-.8787l2.076 1.048
      c1.1947.6027 1.7573 1.9987 1.3147 3.2613l-2.944 8.412
      c-.2667.76-1.14 1.1133-1.86.7493Z"
  />
  <path
    d="M13.364 16.3266c-2.6587.688-3.9533 2.652-4.336 3.412l-1.488-.7507
      -1.488-.7507c.384-.76 1.1947-2.968.1707-5.5147"
  />
  <path d="m9.0266 19.7386-.3.5947H5l1.052-2.0973" />
`;

const reiconRuler = `
  <path d="M5 17h14c2 0 3-1 3-3v-4c0-2-1-3-3-3H5c-2 0-3 1-3 3v4c0 2 1 3 3 3Z" />
  <path d="M18 7v5M14 7v3M10.05 7 10 12M6 7v4" />
`;

const reiconColorFilter = `
  <path
    d="M14 16c0 1.77-.77 3.37-2 4.46A5.97 5.97 0 0 1 8 22a6 6 0 0 1-1.58-11.79
      6 6 0 0 0 7.16 3.58c.27.68.42 1.43.42 2.21Z"
  />
  <path
    d="M18 8c0 .78-.15 1.53-.42 2.21a6 6 0 0 1-11.16 0A6 6 0 1 1 18 8Z"
  />
  <path
    d="M22 16a6 6 0 0 1-10 4.46A6 6 0 0 0 13.58 13.79
      a6 6 0 0 0 4-3.58A6 6 0 0 1 22 16Z"
  />
`;

const reiconColorsSquare = `
  <path
    d="M13.2 14.4a3.6 3.6 0 1 1-4.55-3.47 3.6 3.6 0 0 0 4.3 2.15
      c.16.4.25.85.25 1.32Z"
  />
  <path d="M15.6 9.6a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0Z" />
  <path
    d="M18 14.4a3.6 3.6 0 0 1-6 2.68 3.6 3.6 0 0 0 .95-4.01
      3.6 3.6 0 0 0 2.4-2.15A3.6 3.6 0 0 1 18 14.4Z"
  />
  <path
    d="M9 22h6c5 0 7-2 7-7V9c0-5-2-7-7-7H9C4 2 2 4 2 9v6c0 5 2 7 7 7Z"
  />
`;

const readerIconPaths = {
  library: `
    <path d="M3.75 5.5h4.5A3.75 3.75 0 0 1 12 9.25v10.5A3.75 3.75 0 0 0 8.25 16h-4.5V5.5Z" />
    <path d="M20.25 5.5h-4.5A3.75 3.75 0 0 0 12 9.25v10.5A3.75 3.75 0 0 1 15.75 16h4.5V5.5Z" />
  `,
  progress: `
    <circle cx="12" cy="12" r="8.25" />
    <path d="M12 3.75V12h8.25" />
  `,
  previous: '<path d="m14.75 5.75-6.25 6.25 6.25 6.25" />',
  next: '<path d="m9.25 5.75 6.25 6.25-6.25 6.25" />',
  contents: `
    <circle cx="5" cy="6" r=".75" />
    <circle cx="5" cy="12" r=".75" />
    <circle cx="5" cy="18" r=".75" />
    <path d="M9 6h10M9 12h10M9 18h10" />
  `,
  bookmark: `
    <path class="reader-icon-bookmark-shape" d="M7 4.25h10v15.5L12 16.5l-5 3.25V4.25Z" />
  `,
  landingBackground: reiconImageMountain,
  landingAppearance: reiconSettings4,
  appearanceFont: reiconTextHighlight,
  appearanceSize: reiconRuler,
  appearanceForeground: reiconColorFilter,
  appearanceBackground: reiconColorsSquare,
  background: `
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="16.25" cy="8.25" r="1.5" />
    <path d="m5.5 17 4.25-4.5 3.1 3 2.15-2.25L18.5 17" />
  `,
  appearance: `
    <path d="M4.75 7V5.5h9V7M9.25 5.5V19M6.75 19h5" />
    <path d="M15 10h4.25M17.25 10v9M15.5 19H19" />
  `,
  sound: `
    <path d="M4 9.75v4.5h4l4.25 3.5V6.25L8 9.75H4Z" />
    <path d="M15.5 9a4.25 4.25 0 0 1 0 6M17.75 6.75a7.4 7.4 0 0 1 0 10.5" />
  `,
  soundOff: `
    <path d="M4 9.75v4.5h4l4.25 3.5V6.25L8 9.75H4Z" />
    <path d="m15.25 9.25 5.5 5.5m0-5.5-5.5 5.5" />
  `,
  close: '<path d="m6.5 6.5 11 11m0-11-11 11" />',
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

const renderLandingSceneButtons = () => landingScenes
  .map((scene, index) => `
    <button
      type="button"
      class="landing-scene-option"
      data-landing-scene-index="${index}"
      aria-label="使用${scene.label}作为首页背景"
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

      <nav class="landing-dock" aria-label="首页设置">
        <button
          class="landing-control-button"
          data-landing-action="background"
          aria-label="设置首页背景"
          title="设置首页背景"
          aria-expanded="false"
          aria-controls="landing-control-hub"
        >${renderReaderIcon('landingBackground')}</button>
        <span class="landing-dock-divider" aria-hidden="true"></span>
        <button
          class="landing-control-button"
          data-landing-action="appearance"
          aria-label="设置首页排版"
          title="设置首页排版"
          aria-expanded="false"
          aria-controls="landing-control-hub"
        >${renderReaderIcon('landingAppearance')}</button>
      </nav>

      <section
        class="landing-hub"
        id="landing-control-hub"
        data-landing-panel
        aria-label="首页设置"
        aria-hidden="true"
        inert
      >
        <div class="landing-hub-view" data-landing-panel-view="background">
          <div class="landing-scene-options">
            ${renderLandingSceneButtons()}
          </div>
        </div>
        <div
          class="landing-hub-view"
          data-landing-panel-view="appearance"
          data-landing-appearance-mount
        ></div>
      </section>
    </section>

    <section
      class="library-view view"
      aria-label="我的书架"
      aria-hidden="true"
      inert
    >
      <div class="scene-plane">
        <div class="scene-outlook" aria-hidden="true">
          <img
            class="scene-outlook-image"
            data-outlook-image
            src="${initialOutlookScene.src}"
            style="object-position: ${initialOutlookScene.position}"
            alt=""
          />
        </div>
        <img
          class="scene-image scene-shelf-image"
          src="${libraryImage}"
          alt="窗边固定的当代书架"
        />
        <div class="sun-haze" aria-hidden="true"></div>
        <div class="book-hotspots" aria-label="书架上的书">
          ${renderBookButtons(books)}
          <div class="imported-book-list" data-imported-books></div>
          <input
            class="visually-hidden"
            data-import-input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            multiple
            tabindex="-1"
            aria-hidden="true"
          />
        </div>
        <button
          class="shelf-management-tag"
          data-library-open
          aria-label="管理书架"
          aria-controls="shelf-manager"
          aria-expanded="false"
        >
          <span data-library-tag-label>管理</span>
        </button>

        <button
          class="outlook-switch"
          data-outlook-switch
          aria-label="切换窗外景色，当前为${initialOutlookScene.label}"
          title="切换窗景"
        >
          <span>窗景</span>
          <strong data-outlook-label>${initialOutlookScene.label}</strong>
          <span aria-hidden="true">↻</span>
        </button>

        <section
          class="shelf-manager"
          id="shelf-manager"
          data-library-lens
          aria-label="书架管理"
          role="dialog"
          aria-modal="true"
          aria-hidden="true"
          inert
        >
          <div class="shelf-cubby-washes" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <header class="shelf-manager-header">
            <div>
              <span>书架正面</span>
              <strong>管理我的书</strong>
              <small data-library-count>0 本书</small>
            </div>
            <div class="shelf-manager-actions">
              <button data-library-import>放入新书</button>
              <button data-library-close aria-label="关闭书架管理">完成</button>
            </div>
          </header>
          <div class="shelf-manager-stage">
            <label class="library-search">
              <span class="visually-hidden">搜索书架中的书</span>
              <input data-library-search type="search" placeholder="搜索书名或作者" />
            </label>
            <div class="library-grid" data-library-grid></div>
            <p class="library-empty" data-library-empty>没有找到相符的书。</p>
          </div>
        </section>
      </div>

      <div class="library-drop-hint" data-library-drop-hint aria-hidden="true">
        <span>把书放到书架上</span>
        <small>支持 TXT 与 Markdown</small>
      </div>

    </section>

    <section
      class="reader-view view"
      aria-label="沉浸阅读"
      aria-hidden="true"
      tabindex="-1"
      inert
      data-controls="quiet"
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
      <div class="reader-surface">
        <div class="book-copy">
          <article class="page-copy page-copy-left" data-left-page></article>
          <article class="page-copy page-copy-right" data-right-page></article>
        </div>
        <article
          class="page-copy page-copy-right pagination-measure"
          data-pagination-measure
          aria-hidden="true"
        ></article>
        <div class="page-turn-sheet" aria-hidden="true">
          <article class="turn-face turn-front" data-turn-front></article>
          <article class="turn-face turn-back" data-turn-back></article>
        </div>
        <div class="reader-gutter" aria-hidden="true"></div>
      </div>

      <button
        class="page-zone page-zone-left"
        data-page-back-zone
        aria-hidden="true"
        tabindex="-1"
      ></button>
      <button
        class="page-zone page-zone-right"
        data-page-forward-zone
        aria-hidden="true"
        tabindex="-1"
      ></button>

      <nav class="reader-chrome reader-dock" aria-label="阅读控制">
        <div class="reader-dock-group reader-dock-group-primary">
          <button
            class="reader-control-button return-control"
            data-return
            aria-label="返回书架"
            title="返回书架"
          >${renderReaderIcon('library')}</button>
          <button
            class="reader-control-button"
            data-reader-action="progress"
            aria-label="阅读进度"
            title="阅读进度"
            aria-expanded="false"
            aria-controls="reader-control-hub"
          >${renderReaderIcon('progress')}</button>
          <button
            class="reader-control-button"
            data-reader-action="contents"
            aria-label="目录与书签"
            title="目录与书签"
            aria-expanded="false"
            aria-controls="reader-control-hub"
          >${renderReaderIcon('contents')}</button>
        </div>
        <span class="reader-dock-divider" aria-hidden="true"></span>
        <div class="reader-dock-group reader-dock-group-pages">
          <button
            class="reader-control-button reader-page-button"
            data-page-back
            aria-label="上一页"
            title="上一页"
          >${renderReaderIcon('previous')}</button>
          <button
            class="reader-control-button reader-page-button"
            data-page-forward
            aria-label="下一页"
            title="下一页"
          >${renderReaderIcon('next')}</button>
        </div>
        <span class="reader-dock-divider" aria-hidden="true"></span>
        <div class="reader-dock-group reader-dock-group-secondary">
          <button
            class="reader-control-button reader-bookmark"
            data-reader-action="bookmark"
            aria-label="添加当前书签"
            title="添加当前书签"
            aria-pressed="false"
          >${renderReaderIcon('bookmark')}</button>
          <button
            class="reader-control-button"
            data-reader-action="appearance"
            data-settings-trigger
            aria-label="阅读显示"
            title="阅读显示"
            aria-expanded="false"
            aria-controls="reader-control-hub"
          >${renderReaderIcon('appearance')}</button>
          <button
            class="reader-control-button sound-toggle"
            data-sound
            aria-label="纸张声效已开启"
            title="纸张声效已开启"
            aria-pressed="true"
          >
            <span class="reader-sound-on">${renderReaderIcon('sound')}</span>
            <span class="reader-sound-off">${renderReaderIcon('soundOff')}</span>
          </button>
        </div>
        <span class="visually-hidden" data-reader-title></span>
      </nav>

      <section
        class="reader-hub"
        id="reader-control-hub"
        data-reader-panel
        aria-labelledby="reader-panel-title"
        aria-hidden="true"
        inert
      >
        <header class="reader-hub-header">
          <h2 id="reader-panel-title" data-reader-panel-title></h2>
          <button
            data-reader-panel-close
            aria-label="关闭阅读面板"
            title="关闭"
          >${renderReaderIcon('close')}</button>
        </header>

        <div class="reader-hub-progress">
          <span data-progress-chapter></span>
          <input
            data-progress-slider
            type="range"
            min="0"
            max="0"
            value="0"
            step="1"
            aria-label="阅读进度"
          />
          <span data-progress-label>0%</span>
        </div>

        <div class="reader-hub-view" data-panel-view="contents">
          <div data-contents-list></div>
        </div>

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
                  ${renderReaderIcon('appearanceForeground')}
                  <span>前景色</span>
                </span>
                <span class="appearance-color-input">
                  <span data-color-preview="foreground" aria-hidden="true"></span>
                  <input
                    data-appearance-input="foreground"
                    type="text"
                    aria-label="前景色"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="#252B2D"
                  />
                </span>
              </label>
              <label class="appearance-field" data-reader-only>
                <span class="appearance-field-label">
                  ${renderReaderIcon('appearanceBackground')}
                  <span>背景色</span>
                </span>
                <span class="appearance-color-input">
                  <span data-color-preview="background" aria-hidden="true"></span>
                  <input
                    data-appearance-input="background"
                    type="text"
                    aria-label="背景色"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="#FAF8F2"
                  />
                </span>
              </label>
              <div class="appearance-actions">
                <span data-appearance-message role="status" aria-live="polite"></span>
                <button type="button" data-appearance-reset>恢复默认</button>
                <button class="appearance-apply" type="submit">应用</button>
              </div>
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

    <div
      class="removal-toast"
      data-removal-toast
      aria-hidden="true"
      aria-live="polite"
      inert
    >
      <span data-removal-message></span>
      <button data-removal-undo>撤销</button>
    </div>

    <div class="quiet-toast" data-toast role="status">
      <span data-toast-message></span>
      <button data-toast-action hidden></button>
    </div>
  </main>
`;

const shell = queryRequired<HTMLElement>('.app-shell');
const landingView = queryRequired<HTMLElement>('.landing-view');
const enterLibraryButton = queryRequired<HTMLButtonElement>('[data-enter-library]');
const thinkingOrbCanvas = queryRequired<HTMLCanvasElement>('[data-thinking-orb]');
const landingSceneImage = queryRequired<HTMLImageElement>('[data-landing-scene]');
const landingPanel = queryRequired<HTMLElement>('[data-landing-panel]');
const landingAppearanceMount = queryRequired<HTMLElement>(
  '[data-landing-appearance-mount]',
);
const landingPanelActionButtons = [
  ...landingView.querySelectorAll<HTMLButtonElement>('[data-landing-action]'),
];
const landingSceneButtons = [
  ...landingView.querySelectorAll<HTMLButtonElement>('[data-landing-scene-index]'),
];
const libraryView = queryRequired<HTMLElement>('.library-view');
const bookHotspots = queryRequired<HTMLElement>('.book-hotspots');
const readerView = queryRequired<HTMLElement>('.reader-view');
const readerSceneImage = queryRequired<HTMLImageElement>('[data-reader-scene]');
const readerSurface = queryRequired<HTMLElement>('.reader-surface');
const transitionBook = queryRequired<HTMLElement>('.transition-book');
const transitionCover = queryRequired<HTMLElement>('.transition-cover');
const transitionTitle = queryRequired<HTMLElement>('[data-transition-title]');
const bookCopy = queryRequired<HTMLElement>('.book-copy');
const leftPage = queryRequired<HTMLElement>('[data-left-page]');
const rightPage = queryRequired<HTMLElement>('[data-right-page]');
const paginationMeasure = queryRequired<HTMLElement>('[data-pagination-measure]');
const turnSheet = queryRequired<HTMLElement>('.page-turn-sheet');
const turnFront = queryRequired<HTMLElement>('[data-turn-front]');
const turnBack = queryRequired<HTMLElement>('[data-turn-back]');
const readerStatus = queryRequired<HTMLElement>('[data-reader-status]');
const soundButton = queryRequired<HTMLButtonElement>('[data-sound]');
const toast = queryRequired<HTMLElement>('[data-toast]');
const toastMessage = queryRequired<HTMLElement>('[data-toast-message]');
const toastActionButton = queryRequired<HTMLButtonElement>('[data-toast-action]');
const removalToast = queryRequired<HTMLElement>('[data-removal-toast]');
const removalMessage = queryRequired<HTMLElement>('[data-removal-message]');
const removalUndoButton = queryRequired<HTMLButtonElement>('[data-removal-undo]');
const importedBookList = queryRequired<HTMLElement>('[data-imported-books]');
const importInput = queryRequired<HTMLInputElement>('[data-import-input]');
const libraryLens = queryRequired<HTMLElement>('[data-library-lens]');
const libraryGrid = queryRequired<HTMLElement>('[data-library-grid]');
const libraryEmpty = queryRequired<HTMLElement>('[data-library-empty]');
const libraryCount = queryRequired<HTMLElement>('[data-library-count]');
const librarySearch = queryRequired<HTMLInputElement>('[data-library-search]');
const libraryOpenButton = queryRequired<HTMLButtonElement>('[data-library-open]');
const libraryTagLabel = queryRequired<HTMLElement>('[data-library-tag-label]');
const libraryImportButton = queryRequired<HTMLButtonElement>('[data-library-import]');
const outlookImage = queryRequired<HTMLImageElement>('[data-outlook-image]');
const outlookSwitch = queryRequired<HTMLButtonElement>('[data-outlook-switch]');
const outlookLabel = queryRequired<HTMLElement>('[data-outlook-label]');
const settingsTrigger = queryRequired<HTMLButtonElement>('[data-settings-trigger]');
const settingsOptions = queryRequired<HTMLFormElement>('[data-settings-options]');
const readerAppearanceMount = queryRequired<HTMLElement>('[data-reader-appearance-mount]');
const fontFamilyInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="fontFamily"]',
);
const fontSizeInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="fontSize"]',
);
const foregroundInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="foreground"]',
);
const backgroundInput = queryRequired<HTMLInputElement>(
  '[data-appearance-input="background"]',
);
const appearanceMessage = queryRequired<HTMLElement>('[data-appearance-message]');
const appearanceResetButton = queryRequired<HTMLButtonElement>('[data-appearance-reset]');
const readerTitle = queryRequired<HTMLElement>('[data-reader-title]');
const progressChapter = queryRequired<HTMLElement>('[data-progress-chapter]');
const progressSlider = queryRequired<HTMLInputElement>('[data-progress-slider]');
const progressLabel = queryRequired<HTMLElement>('[data-progress-label]');
const bookmarkButton = queryRequired<HTMLButtonElement>('[data-reader-action="bookmark"]');
const readerPanel = queryRequired<HTMLElement>('[data-reader-panel]');
const readerPanelTitle = queryRequired<HTMLElement>('[data-reader-panel-title]');
const contentsList = queryRequired<HTMLElement>('[data-contents-list]');
const panelActionButtons = [
  ...readerView.querySelectorAll<HTMLButtonElement>(
    '[data-reader-action="progress"], [data-reader-action="contents"], '
      + '[data-reader-action="appearance"]',
  ),
];
const readerChrome = [...readerView.querySelectorAll<HTMLElement>('.reader-chrome')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const APPEARANCE_KEY = 'readerAppearance:v3';
const PREVIOUS_APPEARANCE_KEY = 'readerAppearance:v2';
const LEGACY_APPEARANCE_KEY = 'readerAppearance:v1';
const PROGRESS_KEY = 'readerProgress:v1';
const BOOKMARKS_KEY = 'readerBookmarks:v1';
const LAST_BOOK_KEY = 'lastOpenedBook:v1';
const SOUND_KEY = 'paperSound:v1';
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const defaultAppearance: ReaderAppearance = {
  fontFamily: 'Songti SC',
  fontSize: 17,
  foreground: '#252b2d',
  background: '#faf8f2',
};

let mode: AppMode = 'landing';
let activeBook = books[0];
let activeTrigger: HTMLButtonElement | null = null;
let spreadIndex = 0;
let turnInProgress = false;
let soundEnabled = true;
let audioContext: AudioContext | undefined;
let audioMaster: GainNode | undefined;
let noiseBuffer: AudioBuffer | undefined;
let toastTimer: number | undefined;
let removalTimer: number | undefined;
let controlsTimer: number | undefined;
let closePending = false;
let pendingDirection: Direction | null = null;
let activeAnimations: Animation[] = [];
let importedBooks: ImportedBookMetadata[] = [];
let openRequestRevision = 0;
let loadingBookId: string | null = null;
let paginationGeneration = 0;
let layoutRevision = 0;
let paginationInProgress = false;
let pendingLayout = false;
let resizeTimer: number | undefined;
let appearanceInputTimer: number | undefined;
let observedLayoutSignature = '';
let activePanel: ReaderPanel | null = null;
let panelInvoker: HTMLElement | null = null;
let activeLandingPanel: LandingPanel | null = null;
let landingPanelInvoker: HTMLElement | null = null;
let landingSceneIndex = initialLandingSceneIndex;
let landingSceneRevision = 0;
let outlookSceneIndex = initialOutlookSceneIndex;
let outlookSceneRevision = 0;
let lastOpenedBookId = localStorage.getItem(LAST_BOOK_KEY) ?? books[0].id;
let appearance = { ...defaultAppearance };
let readingProgress: Record<string, number> = {};
let readerBookmarks: ReaderBookmarks = {};
let stopThinkingOrb: () => void = () => undefined;
const pendingRemovals = new Map<string, ImportedBookMetadata>();
const paginationCache = new Map<string, ReadingPage[]>();
const loadedBookCache = new Map<string, Book>();
const MAX_PAGINATION_CACHE_ENTRIES = 8;
const MAX_LOADED_BOOK_CACHE_ENTRIES = 3;

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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
      readerSceneImage.src = scene.src;
      readerSceneImage.style.objectPosition = scene.position;
      landingSceneButtons.forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(Number(button.dataset.landingSceneIndex) === nextIndex),
        );
      });
      localStorage.setItem(LANDING_SCENE_KEY, scene.id);
      requestAnimationFrame(() => landingSceneImage.classList.remove('is-changing'));
    }, 140);
  }, { once: true });
  preload.src = scene.src;
};

const setOutlookScene = (nextIndex: number) => {
  const normalizedIndex = (
    (nextIndex % outlookScenes.length) + outlookScenes.length
  ) % outlookScenes.length;
  const nextScene = outlookScenes[normalizedIndex];

  if (!nextScene || normalizedIndex === outlookSceneIndex) {
    return;
  }

  const revision = ++outlookSceneRevision;
  const preload = new Image();

  preload.addEventListener('load', () => {
    if (revision !== outlookSceneRevision) {
      return;
    }

    outlookImage.classList.add('is-changing');
    window.setTimeout(() => {
      if (revision !== outlookSceneRevision) {
        return;
      }

      outlookSceneIndex = normalizedIndex;
      outlookImage.src = nextScene.src;
      outlookImage.style.objectPosition = nextScene.position;
      outlookLabel.textContent = nextScene.label;
      outlookSwitch.setAttribute('aria-label', `切换窗外景色，当前为${nextScene.label}`);
      localStorage.setItem(OUTLOOK_SCENE_KEY, nextScene.id);
      requestAnimationFrame(() => outlookImage.classList.remove('is-changing'));
    }, 150);
  }, { once: true });
  preload.src = nextScene.src;
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

const createPageElement = (page: SourcePage, pageNumber: number) => {
  const pageInner = document.createElement('div');
  const pageBody = document.createElement('div');

  pageInner.className = 'page-inner';
  pageBody.className = 'page-body';

  page.paragraphs.forEach((paragraph) => {
    pageBody.append(createTextElement('p', '', paragraph));
  });
  pageInner.append(pageBody);
  pageInner.append(createTextElement('span', 'page-number', String(pageNumber)));
  return pageInner;
};

const mountPage = (target: HTMLElement, page: SourcePage, pageNumber: number) => {
  target.replaceChildren(createPageElement(page, pageNumber));
};

const mountReadingPage = (
  target: HTMLElement,
  page: ReadingPage,
  pageNumber: number,
) => {
  const blank = page.paragraphs.length === 0 && page.startOffset === page.endOffset;

  target.classList.toggle('is-blank-page', blank);
  target.setAttribute('aria-hidden', String(blank));
  if (blank) {
    target.replaceChildren();
  } else {
    mountPage(target, page, pageNumber);
  }
};

const pairPages = (nextPages: ReadingPage[]) => {
  const pairedPages = [...nextPages];
  const lastOffset = pairedPages.at(-1)?.endOffset ?? 0;

  if (pairedPages.length % 2 !== 0) {
    pairedPages.push(emptyPage(lastOffset));
  }

  const nextSpreads: Array<[ReadingPage, ReadingPage]> = [];
  for (let index = 0; index < pairedPages.length; index += 2) {
    nextSpreads.push([pairedPages[index], pairedPages[index + 1]]);
  }
  return nextSpreads;
};

const renderSpread = () => {
  const [left, right] = spreads[spreadIndex];
  const firstPage = spreadIndex * 2 + 1;

  mountReadingPage(leftPage, left, firstPage);
  mountReadingPage(rightPage, right, firstPage + 1);
  pageBackButton.disabled = spreadIndex === 0;
  pageForwardButton.disabled = spreadIndex === spreads.length - 1;
  pageBackZone.disabled = pageBackButton.disabled;
  pageForwardZone.disabled = pageForwardButton.disabled;
  updateReaderNavigation();
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
    const stored = JSON.parse(
      currentRaw
        ?? previousRaw
        ?? localStorage.getItem(LEGACY_APPEARANCE_KEY)
        ?? '{}',
    ) as StoredReaderAppearance;
    const legacyPaper = stored.paper ?? 'warm';
    const legacyBackgrounds = stored.theme === 'night'
      ? {
          warm: '#211f1c',
          neutral: '#1d2223',
          sage: '#1b2421',
        }
      : {
          warm: defaultAppearance.background,
          neutral: '#f4f4ef',
          sage: '#eaf0e9',
        };
    const fontFamily = isFontFamily(stored.fontFamily)
      ? stored.fontFamily.trim()
      : stored.font === 'sans'
        ? 'PingFang SC'
        : defaultAppearance.fontFamily;
    const fontSize = !currentRaw && previousRaw && stored.fontSize === 18
      ? defaultAppearance.fontSize
      : typeof stored.fontSize === 'number'
      && Number.isFinite(stored.fontSize)
      && Number.isInteger(stored.fontSize)
      && stored.fontSize >= MIN_FONT_SIZE
      && stored.fontSize <= MAX_FONT_SIZE
        ? stored.fontSize
        : defaultAppearance.fontSize;
    const foreground = normalizeHexColor(stored.foreground)
      ?? (stored.theme === 'night'
        ? '#d9dad3'
        : defaultAppearance.foreground);
    const background = normalizeHexColor(stored.background)
      ?? legacyBackgrounds[legacyPaper];

    const nextAppearance = { fontFamily, fontSize, foreground, background };

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
    const stored = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as unknown;

    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(stored)
        .filter((entry): entry is [string, number] => (
          typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0
        )),
    );
  } catch {
    return {};
  }
};

const readBookmarks = (): ReaderBookmarks => {
  try {
    const stored = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? '{}') as unknown;

    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(stored)
        .filter((entry): entry is [string, number[]] => (
          Array.isArray(entry[1])
          && entry[1].every((anchor) => (
            typeof anchor === 'number' && Number.isFinite(anchor) && anchor >= 0
          ))
        )),
    );
  } catch {
    return {};
  }
};

const readSoundEnabled = () => localStorage.getItem(SOUND_KEY) !== 'false';

const updateColorPreview = (
  input: HTMLInputElement,
  setting: 'foreground' | 'background',
) => {
  const preview = queryRequired<HTMLElement>(`[data-color-preview="${setting}"]`);
  const value = input.value.trim();
  const normalized = normalizeHexColor(value);

  preview.style.backgroundColor = normalized ?? 'transparent';
  preview.classList.toggle('is-invalid', Boolean(value) && !normalized);
};

const updateAppearanceControls = () => {
  fontFamilyInput.value = appearance.fontFamily;
  fontSizeInput.value = String(appearance.fontSize);
  foregroundInput.value = appearance.foreground.toUpperCase();
  backgroundInput.value = appearance.background.toUpperCase();
  updateColorPreview(foregroundInput, 'foreground');
  updateColorPreview(backgroundInput, 'background');
};

const applyAppearance = (
  nextAppearance: ReaderAppearance,
  persist = true,
  syncControls = true,
) => {
  appearance = nextAppearance;
  const fontFamily = toCssFontFamily(appearance.fontFamily);

  shell.style.setProperty('--reader-font', fontFamily);
  shell.style.setProperty('--reader-ui-font', fontFamily);
  shell.style.setProperty('--reader-font-size', `${appearance.fontSize}px`);
  readerView.style.setProperty('--reader-ink', appearance.foreground);
  readerView.style.setProperty('--reader-paper-background', appearance.background);
  if (syncControls) {
    updateAppearanceControls();
  }

  if (persist) {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  }
};

const readAppearanceForm = (): ReaderAppearance | null => {
  const fontFamily = fontFamilyInput.value.trim();
  const fontSize = Number(fontSizeInput.value);
  const foreground = normalizeHexColor(foregroundInput.value);
  const background = normalizeHexColor(backgroundInput.value);
  const validFont = isFontFamily(fontFamily);
  const validSize = Number.isFinite(fontSize)
    && Number.isInteger(fontSize)
    && fontSize >= MIN_FONT_SIZE
    && fontSize <= MAX_FONT_SIZE;
  const validForeground = Boolean(foreground);
  const validBackground = Boolean(background);

  fontFamilyInput.setAttribute('aria-invalid', String(!validFont));
  fontSizeInput.setAttribute('aria-invalid', String(!validSize));
  foregroundInput.setAttribute('aria-invalid', String(!validForeground));
  backgroundInput.setAttribute('aria-invalid', String(!validBackground));

  if (!validFont) {
    appearanceMessage.textContent = '请输入有效的字体名称';
  } else if (!validSize) {
    appearanceMessage.textContent = `字号需在 ${MIN_FONT_SIZE}–${MAX_FONT_SIZE} px`;
  } else if (!validForeground || !validBackground) {
    appearanceMessage.textContent = '颜色请使用 #RGB 或 #RRGGBB';
  } else {
    appearanceMessage.textContent = '';
  }

  return validFont && validSize && foreground && background
    ? { fontFamily, fontSize, foreground, background }
    : null;
};

const resetAppearanceFormState = () => {
  updateAppearanceControls();
  settingsOptions.querySelectorAll('input').forEach((input) => {
    input.removeAttribute('aria-invalid');
  });
  appearanceMessage.textContent = '';
};

const setLandingPanel = (
  panel: LandingPanel | null,
  options: { invoker?: HTMLElement; restoreFocus?: boolean } = {},
) => {
  const restoreTarget = landingPanelInvoker?.isConnected
    ? landingPanelInvoker
    : enterLibraryButton;

  if (!panel && options.restoreFocus !== false) {
    restoreTarget.focus({ preventScroll: true });
  }
  if (panel && (options.invoker || !activeLandingPanel)) {
    landingPanelInvoker = options.invoker
      ?? landingPanelActionButtons.find((button) => (
        button.dataset.landingAction === panel
      ))
      ?? enterLibraryButton;
  }

  activeLandingPanel = panel;
  landingPanel.dataset.open = String(Boolean(panel));
  landingPanel.toggleAttribute('inert', !panel);
  landingPanel.setAttribute('aria-hidden', String(!panel));
  landingPanelActionButtons.forEach((button) => {
    button.setAttribute(
      'aria-expanded',
      String(button.dataset.landingAction === panel),
    );
  });

  if (!panel) {
    delete landingPanel.dataset.panel;
    landingPanelInvoker = null;
    return;
  }

  landingPanel.dataset.panel = panel;
  if (panel === 'appearance') {
    landingAppearanceMount.append(settingsOptions);
    resetAppearanceFormState();
  }
};

const getCurrentAnchor = () => spreads[spreadIndex]?.[0]?.startOffset ?? 0;

const getBookLength = (book: Book) => getBookParagraphs(book)
  .reduce((length, paragraph) => length + paragraph.length + 1, 0);

function updateReaderNavigation() {
  const firstPage = spreadIndex * 2 + 1;
  const lastPage = Math.min(firstPage + 1, pages.length);
  const [left, right] = spreads[spreadIndex];
  const visibleEnd = Math.max(left.endOffset, right.endOffset);
  const bookLength = Math.max(getBookLength(activeBook), 1);
  const percent = !paginationInProgress && spreadIndex === spreads.length - 1
    ? 100
    : Math.min(99, Math.round(visibleEnd / bookLength * 100));
  const bookmarked = (readerBookmarks[activeBook.id] ?? []).some((anchor) => (
    anchor >= left.startOffset && anchor < visibleEnd
  ));
  const pageRange = firstPage === lastPage ? `${firstPage}` : `${firstPage}–${lastPage}`;

  readerTitle.textContent = activeBook.title;
  progressChapter.textContent = activeBook.chapterTitle ?? activeBook.title;
  progressSlider.max = String(Math.max(spreads.length - 1, 0));
  progressSlider.value = String(Math.min(spreadIndex, spreads.length - 1));
  progressSlider.disabled = paginationInProgress || spreads.length <= 1;
  progressSlider.setAttribute(
    'aria-valuetext',
    paginationInProgress
      ? `${percent}%，第 ${pageRange} 页，余下书页正在整理`
      : `${percent}%，第 ${pageRange} 页，共 ${pages.length} 页`,
  );
  progressLabel.textContent = paginationInProgress
    ? `${percent}% · ${pageRange} · 整理中`
    : `${percent}% · ${pageRange} / ${pages.length}`;
  bookmarkButton.setAttribute('aria-pressed', String(bookmarked));
  const bookmarkLabel = bookmarked ? '移除当前书签' : '添加当前书签';
  bookmarkButton.setAttribute('aria-label', bookmarkLabel);
  bookmarkButton.title = bookmarkLabel;
}

const scheduleReaderControlsHide = () => {
  window.clearTimeout(controlsTimer);
  if (
    mode !== 'reading'
    || activePanel
    || readerChrome.some((chrome) => (
      chrome.matches(':hover') || chrome.contains(document.activeElement)
    ))
  ) {
    return;
  }

  controlsTimer = window.setTimeout(() => {
    readerView.dataset.controls = 'quiet';
  }, 3200);
};

const setReaderControls = (visible: boolean, persistent = false) => {
  window.clearTimeout(controlsTimer);
  if (
    !visible
    && document.activeElement instanceof Node
    && readerChrome.some((chrome) => chrome.contains(document.activeElement))
  ) {
    readerView.focus({ preventScroll: true });
  }
  readerView.dataset.controls = visible ? 'visible' : 'quiet';
  if (visible && !persistent) {
    scheduleReaderControlsHide();
  }
};

const createReaderPanelItem = (
  title: string,
  detail: string,
  anchor: number,
) => {
  const button = document.createElement('button');

  button.className = 'reader-panel-item';
  button.append(
    createTextElement('strong', '', title),
    createTextElement('span', '', detail),
  );
  button.addEventListener('click', () => jumpToAnchor(anchor));
  return button;
};

const renderContents = () => {
  const list = document.createElement('div');
  const chapterTitle = activeBook.chapterTitle ?? activeBook.title;
  const anchors = readerBookmarks[activeBook.id] ?? [];

  list.className = 'reader-panel-list';
  list.append(createReaderPanelItem(chapterTitle, '回到本章开头', 0));
  list.append(createTextElement('h3', 'reader-panel-section-title', '书签'));
  anchors.forEach((anchor) => {
    const pageIndex = pages.findIndex((page) => (
      page.endOffset > anchor || page.startOffset === anchor
    ));
    const resolvedPage = pages[Math.max(pageIndex, 0)];
    const excerpt = resolvedPage?.paragraphs.join(' ').slice(0, 54) ?? '';

    list.append(createReaderPanelItem(
      `第 ${Math.max(pageIndex + 1, 1)} 页`,
      excerpt || '已保存的阅读位置',
      anchor,
    ));
  });

  if (!anchors.length) {
    list.append(createTextElement('p', 'reader-panel-empty', '保存的书签会出现在这里。'));
  }
  contentsList.replaceChildren(list);
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
      ?? panelActionButtons.find((button) => button.dataset.readerAction === panel)
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : readerView);

    panelInvoker = invoker;
  }
  activePanel = panel;
  readerPanel.dataset.open = String(Boolean(panel));
  readerPanel.toggleAttribute('inert', !panel);
  readerPanel.setAttribute('aria-hidden', String(!panel));
  panelActionButtons.forEach((button) => {
    button.setAttribute('aria-expanded', String(button.dataset.readerAction === panel));
  });

  if (!panel) {
    delete readerPanel.dataset.panel;
    panelInvoker = null;
    scheduleReaderControlsHide();
    return;
  }

  setReaderControls(true, true);
  readerPanel.dataset.panel = panel;
  readerPanelTitle.textContent = panel === 'progress'
    ? '阅读进度'
    : panel === 'contents'
      ? '目录与书签'
      : '阅读显示';
  if (panel === 'contents') {
    renderContents();
  } else if (panel === 'appearance') {
    readerAppearanceMount.append(settingsOptions);
    resetAppearanceFormState();
  }
  requestAnimationFrame(() => {
    const firstItem = panel === 'appearance'
      ? fontFamilyInput
      : panel === 'progress'
        ? progressSlider
        : readerPanel.querySelector<HTMLButtonElement>('.reader-panel-item');

    (firstItem ?? queryRequired<HTMLButtonElement>('[data-reader-panel-close]')).focus();
  });
};

const jumpToAnchor = (anchor: number) => {
  if (paginationInProgress) {
    showToast('书页仍在整理，请稍候');
    return;
  }

  spreadIndex = findSpreadForAnchor(pages, anchor);
  renderSpread();
  saveCurrentProgress();
  setReaderPanel(null);
  setReaderControls(true);
};

const toggleBookmark = () => {
  const anchor = getCurrentAnchor();
  const anchors = readerBookmarks[activeBook.id] ?? [];
  const [left, right] = spreads[spreadIndex];
  const rangeEnd = Math.max(left.endOffset, right.endOffset);
  const visibleBookmark = anchors.find((item) => item >= left.startOffset && item < rangeEnd);
  const exists = typeof visibleBookmark === 'number';

  readerBookmarks[activeBook.id] = exists
    ? anchors.filter((item) => item !== visibleBookmark)
    : [...anchors, anchor].sort((left, right) => left - right);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(readerBookmarks));
  updateReaderNavigation();
  if (activePanel === 'contents') {
    renderContents();
  }
  showToast(exists ? '已移除书签' : '已加入书签');
};

const getBookParagraphs = (book: Book) => book.paragraphs ?? paragraphStream;

const createReadingPage = (
  book: Book,
  segments: TextSegment[],
): ReadingPage => {
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  const page: ReadingPage = {
    runningTitle: book.title,
    paragraphs: segments.map((segment) => segment.text),
    startOffset: firstSegment?.startOffset ?? 0,
    endOffset: lastSegment
      ? lastSegment.startOffset + lastSegment.text.length
      : firstSegment?.startOffset ?? 0,
  };

  return page;
};

const pageFits = (page: ReadingPage) => {
  mountPage(paginationMeasure, page, 88);
  const pageInner = queryRequired<HTMLElement>('.page-inner', paginationMeasure);
  const pageBody = queryRequired<HTMLElement>('.page-body', paginationMeasure);
  const pageNumber = queryRequired<HTMLElement>('.page-number', paginationMeasure);
  const bodyBottom = pageBody.offsetTop + pageBody.offsetHeight;

  return bodyBottom <= pageNumber.offsetTop - 20
    && pageInner.scrollHeight <= pageInner.clientHeight + 1;
};

const getLayoutSignature = () => {
  return [
    window.innerWidth,
    window.innerHeight,
    readerSurface.clientWidth,
    readerSurface.clientHeight,
    appearance.fontFamily,
    appearance.fontSize,
  ].join(':');
};

const paginateBook = async (
  book: Book,
  generation: number,
  revision: number,
  onPage?: (page: ReadingPage, pageIndex: number) => void,
) => {
  const nextPages: ReadingPage[] = [];
  const segmentPages = await paginateTextSegments({
    segments: createTextSegments(getBookParagraphs(book)),
    fits: (segments) => pageFits(
      createReadingPage(book, [...segments]),
    ),
    isCancelled: () => (
      generation !== paginationGeneration
      || revision !== layoutRevision
    ),
    onPage: (segments, pageIndex) => {
      const page = createReadingPage(book, [...segments]);

      nextPages.push(page);
      onPage?.(page, pageIndex);
    },
  });

  if (!segmentPages) {
    return null;
  }
  return nextPages.length ? nextPages : [emptyPage()];
};

const findSpreadForAnchor = (nextPages: ReadingPage[], anchor: number) => {
  const pageIndex = nextPages.findIndex((page) => (
    page.endOffset > anchor || page.startOffset === anchor
  ));
  const resolvedPageIndex = pageIndex >= 0 ? pageIndex : Math.max(nextPages.length - 1, 0);

  return Math.floor(resolvedPageIndex / 2);
};

const saveCurrentProgress = () => {
  const anchor = spreads[spreadIndex]?.[0]?.startOffset;

  if (typeof anchor !== 'number') {
    return;
  }

  readingProgress[activeBook.id] = anchor;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(readingProgress));
};

const preparePagination = async (
  book: Book,
  anchor: number,
  onPreviewReady?: () => void,
) => {
  const generation = ++paginationGeneration;
  const revision = layoutRevision;
  const layoutSignature = getLayoutSignature();
  const cacheKey = `${book.id}:${layoutSignature}`;
  const previewPages: ReadingPage[] = [];
  const previewSpreads: Array<[ReadingPage, ReadingPage]> = [];
  let completed = false;

  paginationInProgress = true;
  pendingDirection = null;
  readerSurface.classList.add('is-reflowing');
  bookCopy.setAttribute('aria-busy', 'true');
  pageBackButton.disabled = true;
  pageForwardButton.disabled = true;
  pageBackZone.disabled = true;
  pageForwardZone.disabled = true;
  readerStatus.textContent = '正在整理书页';

  try {
    await document.fonts.ready;
    await nextFrame();
    const cachedPages = paginationCache.get(cacheKey);
    if (cachedPages) {
      paginationCache.delete(cacheKey);
      paginationCache.set(cacheKey, cachedPages);
    }
    const nextPages = cachedPages ?? await paginateBook(
      book,
      generation,
      revision,
      anchor === 0
        ? (page, pageIndex) => {
            previewPages.push(page);
            if (pageIndex % 2 === 1) {
              previewSpreads.push([
                previewPages[pageIndex - 1],
                previewPages[pageIndex],
              ]);
              pages = previewPages;
              spreads = previewSpreads;
              spreadIndex = Math.min(spreadIndex, spreads.length - 1);
              if (!turnInProgress) {
                renderSpread();
              }
              if (previewPages.length === 2) {
                onPreviewReady?.();
              }
            }
          }
        : undefined,
    );

    if (
      !nextPages
      || generation !== paginationGeneration
      || revision !== layoutRevision
      || activeBook.id !== book.id
      || layoutSignature !== getLayoutSignature()
    ) {
      return false;
    }

    paginationCache.set(cacheKey, nextPages);
    while (paginationCache.size > MAX_PAGINATION_CACHE_ENTRIES) {
      const oldestKey = paginationCache.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }
      paginationCache.delete(oldestKey);
    }
    pages = nextPages;
    spreads = pairPages(nextPages);
    spreadIndex = findSpreadForAnchor(nextPages, anchor);
    renderSpread();
    saveCurrentProgress();
    readerStatus.textContent = `已排为 ${nextPages.length} 页`;
    completed = true;
    return true;
  } catch {
    readerStatus.textContent = '整理书页失败';
    return false;
  } finally {
    if (generation === paginationGeneration) {
      paginationInProgress = false;
      readerSurface.classList.remove('is-reflowing');
      bookCopy.removeAttribute('aria-busy');
      if (!completed) {
        renderSpread();
      }
    }

    if (pendingLayout && mode === 'reading') {
      void repaginateActiveBook();
    }
  }
};

const repaginateActiveBook = async () => {
  if (mode !== 'reading' || paginationInProgress) {
    pendingLayout = true;
    return;
  }

  pendingLayout = false;
  const anchor = spreads[spreadIndex]?.[0]?.startOffset ?? 0;

  await preparePagination(activeBook, anchor);
};

const markLayoutStale = () => {
  layoutRevision += 1;
  pendingLayout = true;
  activeAnimations.forEach((animation) => animation.finish());
};

const requestRepagination = () => {
  observedLayoutSignature = getLayoutSignature();
  markLayoutStale();

  if (!turnInProgress && !paginationInProgress && mode === 'reading') {
    void repaginateActiveBook();
  }
};

const showToast = (
  message: string,
  action?: { label: string; run: () => void | Promise<void> },
) => {
  window.clearTimeout(toastTimer);
  toastMessage.textContent = message;
  toastActionButton.hidden = !action;
  toastActionButton.textContent = action?.label ?? '';
  toastActionButton.onclick = action
    ? () => {
        window.clearTimeout(toastTimer);
        toast.classList.remove('is-visible');
        toastActionButton.hidden = true;
        toastActionButton.onclick = null;
        void Promise.resolve(action.run()).catch(() => {
          showToast('操作没有完成，请再试一次');
        });
      }
    : null;
  toast.classList.toggle('has-action', Boolean(action));
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!toast.classList.contains('is-visible')) {
        toastMessage.textContent = '';
        toastActionButton.hidden = true;
        toastActionButton.onclick = null;
      }
    }, 220);
  }, action ? 8000 : 2400);
};

const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
    audioMaster = audioContext.createGain();
    audioMaster.gain.value = soundEnabled ? 1 : 0;
    audioMaster.connect(audioContext.destination);

    const sampleCount = Math.ceil(audioContext.sampleRate * 0.56);
    noiseBuffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);

    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
  }

  return audioContext;
};

const primeAudio = () => {
  if (!soundEnabled) {
    return;
  }

  const context = getAudioContext();
  if (context.state === 'suspended') {
    void context.resume();
  }
};

const noiseBurst = (
  delay: number,
  duration: number,
  frequency: number,
  volume: number,
  pan = 0,
) => {
  if (!soundEnabled) {
    return;
  }

  const context = getAudioContext();
  const master = audioMaster;

  if (!master || !noiseBuffer) {
    return;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const panner = context.createStereoPanner();
  const start = context.currentTime + delay;

  source.buffer = noiseBuffer;
  source.playbackRate.value = 0.94 + Math.random() * 0.12;
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = 0.72;
  panner.pan.value = pan;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.025, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(panner).connect(master);
  source.start(start, 0, duration);
  source.stop(start + duration);
};

const playBookSound = () => {
  noiseBurst(0, 0.24, 840, 0.025, -0.12);
  noiseBurst(0.18, 0.11, 390, 0.014, -0.04);
};

const playPageSound = (direction: Direction) => {
  const pan = direction === 'forward' ? 0.08 : -0.08;
  noiseBurst(0, 0.09, 2350, 0.016, -pan);
  noiseBurst(0.07, 0.43, 1850, 0.032, pan);
  noiseBurst(0.43, 0.12, 760, 0.012, pan);
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
};

const enterLibrary = () => {
  if (mode !== 'landing' || enterLibraryButton.classList.contains('is-entering')) {
    return;
  }

  setLandingPanel(null, { restoreFocus: false });
  enterLibraryButton.classList.add('is-entering');
  landingView.classList.add('is-leaving');
  const duration = reducedMotion.matches ? 120 : 460;

  window.setTimeout(() => {
    stopThinkingOrb();
    setMode('library');
    enterLibraryButton.classList.remove('is-entering');
    landingView.classList.remove('is-leaving');
    const firstBook = bookHotspots.querySelector<HTMLButtonElement>('[data-book-id]');

    firstBook?.focus({ preventScroll: true });
  }, duration);
};

const prepareTransitionBook = (book: Book) => {
  transitionTitle.textContent = book.title;
  transitionBook.style.setProperty('--active-book-color', book.color);
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
  const target = readerSurface.getBoundingClientRect();
  const scaleX = target.width / (bookWidth * 2);
  const scaleY = target.height / bookHeight;

  return {
    scaleX,
    scaleY,
    translateX: bookWidth * scaleX / 2,
  };
};

const openBook = async (book: Book, trigger: HTMLButtonElement) => {
  if (mode !== 'library') {
    return;
  }

  activeBook = book;
  activeTrigger = trigger;
  closePending = false;
  pendingDirection = null;
  setMode('opening');
  showToast('正在整理书页…');
  const anchor = readingProgress[book.id] ?? 0;
  let notifyPreviewReady: () => void = () => undefined;
  const previewReady = new Promise<boolean>((resolve) => {
    notifyPreviewReady = () => resolve(true);
  });
  const paginationPromise = preparePagination(book, anchor, notifyPreviewReady);
  const readablePromise = anchor === 0
    ? Promise.race([previewReady, paginationPromise])
    : paginationPromise;
  prepareTransitionBook(book);
  const frame = positionTransitionBook();
  const start = trigger.getBoundingClientRect();
  const translateX = start.left + start.width / 2 - (frame.left + frame.width / 2);
  const translateY = start.top + start.height / 2 - (frame.top + frame.height / 2);
  const scaleX = Math.max(start.width / frame.width, 0.08);
  const scaleY = Math.max(start.height / frame.height, 0.12);
  const readerTarget = getReaderExpansion(frame.width, frame.height);
  const duration = reducedMotion.matches ? 150 : 620;

  playBookSound();
  playPageSound('forward');

  const timing: KeyframeAnimationOptions = {
    duration,
    easing: 'cubic-bezier(.2,.78,.2,1)',
    fill: 'both',
  };
  const bookAnimation = transitionBook.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          {
            transform: `translate3d(${translateX}px, ${translateY}px, 0)
              scale(${scaleX}, ${scaleY}) rotateY(-8deg)`,
            opacity: 0.78,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(.98) rotateY(0)',
            opacity: 1,
            offset: 0.36,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1.06) rotateY(0)',
            opacity: 1,
            offset: 0.56,
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
          { transform: 'rotateY(0deg)', offset: 0.24 },
          { transform: 'rotateY(-158deg)', offset: 0.62 },
          { transform: 'rotateY(-166deg)' },
        ],
    timing,
  );
  const readerAnimation = readerView.animate(
    reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'scale(.95)' },
          { opacity: 0, transform: 'scale(.96)', offset: 0.56 },
          { opacity: 1, transform: 'scale(1)' },
        ],
    timing,
  );
  const animations = [bookAnimation, coverAnimation, readerAnimation];

  activeAnimations = animations;
  let [ready] = await Promise.all([
    readablePromise,
    ...animations.map((animation) => animation.finished.catch((): void => undefined)),
  ]);
  activeAnimations = [];

  if (ready && !paginationInProgress) {
    ready = await paginationPromise;
  }

  if (
    shell.dataset.mode === 'opening'
    && activeBook.id === book.id
    && pendingLayout
  ) {
    await paginationPromise;
    pendingLayout = false;
    showToast('正在适配新的窗口尺寸…');
    ready = await preparePagination(book, anchor);
  }

  if (!ready || shell.dataset.mode !== 'opening' || activeBook.id !== book.id) {
    animations.forEach((animation) => animation.cancel());
    transitionBook.classList.remove('is-visible');
    if (shell.dataset.mode === 'opening') {
      setMode('library');
      showToast('暂时无法打开这本书');
    }
    return;
  }

  setMode('reading');
  animations.forEach((animation) => animation.cancel());
  transitionBook.classList.remove('is-visible');
  const firstPage = spreadIndex * 2 + 1;
  const lastPage = Math.min(firstPage + 1, pages.length);

  readerStatus.textContent = `已打开《${book.title}》，第 ${firstPage} 至 ${lastPage} 页`;
  lastOpenedBookId = book.id;
  localStorage.setItem(LAST_BOOK_KEY, book.id);
  updateCurrentBookEntry();
  setReaderControls(true);
  readerView.focus({ preventScroll: true });

  if (paginationInProgress) {
    showToast('第一页已就绪，余下书页继续整理');
    void paginationPromise.then((success) => {
      if (
        !success
        && mode === 'reading'
        && activeBook.id === book.id
        && !pendingLayout
        && !paginationInProgress
      ) {
        showToast('余下书页没有整理完成');
      }
    });
  }

  if (closePending) {
    closePending = false;
    void closeBook();
  }
};

const closeBook = async () => {
  if (mode === 'opening') {
    paginationGeneration += 1;
    paginationInProgress = false;
    pendingLayout = false;
    activeAnimations.forEach((animation) => animation.cancel());
    activeAnimations = [];
    readerSurface.classList.remove('is-reflowing');
    bookCopy.removeAttribute('aria-busy');
    transitionBook.classList.remove('is-visible');
    setMode('library');
    showToast('已取消打开');
    if (activeTrigger?.isConnected) {
      activeTrigger.focus({ preventScroll: true });
    }
    return;
  }

  if (turnInProgress) {
    closePending = true;
    return;
  }

  if (mode !== 'reading' || !activeTrigger) {
    return;
  }

  paginationGeneration += 1;
  paginationInProgress = false;
  pendingLayout = false;
  readerSurface.classList.remove('is-reflowing');
  bookCopy.removeAttribute('aria-busy');
  setReaderPanel(null, { restoreFocus: false });
  setReaderControls(false);
  saveCurrentProgress();
  setMode('closing');
  prepareTransitionBook(activeBook);
  const frame = positionTransitionBook();
  const destination = activeTrigger.getBoundingClientRect();
  const translateX = destination.left + destination.width / 2
    - (frame.left + frame.width / 2);
  const translateY = destination.top + destination.height / 2
    - (frame.top + frame.height / 2);
  const scaleX = Math.max(destination.width / frame.width, 0.08);
  const scaleY = Math.max(destination.height / frame.height, 0.12);
  const readerTarget = getReaderExpansion(frame.width, frame.height);
  const duration = reducedMotion.matches ? 150 : 520;

  playPageSound('backward');
  window.setTimeout(playBookSound, duration * 0.42);

  const timing: KeyframeAnimationOptions = {
    duration,
    easing: 'cubic-bezier(.24,.72,.2,1)',
    fill: 'both',
  };
  const bookAnimation = transitionBook.animate(
    reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }]
      : [
          {
            transform: `translate3d(${readerTarget.translateX}px, 0, 0)
              scale(${readerTarget.scaleX}, ${readerTarget.scaleY})`,
            opacity: 0,
          },
          {
            transform: `translate3d(${readerTarget.translateX}px, 0, 0)
              scale(${readerTarget.scaleX}, ${readerTarget.scaleY})`,
            opacity: 1,
            offset: 0.22,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1.06)',
            opacity: 1,
            offset: 0.46,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(.98)',
            opacity: 1,
            offset: 0.62,
          },
          {
            transform: `translate3d(${translateX}px, ${translateY}px, 0)
              scale(${scaleX}, ${scaleY}) rotateY(-8deg)`,
            opacity: 0.72,
          },
        ],
    timing,
  );
  const coverAnimation = transitionCover.animate(
    reducedMotion.matches
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: 'rotateY(-166deg)' },
          { transform: 'rotateY(-166deg)', offset: 0.24 },
          { transform: 'rotateY(-158deg)', offset: 0.36 },
          { transform: 'rotateY(0deg)', offset: 0.68 },
          { transform: 'rotateY(0deg)' },
        ],
    timing,
  );
  const readerAnimation = readerView.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(.985)', offset: 0.3 },
          { opacity: 0, transform: 'scale(.96)', offset: 0.62 },
          { opacity: 0, transform: 'scale(.94)' },
        ],
    timing,
  );
  const libraryAnimation = libraryView.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 1 }]
      : [
          { opacity: 0 },
          { opacity: 1 },
        ],
    timing,
  );
  const animations = [bookAnimation, coverAnimation, readerAnimation, libraryAnimation];

  activeAnimations = animations;
  await Promise.all(animations.map((animation) =>
    animation.finished.catch((): void => undefined)));
  activeAnimations = [];
  setMode('library');
  animations.forEach((animation) => animation.cancel());
  transitionBook.classList.remove('is-visible');
  readerStatus.textContent = '';
  closePending = false;
  pendingDirection = null;
  updateCurrentBookEntry();
  if (activeTrigger.isConnected) {
    activeTrigger.focus({ preventScroll: true });
  }
};

const finishPageTurn = () => {
  bookCopy.removeAttribute('aria-busy');
  turnInProgress = false;

  if (closePending) {
    closePending = false;
    pendingDirection = null;
    void closeBook();
    return;
  }

  if (pendingLayout) {
    pendingDirection = null;
    void repaginateActiveBook();
    return;
  }

  const nextDirection = pendingDirection;
  pendingDirection = null;
  if (nextDirection) {
    void turnPage(nextDirection);
  }
};

const turnPage = async (direction: Direction) => {
  if (mode !== 'reading') {
    return;
  }

  if (turnInProgress) {
    pendingDirection = direction;
    return;
  }

  const nextIndex = spreadIndex + (direction === 'forward' ? 1 : -1);

  if (nextIndex < 0 || nextIndex >= spreads.length) {
    showToast(
      direction === 'forward' && paginationInProgress
        ? '下一页仍在整理'
        : direction === 'forward'
          ? '这一章读完了'
          : '已经是第一页',
    );
    return;
  }

  turnInProgress = true;
  const duration = reducedMotion.matches ? 140 : 300;
  const isForward = direction === 'forward';
  const [currentLeft, currentRight] = spreads[spreadIndex];
  const [targetLeft, targetRight] = spreads[nextIndex];
  const currentFirstPage = spreadIndex * 2 + 1;
  const targetFirstPage = nextIndex * 2 + 1;

  bookCopy.setAttribute('aria-busy', 'true');
  playPageSound(direction);

  if (reducedMotion.matches) {
    spreadIndex = nextIndex;
    renderSpread();
    saveCurrentProgress();
    readerStatus.textContent = `已翻到第 ${targetFirstPage} 至 ${Math.min(
      targetFirstPage + 1,
      pages.length,
    )} 页`;
    const fade = bookCopy.animate([{ opacity: 0.45 }, { opacity: 1 }], {
      duration,
      easing: 'ease-out',
    });
    activeAnimations = [fade];
    await fade.finished.catch((): void => undefined);
    activeAnimations = [];
    fade.cancel();
    setReaderControls(true);
    finishPageTurn();
    return;
  }

  turnFront.className = `turn-face turn-front ${isForward ? 'face-right' : 'face-left'}`;
  turnBack.className = `turn-face turn-back ${isForward ? 'face-left' : 'face-right'}`;
  mountPage(
    turnFront,
    isForward ? currentRight : currentLeft,
    isForward ? currentFirstPage + 1 : currentFirstPage,
  );
  mountPage(
    turnBack,
    isForward ? targetLeft : targetRight,
    isForward ? targetFirstPage : targetFirstPage + 1,
  );

  if (isForward) {
    mountReadingPage(rightPage, targetRight, targetFirstPage + 1);
  } else {
    mountReadingPage(leftPage, targetLeft, targetFirstPage);
  }

  turnSheet.classList.toggle('is-backward', !isForward);
  turnSheet.classList.add('is-visible');
  await nextFrame();

  const animation = turnSheet.animate(
    isForward
      ? [
          {
            transform: 'perspective(1800px) rotateY(0deg) scaleX(1)',
          },
          {
            transform: 'perspective(1800px) rotateY(-22deg) scaleX(.985)',
            offset: 0.18,
          },
          {
            transform: 'perspective(1800px) rotateY(-92deg) scaleX(.78)',
            offset: 0.52,
          },
          {
            transform: 'perspective(1800px) rotateY(-160deg) scaleX(.985)',
            offset: 0.82,
          },
          {
            transform: 'perspective(1800px) rotateY(-179deg) scaleX(1)',
          },
        ]
      : [
          {
            transform: 'perspective(1800px) rotateY(0deg) scaleX(1)',
          },
          {
            transform: 'perspective(1800px) rotateY(22deg) scaleX(.985)',
            offset: 0.18,
          },
          {
            transform: 'perspective(1800px) rotateY(92deg) scaleX(.78)',
            offset: 0.52,
          },
          {
            transform: 'perspective(1800px) rotateY(160deg) scaleX(.985)',
            offset: 0.82,
          },
          {
            transform: 'perspective(1800px) rotateY(179deg) scaleX(1)',
          },
        ],
    {
      duration,
      easing: 'cubic-bezier(.3,.72,.18,1)',
      fill: 'both',
    },
  );

  activeAnimations = [animation];
  await animation.finished.catch((): void => undefined);
  activeAnimations = [];
  spreadIndex = nextIndex;
  renderSpread();
  saveCurrentProgress();
  readerStatus.textContent = `已翻到第 ${targetFirstPage} 至 ${Math.min(
    targetFirstPage + 1,
    pages.length,
  )} 页`;
  animation.cancel();
  turnSheet.classList.remove('is-visible');
  setReaderControls(true);
  finishPageTurn();
};

const toBookMetadata = (book: ImportedBookRecord): ImportedBookMetadata => ({
  id: book.id,
  title: book.title,
  author: book.author,
  color: book.color,
  chapterTitle: book.chapterTitle,
  imported: true,
  createdAt: book.createdAt,
});

const getBookSummaryById = (bookId: string): Book | undefined => (
  books.find((book) => book.id === bookId)
  ?? importedBooks.find((book) => book.id === bookId)
);

const setLibraryLens = (open: boolean) => {
  libraryView.classList.toggle('is-managing', open);
  libraryLens.classList.toggle('is-open', open);
  libraryLens.toggleAttribute('inert', !open);
  libraryLens.setAttribute('aria-hidden', String(!open));
  libraryOpenButton.setAttribute('aria-expanded', String(open));
  libraryTagLabel.textContent = open ? '完成' : '管理';
  bookHotspots.inert = open;
  bookHotspots.setAttribute('aria-hidden', String(open));
  outlookSwitch.inert = open;
  outlookSwitch.setAttribute('aria-hidden', String(open));
  if (open) {
    renderLibraryLens();
    requestAnimationFrame(() => librarySearch.focus());
  } else {
    librarySearch.value = '';
    libraryOpenButton.focus({ preventScroll: true });
  }
};

const openBookSummary = async (book: Book, trigger: HTMLButtonElement) => {
  if (mode !== 'library') {
    return;
  }

  const requestRevision = ++openRequestRevision;

  setLibraryLens(false);
  loadingBookId = book.id;
  try {
    let readableBook = book;

    if (book.imported && !book.paragraphs) {
      showToast(`正在取出《${book.title}》…`);
      const cachedBook = loadedBookCache.get(book.id);

      readableBook = cachedBook ?? await loadImportedBook(book.id);
      if (cachedBook) {
        loadedBookCache.delete(book.id);
        loadedBookCache.set(book.id, cachedBook);
      } else {
        loadedBookCache.set(book.id, readableBook);
        while (loadedBookCache.size > MAX_LOADED_BOOK_CACHE_ENTRIES) {
          const oldestId = loadedBookCache.keys().next().value as string | undefined;

          if (!oldestId) {
            break;
          }
          loadedBookCache.delete(oldestId);
        }
      }
    }

    if (requestRevision !== openRequestRevision || mode !== 'library') {
      return;
    }

    loadingBookId = null;
    const shelfTrigger = bookHotspots.querySelector<HTMLButtonElement>(
      `[data-book-id="${CSS.escape(book.id)}"]`,
    );
    const transitionTrigger = shelfTrigger
      ?? (libraryLens.contains(trigger) ? libraryOpenButton : trigger);

    await openBook(readableBook, transitionTrigger);
  } catch (error) {
    if (requestRevision !== openRequestRevision) {
      return;
    }
    const message = error instanceof Error ? error.message : '暂时无法打开这本书';

    showToast(message);
  } finally {
    if (requestRevision === openRequestRevision) {
      loadingBookId = null;
    }
  }
};

const bindBookButton = (button: HTMLButtonElement, book: Book) => {
  button.title = `${book.title} · ${book.author}`;
  button.addEventListener('pointerdown', primeAudio);
  button.addEventListener('click', () => void openBookSummary(book, button));
};

const renderImportedBooks = () => {
  const fragment = document.createDocumentFragment();

  importedBooks.slice(-4).forEach((book, index) => {
    const button = document.createElement('button');
    const title = document.createElement('span');
    const author = document.createElement('span');
    const position = importedBookPositions[index];

    if (!position) {
      return;
    }

    button.className = 'imported-book book-spine';
    button.dataset.bookId = book.id;
    button.dataset.slot = String(index + 1);
    button.setAttribute('aria-label', `打开《${book.title}》`);
    button.style.setProperty('--book-color', book.color);
    button.style.setProperty('--x', `${position[0]}%`);
    button.style.setProperty('--y', `${position[1]}%`);
    button.style.setProperty('--w', `${position[2]}%`);
    button.style.setProperty('--h', `${position[3]}%`);
    title.className = 'book-spine-title';
    title.textContent = book.title;
    author.className = 'book-spine-author';
    author.textContent = book.author;
    button.append(title, author);
    bindBookButton(button, book);
    fragment.append(button);
  });

  importedBookList.replaceChildren(fragment);
  importedBookList.classList.toggle('has-books', importedBooks.length > 0);
  updateCurrentBookEntry();
};

const renderLibraryLens = () => {
  const query = librarySearch.value.trim().toLocaleLowerCase();
  const managedBooks: Book[] = [
    ...importedBooks.slice().sort((left, right) => right.createdAt - left.createdAt),
    ...books,
  ];
  const visibleBooks = managedBooks.filter((book) => (
    !query
    || book.title.toLocaleLowerCase().includes(query)
    || book.author.toLocaleLowerCase().includes(query)
  ));
  const fragment = document.createDocumentFragment();

  visibleBooks.forEach((book) => {
      const card = document.createElement('article');
      const spine = document.createElement('span');
      const openButton = document.createElement('button');
      const metadata = document.createElement('span');
      const actions = document.createElement('div');
      const kind = document.createElement('span');

      card.className = 'library-card';
      card.style.setProperty('--book-color', book.color);
      card.dataset.imported = String(Boolean(book.imported));
      spine.className = 'library-card-spine';
      openButton.className = 'library-card-open';
      openButton.setAttribute('aria-label', `打开《${book.title}》`);
      metadata.className = 'library-card-author';
      metadata.textContent = book.author;
      openButton.append(spine, createTextElement('strong', '', book.title), metadata);
      bindBookButton(openButton, book);
      actions.className = 'library-card-actions';
      kind.textContent = book.imported ? '自有书' : '随书样本';
      actions.append(kind);
      if (book.imported) {
        const removeButton = document.createElement('button');

        removeButton.className = 'library-card-remove';
        removeButton.textContent = '移出';
        removeButton.setAttribute('aria-label', `移出《${book.title}》`);
        removeButton.addEventListener('click', () => removeImportedBook(book.id));
        actions.append(removeButton);
      }
      card.append(openButton, actions);
      fragment.append(card);
    });

  libraryGrid.replaceChildren(fragment);
  libraryCount.textContent = `${managedBooks.length} 本书 · ${importedBooks.length} 本自有`;
  libraryEmpty.hidden = visibleBooks.length > 0;
  libraryEmpty.textContent = '没有找到相符的书。';
};

const renderPendingRemovals = () => {
  const count = pendingRemovals.size;

  removalMessage.textContent = count === 1
    ? '已移出 1 本书'
    : `已移出 ${count} 本书`;
  removalToast.classList.toggle('is-visible', count > 0);
  removalToast.setAttribute('aria-hidden', String(count === 0));
  removalToast.toggleAttribute('inert', count === 0);
};

const undoPendingRemovals = () => {
  window.clearTimeout(removalTimer);
  removalTimer = undefined;
  const restored = [...pendingRemovals.values()];
  const knownIds = new Set(importedBooks.map((book) => book.id));

  pendingRemovals.clear();
  restored.forEach((book) => {
    if (!knownIds.has(book.id)) {
      importedBooks.push(book);
    }
  });
  renderImportedBooks();
  renderLibraryLens();
  updateCurrentBookEntry();
  renderPendingRemovals();
  showToast(restored.length === 1 ? '已恢复这本书' : `已恢复 ${restored.length} 本书`);
};

const commitPendingRemovals = async () => {
  const removals = [...pendingRemovals.entries()];

  removalTimer = undefined;
  pendingRemovals.clear();
  renderPendingRemovals();
  const results = await Promise.allSettled(
    removals.map(([bookId]) => deleteImportedBook(bookId)),
  );
  const failedBooks: ImportedBookMetadata[] = [];
  const deletedIds = new Set<string>();

  results.forEach((result, index) => {
    const [bookId, metadata] = removals[index];

    if (result.status === 'fulfilled') {
      deletedIds.add(bookId);
      loadedBookCache.delete(bookId);
      [...paginationCache.keys()]
        .filter((key) => key.startsWith(`${bookId}:`))
        .forEach((key) => paginationCache.delete(key));
      delete readingProgress[bookId];
      delete readerBookmarks[bookId];
    } else {
      failedBooks.push(metadata);
    }
  });

  if (deletedIds.size) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(readingProgress));
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(readerBookmarks));
    if (deletedIds.has(lastOpenedBookId)) {
      lastOpenedBookId = books[0].id;
      localStorage.setItem(LAST_BOOK_KEY, lastOpenedBookId);
    }
  }

  if (failedBooks.length) {
    const knownIds = new Set(importedBooks.map((book) => book.id));

    failedBooks.forEach((book) => {
      if (!knownIds.has(book.id)) {
        importedBooks.push(book);
      }
    });
    renderImportedBooks();
    renderLibraryLens();
    showToast('有书籍未能移出，已放回书架');
  }
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
  renderImportedBooks();
  renderLibraryLens();
  updateCurrentBookEntry();
  renderPendingRemovals();
  window.clearTimeout(removalTimer);
  removalTimer = window.setTimeout(() => {
    void commitPendingRemovals();
  }, 8000);
};

removalUndoButton.addEventListener('click', undoPendingRemovals);

app.querySelectorAll<HTMLButtonElement>('[data-book-id]').forEach((button) => {
  const book = books.find((item) => item.id === button.dataset.bookId);

  if (book) {
    bindBookButton(button, book);
  }
});

const updateCurrentBookEntry = () => {
  bookHotspots.querySelectorAll<HTMLButtonElement>('[data-book-id]').forEach((button) => {
    const book = getBookSummaryById(button.dataset.bookId ?? '');
    const current = button.dataset.bookId === lastOpenedBookId;

    button.classList.toggle('is-current', current);
    if (book) {
      button.setAttribute(
        'aria-label',
        current ? `继续阅读《${book.title}》` : `打开《${book.title}》`,
      );
    }
  });
};

const matchesImportedBook = async (record: ImportedBookRecord) => {
  const candidates = importedBooks.filter((book) => book.title === record.title);

  for (const candidate of candidates) {
    try {
      const existing = loadedBookCache.get(candidate.id)
        ?? await loadImportedBook(candidate.id);

      if (
        existing.paragraphs?.length === record.paragraphs.length
        && existing.paragraphs.every((paragraph, index) => (
          paragraph === record.paragraphs[index]
        ))
      ) {
        return true;
      }
    } catch {
      // 损坏记录不应阻止用户重新导入一份可读副本。
    }
  }
  return false;
};

const importFiles = async (files: File[]) => {
  const importedIds = new Set<string>();
  const failures: string[] = [];
  let duplicateCount = 0;

  for (const file of files) {
    try {
      const record = await parseImportedBook(file);

      if (await matchesImportedBook(record)) {
        duplicateCount += 1;
        continue;
      }
      await saveImportedBook(record);
      const metadata = toBookMetadata(record);
      const existingIndex = importedBooks.findIndex((book) => book.id === record.id);

      if (existingIndex >= 0) {
        importedBooks[existingIndex] = metadata;
      } else {
        importedBooks.push(metadata);
      }
      importedIds.add(record.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法导入这本书';

      failures.push(`${file.name}：${message}`);
    }
  }

  const importedCount = importedIds.size;

  if (importedCount) {
    renderImportedBooks();
    renderLibraryLens();
  }

  if (failures.length) {
    showToast(`导入 ${importedCount} 本，${failures.length} 本失败`, {
      label: '查看',
      run: () => showToast(failures[0]),
    });
  } else if (importedCount && duplicateCount) {
    showToast(`已导入 ${importedCount} 本，跳过 ${duplicateCount} 本重复书籍`);
  } else if (importedCount) {
    showToast(`已把 ${importedCount} 本书放上书架`);
  } else if (duplicateCount) {
    showToast(duplicateCount === 1 ? '这本书已在书架上' : '这些书已在书架上');
  }
};

importInput.addEventListener('change', () => {
  const files = Array.from(importInput.files ?? []);

  importInput.value = '';
  void importFiles(files);
});

enterLibraryButton.addEventListener('click', enterLibrary);
landingPanelActionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.landingAction;

    if (action === 'background' || action === 'appearance') {
      setLandingPanel(
        activeLandingPanel === action ? null : action,
        { invoker: button },
      );
    }
  });
});
landingSceneButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const sceneIndex = Number(button.dataset.landingSceneIndex);

    if (Number.isInteger(sceneIndex)) {
      setLandingScene(sceneIndex);
    }
  });
});
outlookSwitch.addEventListener('click', () => {
  setOutlookScene(outlookSceneIndex + 1);
});

libraryOpenButton.addEventListener('click', () => {
  setLibraryLens(!libraryLens.classList.contains('is-open'));
});
libraryImportButton.addEventListener('click', () => importInput.click());
queryRequired<HTMLButtonElement>('[data-library-close]').addEventListener('click', () => {
  setLibraryLens(false);
  libraryOpenButton.focus({ preventScroll: true });
});
librarySearch.addEventListener('input', renderLibraryLens);

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

const returnButton = queryRequired<HTMLButtonElement>('[data-return]');
const pageBackButton = queryRequired<HTMLButtonElement>('[data-page-back]');
const pageForwardButton = queryRequired<HTMLButtonElement>('[data-page-forward]');
const pageBackZone = queryRequired<HTMLButtonElement>('[data-page-back-zone]');
const pageForwardZone = queryRequired<HTMLButtonElement>('[data-page-forward-zone]');

returnButton.addEventListener('click', closeBook);
pageBackButton.addEventListener('click', () => turnPage('backward'));
pageForwardButton.addEventListener('click', () => turnPage('forward'));
pageBackZone.addEventListener('click', () => turnPage('backward'));
pageForwardZone.addEventListener('click', () => turnPage('forward'));

readerView.querySelectorAll<HTMLButtonElement>('[data-reader-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.readerAction;

    if (action === 'bookmark') {
      toggleBookmark();
    } else if (
      action === 'progress'
      || action === 'contents'
      || action === 'appearance'
    ) {
      setReaderPanel(
        activePanel === action ? null : action,
        { invoker: button },
      );
    }
  });
});
queryRequired<HTMLButtonElement>('[data-reader-panel-close]').addEventListener('click', () => {
  setReaderPanel(null);
});
progressSlider.addEventListener('input', () => {
  if (paginationInProgress) {
    return;
  }

  spreadIndex = Number(progressSlider.value);
  renderSpread();
  const firstPage = spreadIndex * 2 + 1;
  const lastPage = Math.min(firstPage + 1, pages.length);

  readerStatus.textContent = `已跳到第 ${firstPage} 至 ${lastPage} 页`;
  setReaderControls(true);
});
progressSlider.addEventListener('change', saveCurrentProgress);
readerSurface.addEventListener('click', (event) => {
  if (mode !== 'reading') {
    return;
  }

  const selection = window.getSelection();
  const target = event.target instanceof Element ? event.target : null;
  if (
    selection?.toString().trim()
    || target?.closest('button, input, a')
  ) {
    return;
  }

  setReaderControls(readerView.dataset.controls !== 'visible');
});
readerView.addEventListener('pointermove', (event) => {
  if (mode !== 'reading') {
    return;
  }

  if (event.clientY > window.innerHeight - 112) {
    setReaderControls(true);
  }
});
readerChrome.forEach((chrome) => {
  chrome.addEventListener('pointerenter', () => window.clearTimeout(controlsTimer));
  chrome.addEventListener('pointerleave', scheduleReaderControlsHide);
  chrome.addEventListener('focusin', () => window.clearTimeout(controlsTimer));
  chrome.addEventListener('focusout', () => requestAnimationFrame(() => {
    if (!chrome.contains(document.activeElement)) {
      scheduleReaderControlsHide();
    }
  }));
});

const syncSoundButton = () => {
  const label = soundEnabled ? '纸张声效已开启' : '纸张声效已关闭';

  soundButton.setAttribute('aria-pressed', String(soundEnabled));
  soundButton.setAttribute('aria-label', label);
  soundButton.title = label;
};

soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, String(soundEnabled));
  const context = audioContext;
  const master = audioMaster;

  if (context && master) {
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(soundEnabled ? 1 : 0, now + 0.018);
  }

  syncSoundButton();
  showToast(soundEnabled ? '纸张声效已开启' : '纸张声效已关闭');
  if (soundEnabled) {
    primeAudio();
    noiseBurst(0, 0.08, 1400, 0.009);
  } else if (context?.state === 'running') {
    void context.suspend();
  }
});

const changeFontSize = (step: number) => {
  const nextSize = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, appearance.fontSize + step),
  );

  if (nextSize === appearance.fontSize) {
    return;
  }

  applyAppearance({ ...appearance, fontSize: nextSize });
  requestRepagination();
};

settingsOptions.addEventListener('submit', (event) => {
  event.preventDefault();
  window.clearTimeout(appearanceInputTimer);
  const nextAppearance = readAppearanceForm();

  if (!nextAppearance) {
    return;
  }
  const layoutChanged = nextAppearance.fontFamily !== appearance.fontFamily
    || nextAppearance.fontSize !== appearance.fontSize;

  applyAppearance(nextAppearance);
  appearanceMessage.textContent = '已应用';
  if (layoutChanged) {
    requestRepagination();
  }
});

settingsOptions.addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }
  event.target.removeAttribute('aria-invalid');
  appearanceMessage.textContent = '';
  if (event.target === foregroundInput) {
    event.target.value = event.target.value.toUpperCase();
    updateColorPreview(foregroundInput, 'foreground');
  } else if (event.target === backgroundInput) {
    event.target.value = event.target.value.toUpperCase();
    updateColorPreview(backgroundInput, 'background');
  }

  const appearancePanelOpen = (
    mode === 'landing' && activeLandingPanel === 'appearance'
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
    const layoutChanged = nextAppearance.fontFamily !== appearance.fontFamily
      || nextAppearance.fontSize !== appearance.fontSize;

    applyAppearance(nextAppearance, true, false);
    if (mode === 'reading' && layoutChanged) {
      requestRepagination();
    }
  }, 160);
});

settingsOptions.addEventListener('change', (event) => {
  window.clearTimeout(appearanceInputTimer);
  const nextAppearance = readAppearanceForm();

  if (!nextAppearance) {
    return;
  }
  const layoutChanged = nextAppearance.fontFamily !== appearance.fontFamily
    || nextAppearance.fontSize !== appearance.fontSize;

  applyAppearance(nextAppearance);
  if (mode === 'reading' && layoutChanged) {
    requestRepagination();
  }
});

appearanceResetButton.addEventListener('click', () => {
  const layoutChanged = appearance.fontFamily !== defaultAppearance.fontFamily
    || appearance.fontSize !== defaultAppearance.fontSize;

  applyAppearance({ ...defaultAppearance });
  resetAppearanceFormState();
  appearanceMessage.textContent = '已恢复默认';
  if (layoutChanged) {
    requestRepagination();
  }
});

document.addEventListener('pointerdown', (event) => {
  if (
    activeLandingPanel
    && event.target instanceof Node
    && !landingPanel.contains(event.target)
    && !(event.target instanceof Element && event.target.closest('[data-landing-action]'))
  ) {
    setLandingPanel(null, { restoreFocus: false });
  }
  if (
    activePanel
    && event.target instanceof Node
    && !readerPanel.contains(event.target)
    && !(event.target instanceof Element && event.target.closest('[data-reader-action]'))
  ) {
    setReaderPanel(null, { restoreFocus: false });
  }
});

const handleReaderCommand = (command: ReaderCommand) => {
  if (command === 'open-book') {
    if (mode === 'library') {
      importInput.click();
    } else {
      showToast('请先返回书架，再导入书籍');
    }
    return;
  }

  if (mode !== 'reading') {
    showToast('打开一本书后即可使用这项操作');
    return;
  }

  if (command === 'toggle-bookmark') {
    toggleBookmark();
  } else if (command === 'show-contents') {
    setReaderPanel('contents');
  } else if (command === 'toggle-reader-controls') {
    setReaderControls(readerView.dataset.controls !== 'visible');
  }
};

const unsubscribeReaderCommands = window.yuguang?.onReaderCommand(handleReaderCommand);
window.addEventListener('beforeunload', () => {
  unsubscribeReaderCommands?.();
  stopThinkingOrb();
});

window.addEventListener('keydown', (event) => {
  if (event.metaKey && event.key === ',') {
    if (mode === 'landing') {
      event.preventDefault();
      const invoker = landingPanelActionButtons.find((button) => (
        button.dataset.landingAction === 'appearance'
      ));

      setLandingPanel(
        activeLandingPanel === 'appearance' ? null : 'appearance',
        { invoker },
      );
    } else if (mode === 'reading') {
      event.preventDefault();
      setReaderPanel(
        activePanel === 'appearance' ? null : 'appearance',
        { invoker: settingsTrigger },
      );
    }
    return;
  }

  if (event.metaKey && (event.key === '+' || event.key === '=')) {
    if (mode === 'landing') {
      event.preventDefault();
      setLandingPanel('appearance');
      changeFontSize(1);
    } else if (mode === 'reading') {
      event.preventDefault();
      setReaderPanel('appearance', { invoker: settingsTrigger });
      changeFontSize(1);
    }
    return;
  }

  if (event.metaKey && event.key === '-') {
    if (mode === 'landing') {
      event.preventDefault();
      setLandingPanel('appearance');
      changeFontSize(-1);
    } else if (mode === 'reading') {
      event.preventDefault();
      setReaderPanel('appearance', { invoker: settingsTrigger });
      changeFontSize(-1);
    }
    return;
  }

  if (event.metaKey && event.key === '0') {
    if (
      (mode === 'landing' || mode === 'reading')
      && appearance.fontSize !== defaultAppearance.fontSize
    ) {
      event.preventDefault();
      applyAppearance({ ...appearance, fontSize: defaultAppearance.fontSize });
      requestRepagination();
    }
    return;
  }

  if (event.metaKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (mode === 'library') {
      setLibraryLens(true);
    }
    return;
  }

  if (event.key === 'Tab' && mode === 'reading') {
    setReaderControls(true);
  }

  if (event.key === 'Escape' && activeLandingPanel) {
    event.preventDefault();
    setLandingPanel(null);
    return;
  }

  if (event.key === 'Escape' && libraryLens.classList.contains('is-open')) {
    event.preventDefault();
    setLibraryLens(false);
    libraryOpenButton.focus({ preventScroll: true });
    return;
  }

  if (event.key === 'Escape' && loadingBookId) {
    event.preventDefault();
    openRequestRevision += 1;
    loadingBookId = null;
    showToast('已取消打开');
    return;
  }

  if (event.key === 'Escape' && activePanel) {
    event.preventDefault();
    setReaderPanel(null);
    return;
  }

  if (
    event.key === 'Escape'
    && mode === 'reading'
    && readerView.dataset.controls === 'visible'
  ) {
    event.preventDefault();
    setReaderControls(false);
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

  const target = event.target;
  const isInteractive = target instanceof Element
    && Boolean(target.closest('button, a, input, select, textarea, [contenteditable]'));

  if (isInteractive || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (
    event.key === 'ArrowRight'
    || event.key === 'ArrowDown'
    || event.key === 'PageDown'
    || event.key === ' '
  ) {
    event.preventDefault();
    turnPage('forward');
  } else if (
    event.key === 'ArrowLeft'
    || event.key === 'ArrowUp'
    || event.key === 'PageUp'
  ) {
    event.preventDefault();
    turnPage('backward');
  }
});

const handleLayoutGeometryChange = () => {
  const nextSignature = getLayoutSignature();

  if (nextSignature === observedLayoutSignature) {
    return;
  }
  observedLayoutSignature = nextSignature;
  if (mode !== 'reading' && mode !== 'opening') {
    return;
  }

  markLayoutStale();
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (
      pendingLayout
      && mode === 'reading'
      && !turnInProgress
      && !paginationInProgress
    ) {
      void repaginateActiveBook();
    }
  }, 180);
};

const readerResizeObserver = new ResizeObserver(handleLayoutGeometryChange);
readerResizeObserver.observe(readerSurface);
window.addEventListener('resize', handleLayoutGeometryChange);

appearance = readAppearance();
readingProgress = readProgress();
readerBookmarks = readBookmarks();
soundEnabled = readSoundEnabled();
syncSoundButton();
applyAppearance(appearance, false);
observedLayoutSignature = getLayoutSignature();
setLandingPanel(null, { restoreFocus: false });
setReaderPanel(null, { restoreFocus: false });
setMode('landing');
stopThinkingOrb = createThinkingOrb(thinkingOrbCanvas, reducedMotion);
renderImportedBooks();
renderLibraryLens();
updateCurrentBookEntry();
void loadImportedBookMetadata()
  .then((storedBooks) => {
    importedBooks = storedBooks;
    if (!getBookSummaryById(lastOpenedBookId)) {
      lastOpenedBookId = books[0].id;
      localStorage.setItem(LAST_BOOK_KEY, lastOpenedBookId);
    }
    renderImportedBooks();
    renderLibraryLens();
    updateCurrentBookEntry();
  })
  .catch(() => showToast('本地书架暂时无法读取'));
renderSpread();
