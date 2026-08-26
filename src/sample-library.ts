import distanceCover from './assets/covers/distance-cover.jpg';
import lakeCover from './assets/covers/lake-cover.jpg';
import lettersCover from './assets/covers/letters-cover.jpg';
import northCover from './assets/covers/north-cover.jpg';
import notesCover from './assets/covers/notes-cover.jpg';
import plantsCover from './assets/covers/plants-cover.jpg';
import routeCover from './assets/covers/route-cover.jpg';
import springCover from './assets/covers/spring-cover.jpg';

export type SampleBook = {
  id: string;
  title: string;
  author: string;
  color: string;
  material?: 'cloth' | 'paper' | 'aged';
  cover?: string;
};

type SamplePage = {
  paragraphs: string[];
};

export const sampleBooks: SampleBook[] = [
  {
    id: 'lake',
    title: '湖边散记',
    author: '林望',
    color: '#5276c7',
    material: 'cloth',
    cover: lakeCover,
  },
  {
    id: 'spring',
    title: '春日庭院',
    author: '许青禾',
    color: '#86b99c',
    material: 'paper',
    cover: springCover,
  },
  {
    id: 'letters',
    title: '薄暮书简',
    author: '周野',
    color: '#ef8b74',
    material: 'aged',
    cover: lettersCover,
  },
  {
    id: 'north',
    title: '北方手札',
    author: '沈舟',
    color: '#273f58',
    material: 'aged',
    cover: northCover,
  },
  {
    id: 'plants',
    title: '寂静植物学',
    author: '简森',
    color: '#5c7f70',
    material: 'cloth',
    cover: plantsCover,
  },
  {
    id: 'route',
    title: '微光航线',
    author: '陈屿',
    color: '#f2d164',
    material: 'paper',
    cover: routeCover,
  },
  {
    id: 'notes',
    title: '月下笔记',
    author: '白榆',
    color: '#5276c7',
    material: 'cloth',
    cover: notesCover,
  },
  {
    id: 'distance',
    title: '远方来信',
    author: '陶然',
    color: '#ef8b74',
    material: 'paper',
    cover: distanceCover,
  },
];

const sourceSpreads: Array<[SamplePage, SamplePage]> = [
  [
    {
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

export const sampleParagraphs = new Map(sampleBooks.map((book, bookIndex) => [
  book.id,
  paragraphStream.filter((_, paragraphIndex) => (
    paragraphIndex % sampleBooks.length === bookIndex
  )),
]));
