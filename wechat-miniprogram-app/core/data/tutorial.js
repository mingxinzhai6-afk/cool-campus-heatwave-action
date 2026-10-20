"use strict";
/**
 * 新手引导：指令式分步教学。
 *
 * 每一步给出一条明确指令，并用高亮圈指出该操作的界面位置；
 * 只有完成当前指令才会进入下一步（例如真的放下了一个改造）。
 * 覆盖：选工具 → 放改造 → 看数据 → 图层开关 → 认识右侧任务目标 → 转视角 → 用参谋建议
 *      → 采用建议（在地图上标出 / 自动布置） → 给图书馆设置纳凉时段 → 推进时间 → 看结算。
 * 气泡位置原则：只压在「本步用不到」的区域上，不挡住要求玩家看或点击的界面元素。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TUTORIAL_TRIGGERS = exports.TUTORIAL_STEPS = void 0;
exports.TUTORIAL_STEPS = [
    {
        id: 'welcome',
        title: '欢迎来到清凉校园 👋',
        body: '你是校园里的学生规划志愿者。热浪来袭，你要用有限的预算，为校园里最热、人最多的地块做降温改造。\n' +
            '下面我带你走一遍完整流程，大约 2 分钟。每一步都会有明确的指令，照着做就行。\n' +
            '📌 提示：整个引导主要在左侧面板进行，气泡也都出现在左边——记得查看左侧。',
        /** 气泡停靠在左侧面板下方，不挡住地图 */
        bubbleTarget: '.auto-plan-btn',
        place: 'top',
        /** 第一步：其余界面全部变灰暗，只留引导气泡这一个「小框」亮着 */
        spotlight: '.tut-bubble',
    },
    {
        id: 'pickTool',
        title: '第 1 步 · 选一件工具',
        body: '底部这一排是改造工具。先点「行道树」——它便宜、能遮阴，是新手最稳妥的选择。',
        target: '.dock-tools',
        shape: 'bar',
        /** 气泡挂在左侧面板下方，不挡住地图 */
        bubbleTarget: '.auto-plan-btn',
        place: 'top',
    },
    {
        id: 'placeTool',
        title: '第 2 步 · 把它放到广场上',
        body: '黄色的虚线圈标出了本关重点区域（中心广场）。在圈里的地面上点一下，会弹出一张「效果预览卡」——它提前告诉你这一步能让多少人脱离高暴露。\n' +
            '确认数字不错，再点一下同一块地，就把它放下了。',
        target: '.focus-hint',
        /** 气泡挂在左侧面板下方，不挡住地图 */
        bubbleTarget: '.auto-plan-btn',
        place: 'top',
        tip: '地图太小记得根据右上角提醒，双指放大哟',
    },
    {
        id: 'readMetrics',
        title: '第 3 步 · 看看数字变了没有',
        body: '左侧态势栏会实时更新。重点看两个数：「高暴露」人数有没有下降，「脆弱群体」有没有改善。\n' +
            '留意地图左上角的反馈卡——它会告诉你这一步到底做得好不好。',
        target: '.side.left',
        shape: 'block',
        /** 气泡挂在态势数字面板上方（推进版块位置），不挡住要读的数字与下面的按钮 */
        bubbleTarget: '.metrics-panel',
        /** 看完态势栏后点「下一步」继续 */
        manual: true,
        /** 目标就是整块左栏，允许气泡停在面板上方 */
        bubbleOverlapOk: true,
        place: 'top',
    },
    {
        id: 'layers',
        title: '第 4 步 · 图层板块',
        body: '「图层」的四个开关决定地图上叠加什么信息：「热力」是地表热指数分布，「遮阴」看哪里已经被遮住，「人群」看人在哪里聚集，「脆弱群体」单独标出老人、儿童、户外劳动者和骑手。\n' +
            '「图层」在左侧面板偏下的位置——如果没看到，把面板向下滑一点就能找到。下方色带从凉爽到极热（热指数 20–100）；点任意一个开关试试，规划前先看清谁站在热的地方。',
        target: '.layer-row',
        shape: 'bar',
        /** 气泡挂在图层面板上方，不挡住开关按钮和色带 */
        bubbleTarget: '.layer-panel',
        place: 'top',
    },
    {
        id: 'goals',
        title: '第 5 步 · 认识右侧面板',
        body: '右上角是「任务目标」：本关要达成的验收条目、验收时刻和实时进度都在这里，红色的是核心目标。\n' +
            '往下是「地块详情」：点击任意地块，可以查看它的热指数、人群构成与已建设施。\n' +
            '最下面是「决策记录」，你的每一步选择都会留档。',
        target: '.side.right',
        shape: 'block',
        /** 气泡挂在左侧面板下方，不挡住地图 */
        bubbleTarget: '.auto-plan-btn',
        /** 看完右侧面板后点「下一步」继续 */
        manual: true,
        /** 目标就是整块右栏，允许气泡停在左侧 */
        bubbleOverlapOk: true,
        place: 'top',
    },
    {
        id: 'rotate',
        title: '第 6 步 · 转动视角',
        body: '有些地块会被高楼挡住，点不到。右下角的拖条可以任意角度旋转地图——拖一下试试，被挡住的地块换个角度就能操作了。',
        target: '.view-controls',
        shape: 'bar',
        /** 气泡挂在左侧面板下方，不挡住地图（高亮圈仍指向右下角的拖条） */
        bubbleTarget: '.auto-plan-btn',
        place: 'top',
    },
    {
        id: 'advice',
        title: '第 7 步 · 听听参谋建议',
        body: '不想自己算？点「参谋建议」——它是本地规则推理（不联网、不调用大模型），会按「改善效果 ÷ 造价」给出前三名的点位和理由。',
        /** 黄色提示框只圈住「看看参谋建议」按钮本身 */
        target: '.metrics-advice',
        shape: 'bar',
        /** 气泡挂在按钮上方，按钮保持可见可点 */
        bubbleTarget: '.metrics-advice',
        place: 'top',
    },
    {
        id: 'adviceUse',
        title: '第 8 步 · 采用建议的两种方式',
        body: '每条建议下方的「在地图上标出并采用」会采用该点位：地图上钉一枚红色地标（📍），同时自动拿好对应工具，点两下红钉所在的地块（先预览、再放置）就能放下。\n' +
            '想省事就点底部的「✦ 自动布置方案」——它会按任务目标一次铺好一整套达标方案，不用再手动调整。',
        /** 黄色高亮只圈住「在地图上标出并采用」按钮本身（弹窗里第一条建议的按钮） */
        target: '.advice-list .primary.small',
        shape: 'bar',
        /** 气泡仍挂在弹窗右侧（窄屏自动翻到左侧），不遮住建议列表与两个按钮 */
        bubbleTarget: '.advice-modal',
        place: 'right',
    },
    {
        id: 'venueOpen',
        title: '第 9 步 · 打开图书馆',
        body: '还有一招能直接促进完成任务：地图上的图书馆地块带着这个冰蓝角标，点一下地块（工具还拿在手里的话，再次点击该工具取消）。',
        target: '.venue-pin',
        shape: 'circle',
        /** 气泡挂在左侧面板下方，不挡住地图 */
        bubbleTarget: '.auto-plan-btn',
        place: 'top',
    },
    {
        id: 'venueSet',
        title: '第 10 步 · 设置开放时段',
        body: '在「场馆设置」里勾选开放时段，然后点「保存开放时段」——开放的时段里，学生可以进馆纳凉，场馆周边也会获得舒适度与遮阴加成，高暴露人数会下降。',
        target: '.venue-actions',
        shape: 'bar',
        /** 气泡落在弹窗按钮区的下方，不遮挡「保存开放时段」（也避开上方时段选项） */
        place: 'bottom',
    },
    {
        id: 'advance',
        title: '第 11 步 · 推进时间',
        body: '改造随时都能放，没有回合限制。点「推进到下一时段」，看看人群和热力怎么变化——同一个校园，午后的问题在广场，傍晚就转移到运动场了。',
        target: '.round-card',
        shape: 'block',
        /** 气泡落在版块右侧（推进时间旁边），不遮住版块本身 */
        place: 'right',
    },
    {
        id: 'done',
        title: '引导完成 🎉',
        body: '你已经掌握了完整流程：选工具 → 看预览 → 放置 → 看反馈 → 图层开关 → 认识任务目标 → 转视角 → 参考建议 → 采用建议 → 图书馆纳凉 → 推进时间。\n' +
            '接下来推进到结算，会给出星级和目标达成情况。正式关卡里还要照顾一个特殊要求：脆弱群体的改善幅度不能低于平均——这就是最后一关的主题。',
        /** 气泡同样停靠在左侧面板下方，不挡住地图 */
        bubbleTarget: '.auto-plan-btn',
        place: 'top',
    },
];
/** 每步的完成动作（数组 = 其中任一动作都能完成该步；未列出的步骤靠「下一步」手动推进）。 */
exports.TUTORIAL_TRIGGERS = {
    pickTool: ['toolSelected'],
    placeTool: ['toolPlaced'],
    layers: ['layerToggled'],
    rotate: ['rotated'],
    advice: ['adviceOpened'],
    adviceUse: ['advicePicked', 'advicePlanned', 'adviceClosed'],
    venueOpen: ['venueOpened'],
    venueSet: ['venueConfigured'],
    advance: ['advanced'],
};
