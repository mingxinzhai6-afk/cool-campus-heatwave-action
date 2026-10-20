"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DANGER_HEAT = exports.HIGH_HEAT = exports.VULNERABLE_GROUPS = exports.GROUP_ORDER = exports.GROUPS = void 0;
exports.GROUPS = {
    students: {
        id: 'students', name: '学生', short: '学', vuln: 1.0, color: '#5b8def',
        vulnerable: false, note: '数量最多，但通常在室内外之间有较多切换，风险相对分散。',
    },
    kids: {
        id: 'kids', name: '儿童', short: '童', vuln: 1.8, color: '#f0a35e',
        vulnerable: true, note: '体温调节能力弱，附属幼儿园与家属区是重点保护对象。',
    },
    elders: {
        id: 'elders', name: '老人', short: '老', vuln: 1.9, color: '#b07be0',
        vulnerable: true, note: '心脑血管风险高，校医院与家属活动点是重点。',
    },
    workers: {
        id: 'workers', name: '户外劳动者', short: '劳', vuln: 1.5, color: '#3fbf9f',
        vulnerable: true, note: '保洁、绿化、门岗、后勤在户外连续作业，最容易被忽视。',
    },
    riders: {
        id: 'riders', name: '外卖骑手', short: '骑', vuln: 1.4, color: '#ef6f6c',
        vulnerable: true, note: '在集散点等单、暴晒，缺少遮阴与饮水补给。',
    },
};
exports.GROUP_ORDER = ['students', 'kids', 'elders', 'workers', 'riders'];
exports.VULNERABLE_GROUPS = ['kids', 'elders', 'workers', 'riders'];
exports.HIGH_HEAT = 72;
exports.DANGER_HEAT = 85;
