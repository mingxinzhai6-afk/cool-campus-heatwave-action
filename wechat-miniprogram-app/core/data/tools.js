"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMFORT_CAP = exports.EVAP_CAP = exports.SHADE_CAP = exports.TOOL_ORDER = exports.TOOLS = void 0;
exports.falloff = falloff;
exports.TOOLS = {
    tree: {
        id: 'tree', name: '行道树', short: '树', color: '#5fae74',
        desc: '补种树冠较大的乡土乔木，形成连续遮阴带。',
        cost: 3, radius: 2.0, shade: 15, evap: 6, comfort: 5, support: 5,
        waterUse: 0.5, drain: 0.5, target: 'ground', unlockAt: 1,
        forIssue: '道路、广场边缘的持续暴晒',
        caveat: '生长需要时间，短期内遮阴有限；需要后期养护与浇水。',
    },
    canopy: {
        id: 'canopy', name: '遮阳棚', short: '棚', color: '#78a9c6',
        desc: '在停留点上方加装遮阳棚，快速形成可坐可等的阴凉。',
        cost: 6, radius: 1.4, shade: 22, evap: 3, comfort: 16, support: 6,
        waterUse: 0, drain: 0, target: 'ground', unlockAt: 1,
        forIssue: '排队、等单、休息等“必须停留”的暴晒点',
        caveat: '覆盖范围小；棚下若无饮水，舒适度提升有限。',
    },
    coolpave: {
        id: 'coolpave', name: '浅色反光铺装', short: '浅', color: '#b7cedd',
        desc: '把深色沥青 / 广场砖换成高反射率浅色材料。',
        cost: 5, radius: 2.2, shade: 0, evap: 8, comfort: 3, support: 3,
        waterUse: 0, drain: 1, target: 'ground', unlockAt: 2,
        forIssue: '大面积硬质地面的整体蓄热',
        caveat: '只降温不遮阴；对行人的体感改善不如成片树荫。',
    },
    pavement: {
        id: 'pavement', name: '透水铺装', short: '透', color: '#9fb8c9',
        desc: '铺设透水砖，配合雨水花园，兼顾降温与雨洪调蓄。',
        cost: 8, radius: 2.2, shade: 0, evap: 9, comfort: 4, support: 5,
        waterUse: 0, drain: 3, target: 'ground', unlockAt: 2,
        forIssue: '硬质路面蓄热 + 暴雨积水双重问题',
        caveat: '造价较高；施工期会影响通行。',
    },
    mist: {
        id: 'mist', name: '雾森降温', short: '雾', color: '#79c7e8',
        desc: '高压微雾，短时间内显著降低体感温度。',
        cost: 7, radius: 1.6, shade: 2, evap: 24, comfort: 12, support: 4,
        waterUse: 3, drain: 0, target: 'ground', unlockAt: 3,
        forIssue: '午后人流密集的高温公共空间',
        caveat: '耗水明显，持续高温缺水的日子要权衡。',
    },
    water: {
        id: 'water', name: '浅水景观', short: '水', color: '#63b6de',
        desc: '浅水池 / 旱溪与坐凳结合，兼顾降温与停留。',
        cost: 12, radius: 2.6, shade: 4, evap: 20, comfort: 18, support: 9,
        waterUse: 2, drain: 1, target: 'ground', unlockAt: 3,
        forIssue: '广场核心区的高强度长时间暴晒',
        caveat: '造价与维护成本都高；需要防溺水与水质管理。',
    },
    station: {
        id: 'station', name: '饮水补给点', short: '饮', color: '#4aa8c9',
        desc: '直饮水 + 遮阴坐凳 + 应急防暑包，优先服务户外作业者。',
        cost: 4, radius: 1.2, shade: 2, evap: 0, comfort: 24, support: 11,
        waterUse: 0.5, drain: 0, target: 'ground', unlockAt: 4,
        forIssue: '保洁、绿化、门岗、骑手的补水与中暑风险',
        caveat: '降温数值不亮眼，但对脆弱群体的实际保护最强。',
    },
    greenroof: {
        id: 'greenroof', name: '绿色屋顶', short: '绿', color: '#6fbf8c',
        desc: '在建筑屋顶做轻型绿化，降低屋顶辐射与顶层室温。',
        cost: 10, radius: 2.0, shade: 5, evap: 14, comfort: 2, support: 4,
        waterUse: 0.5, drain: 2, target: 'building', unlockAt: 4,
        forIssue: '建筑屋顶蓄热向四周与顶层房间放热',
        caveat: '只能放在建筑上；需要结构承载评估与防渗处理。',
    },
};
exports.TOOL_ORDER = ['tree', 'canopy', 'coolpave', 'pavement', 'mist', 'water', 'station', 'greenroof'];
/** 影响权重：距离越近效果越强（中心 1，边缘 0）。 */
function falloff(distance, radius) {
    if (radius <= 0)
        return 0;
    const t = Math.min(1, distance / radius);
    return Math.max(0, 1 - t ** 1.6);
}
/** 单块地表的降温上限，避免堆叠出一个不真实的"冰点"。 */
exports.SHADE_CAP = 40;
exports.EVAP_CAP = 32;
exports.COMFORT_CAP = 100;
