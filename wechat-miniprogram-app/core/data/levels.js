"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAR_LABEL = exports.LEVELS = exports.WEATHER = void 0;
exports.getLevel = getLevel;
exports.lastHour = lastHour;
exports.WEATHER = {
    normal: { id: 'normal', name: '常规晴热', mult: 1.0, note: '典型夏日，午后地表蓄热明显。', drainBonus: 0, icon: '☀' },
    yellow: { id: 'yellow', name: '高温黄色预警', mult: 1.06, note: '连续高温，体感明显上升。', drainBonus: 0, icon: '🌡' },
    orange: { id: 'orange', name: '高温橙色预警', mult: 1.12, note: '热浪持续，脆弱群体风险显著增大。', drainBonus: 0, icon: '🔥' },
    rain: { id: 'rain', name: '雷阵雨转晴', mult: 0.9, note: '雨后短暂降温，但硬质地面迅速回热。', drainBonus: 3, icon: '🌧' },
};
exports.LEVELS = [
    {
        id: 'l1',
        index: 1,
        name: '正午的中心广场',
        tagline: '先把最晒、人最多的地方管起来',
        story: '中午十二点，中心广场的地砖烫得站不住人，外卖骑手在西门等单，学生穿过广场去餐厅。预算只有 20 万，得花在最值得的地方。',
        lesson: '有限预算下的第一优先级：把改造放在“人多 + 最晒 + 必须停留”的交叉点上。',
        hours: [12, 14],
        startWeather: 'normal',
        budget: 20,
        waterSupply: 4,
        mapId: 'l1',
        unlock: ['tree', 'canopy'],
        focus: [{ x: 5, y: 4, label: '潮汐广场' }],
        goals: [
            { id: 'l1-g1', label: '午后高暴露人数降到 200 人以内', metric: 'popExposed', op: '<=', value: 200, atHour: 14, points: 60, core: true, hint: '高暴露 = 地表热指数 ≥ 72 的地块上、且处于户外的人。' },
            { id: 'l1-g2', label: '午后舒适度指数达到 30', metric: 'comfort', op: '>=', value: 30, atHour: 14, points: 40 },
        ],
        events: [
            {
                id: 'l1-e1', atRound: 0, kind: 'notice', icon: '🌡',
                title: '午后热浪继续',
                body: '气象台提示：午后地表温度继续上升，广场与运动场体感最差。',
                effect: { heatDelta: 4, support: -2, note: '全局热指数 +4' },
            },
        ],
    },
    {
        id: 'l2',
        index: 2,
        name: '热浪橙色预警',
        tagline: '预警升级，硬质地面要动手术',
        story: '橙色预警发布，连续第三天高温。校园里最大片的蓄热体不是草地，而是深色沥青路和大面积广场砖。这一轮解锁浅色反光铺装和透水铺装。',
        lesson: '降温不只是加树：改变大面积硬质下垫面的反射与蒸散，才能从源头削减蓄热。',
        hours: [12, 14, 18],
        startWeather: 'orange',
        budget: 30,
        waterSupply: 8,
        mapId: 'l2',
        unlock: ['tree', 'canopy', 'coolpave', 'pavement'],
        focus: [
            { x: 8, y: 4, label: '雾港广场' },
            { x: 6, y: 4, label: '西侧广场' },
        ],
        goals: [
            { id: 'l2-g1', label: '午后高暴露人数降到 300 人以内', metric: 'popExposed', op: '<=', value: 300, atHour: 14, points: 60, core: true },
            { id: 'l2-g2', label: '午后遮阴覆盖户外人口比例达到 50%', metric: 'shadeCoverage', op: '>=', value: 50, atHour: 14, points: 40 },
        ],
        events: [
            {
                id: 'l2-e1', atRound: 1, kind: 'notice', icon: '📚',
                title: '图书馆开放纳凉时段',
                body: '点击地图上的图书馆，安排开放时段。避暑服务需要在高温时段提前启动。',
            },
        ],
    },
    {
        id: 'l3',
        index: 3,
        name: '傍晚的运动场',
        tagline: '人换了地方，热没换',
        story: '傍晚田径场和田径场边的看台挤满了人。跑道是塑胶、看台是混凝土——白天吸的热，正一股脑放出来。这一轮解锁雾森降温和浅水景观。',
        lesson: '热暴露是“人 × 地点 × 时间”的乘积：同一个校园，午后的问题在广场，傍晚的问题在运动场。',
        hours: [14, 18],
        startWeather: 'yellow',
        budget: 28,
        waterSupply: 6,
        mapId: 'l3',
        unlock: ['tree', 'canopy', 'coolpave', 'pavement', 'mist', 'water'],
        focus: [{ x: 10, y: 11, label: '运动看台' }],
        goals: [
            { id: 'l3-g1', label: '傍晚高暴露人数降到 60 人以内', metric: 'popExposed', op: '<=', value: 60, atHour: 18, points: 60, core: true },
            { id: 'l3-g2', label: '傍晚舒适度指数达到 35', metric: 'comfort', op: '>=', value: 35, atHour: 18, points: 40 },
        ],
        events: [
            {
                id: 'l3-e1', atRound: 0, kind: 'choice', icon: '💧',
                title: '雾森很凉，但很费水',
                body: '后勤提醒：连续高温下校园蓄水池水位偏低，雾森连续开放会明显增加耗水。',
                prompt: '怎么用这轮最有效的降温手段？',
                choices: [
                    {
                        id: 'full',
                        label: '运动场雾森全时段开放',
                        detail: '傍晚体感改善最明显，但耗水偏高。公众支持度 -3。',
                        effect: { support: -3, note: '雾森全时段运行，耗水偏高' },
                    },
                    {
                        id: 'pulse',
                        label: '改为间歇运行 + 增加饮水点',
                        detail: '牺牲一点瞬时降温，换取可持续用水。公众支持度 +5。',
                        effect: { support: 5, note: '雾森间歇运行，用水更克制' },
                    },
                ],
            },
        ],
    },
    {
        id: 'l4',
        index: 4,
        name: '一个都不能少',
        tagline: '最好的方案，也可能漏掉最需要的人',
        story: '橙色预警继续。中心广场已经凉快了不少，但校医院门口、幼儿园接送点、后勤保洁休息点和外卖集散点依然暴晒。这一轮解锁饮水补给点和绿色屋顶。',
        lesson: '公平不是平均：如果脆弱的少数人改善幅度低于平均，方案就没有真正达标。',
        hours: [8, 12, 14, 18],
        startWeather: 'orange',
        budget: 62,
        waterSupply: 16,
        mapId: 'l4',
        unlock: ['tree', 'canopy', 'coolpave', 'pavement', 'mist', 'water', 'station', 'greenroof'],
        focus: [
            { x: 5, y: 10, label: '后勤休息点' },
            { x: 13, y: 3, label: '校医院' },
            { x: 12, y: 4, label: '附属幼儿园' },
            { x: 0, y: 9, label: '外卖集散点' },
        ],
        goals: [
            // 目标值按开局基线标定：公平差开局约 9pp、高暴露约 2100 人，都高于目标，
            // 必须把预算投到脆弱群体集中的地方才压得下来（只跟参谋建议走会漏掉它们）。
            { id: 'l4-g1', label: '午后脆弱群体与学生的暴露差 ≤ 10', metric: 'equityGap', op: '<=', value: 10, atHour: 14, points: 60, core: true, hint: '差值 = 脆弱群体高暴露率 − 学生高暴露率（百分点）。' },
            { id: 'l4-g2', label: '午后高暴露总人数降到 1500 人以内', metric: 'popExposed', op: '<=', value: 1500, atHour: 14, points: 40 },
        ],
        events: [
            {
                id: 'l4-e1', atRound: 1, kind: 'notice', icon: '🔥',
                title: '预警升级',
                body: '气象台把橙色预警维持到傍晚，地表热指数再上一层。',
                effect: { heatDelta: 5, note: '全局热指数 +5' },
            },
            {
                id: 'l4-e2', atRound: 2, kind: 'choice', icon: '🧹',
                title: '保洁休息点只有一份预算',
                body: '后勤保洁、绿化和门岗每天在户外作业 6 小时以上，休息点没有遮阴也没有饮水。同时中心广场还有一处喷雾可以加。',
                prompt: '这一份预算给谁？',
                choices: [
                    {
                        id: 'workers',
                        label: '优先改造后勤休息点',
                        detail: '遮阳棚 + 饮水补给，直接覆盖户外劳动者。公众支持度 +7，公平指数明显改善。',
                        effect: { support: 7, note: '预算投向户外劳动者休息点' },
                    },
                    {
                        id: 'plaza',
                        label: '再给广场加一处喷雾',
                        detail: '中心广场的瞬时降温更好看，人数更多。公众支持度 +3。',
                        effect: { support: 3, note: '预算投向中心广场' },
                    },
                ],
            },
        ],
    },
    {
        id: 'l5',
        index: 5,
        name: '清凉校园 · 沙盒',
        tagline: '预算不设限，自己出一道题',
        story: '预算与工具全部解锁。你可以自由拖动四个时段，观察人群如何在校园里流动，试着设计一套“全天候”的清凉方案。',
        lesson: '真实的校园改造没有标准答案，只有被说清楚的取舍。',
        hours: [8, 12, 14, 18],
        startWeather: 'normal',
        budget: 999,
        waterSupply: 20,
        mapId: 'l5',
        unlock: ['tree', 'canopy', 'coolpave', 'pavement', 'mist', 'water', 'station', 'greenroof'],
        focus: [],
        goals: [],
        events: [],
        sandbox: true,
    },
];
function getLevel(id) {
    var _a;
    return (_a = exports.LEVELS.find((l) => l.id === id)) !== null && _a !== void 0 ? _a : exports.LEVELS[0];
}
/** 关卡最后一个时刻（缺省验收时刻）。 */
function lastHour(level) {
    return level.hours[level.hours.length - 1];
}
exports.STAR_LABEL = {
    0: '未达标',
    1: '合格',
    2: '良好',
    3: '优秀',
};
