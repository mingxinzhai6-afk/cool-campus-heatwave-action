/**
 * 人群分组（原型模拟）。
 *
 * 作品的社会意义核心：热岛效应对不同人群的影响并不相等。
 * 儿童、老人、户外劳动者、外卖骑手在同样地表热指数下承受更高的健康风险，
 * 因此结算指标对脆弱群体赋予更高的权重，并要求“公平指数”达标。
 */
export type GroupId = 'students' | 'kids' | 'elders' | 'workers' | 'riders';

export type Group = {
  id: GroupId;
  name: string;
  short: string;
  /** 脆弱度权重：越大代表同样热度下风险越高。 */
  vuln: number;
  color: string;
  /** 是否为脆弱群体。 */
  vulnerable: boolean;
  note: string;
};

export const GROUPS: Record<GroupId, Group> = {
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

export const GROUP_ORDER: GroupId[] = ['students', 'kids', 'elders', 'workers', 'riders'];
export const VULNERABLE_GROUPS: GroupId[] = ['kids', 'elders', 'workers', 'riders'];

export const HIGH_HEAT = 72;
export const DANGER_HEAT = 85;
