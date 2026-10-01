// 外部对账批次领域逻辑：批次结构、按外部编号+记录版本匹配、
// 版本落后/单位改变的原值保留判定、换算依据生成。

export type FindingType =
  | '缺失证据'
  | '单位不一致'
  | '时间范围'
  | '异常波动'
  | '外部对账'
  | '数据更新';

export type FindingStatus = '开放' | '补证中' | '已关闭' | '已失效';

export type Finding = {
  id: string;
  recordId: string;
  type: FindingType;
  title: string;
  detail: string;
  assignee: string;
  due: string;
  status: FindingStatus;
  // 来源：人工核验 / 批次号 / 手工修订
  source: string;
  // 单位换算依据（单位冲突时写入）
  basis?: string;
  // 冲突描述
  conflict?: string;
  // 重算后产生的待复核项
  needsReview: boolean;
  // 失效留痕（关闭结论失效后退出完成度，但仍可查）
  invalidatedAt?: string;
  invalidatedReason?: string;
  supersededBy?: string;
  createdAt: string;
  closedAt?: string;
};

export type ReconItemStatus =
  | '待写入'
  | '写入失败'
  | '已写入'
  | '版本落后'
  | '单位冲突'
  | '无匹配';

export type ReconItemInput = {
  externalId: string;
  externalVersion: number;
  activity: number;
  unit: string;
  reportedAt: string;
  note?: string;
};

export type ReconItem = ReconItemInput & {
  status: ReconItemStatus;
  attempts: number;
  matchedRecordId?: string;
  basis?: string;
  conflict?: string;
  writeError?: string;
  writtenAt?: string;
  findingIds: string[];
};

export type ReconBatchStatus = '处理中' | '部分失败' | '已完成';

export type ReconBatch = {
  batchNo: string;
  source: string;
  receivedAt: string;
  status: ReconBatchStatus;
  items: ReconItem[];
};

// 单位换算规则。仅用于在发现项中写明换算依据；单位改变时不自动覆盖原值。
const conversionRules: Record<string, { factor: number; formula: string }> = {
  'MWh->kWh': { factor: 1000, formula: '1 MWh = 1,000 kWh' },
  'kWh->MWh': { factor: 0.001, formula: '1 kWh = 0.001 MWh' },
  'MWh->GJ': { factor: 3.6, formula: '1 MWh = 3.6 GJ' },
  'GJ->MWh': { factor: 1 / 3.6, formula: '1 GJ = 0.2778 MWh' },
  'kNm3->Nm3': { factor: 1000, formula: '1 kNm3 = 1,000 Nm3' },
  'Nm3->kNm3': { factor: 0.001, formula: '1 Nm3 = 0.001 kNm3' }
};

export function describeUnitConversion(from: string, to: string, value: number): { basis: string; converted: number | null } {
  const rule = conversionRules[`${from}->${to}`];
  if (!rule) {
    return { basis: `换算依据：${from} 与 ${to} 之间缺少已备案的换算规则，无法折算，原值保留待人工确认。`, converted: null };
  }
  const converted = value * rule.factor;
  const rounded = Math.round(converted * 10000) / 10000;
  return {
    basis: `换算依据：${rule.formula}；外部读数 ${value.toLocaleString()} ${from} 折合 ${rounded.toLocaleString()} ${to}（仅作比对，未自动换算入账）。`,
    converted: rounded
  };
}

export const TERMINAL_STATUSES: ReconItemStatus[] = ['已写入', '版本落后', '单位冲突', '无匹配'];
export const RETRYABLE_STATUSES: ReconItemStatus[] = ['待写入', '写入失败'];

export function batchIsFinished(batch: ReconBatch): boolean {
  return batch.items.every((item) => TERMINAL_STATUSES.includes(item.status));
}

export function nextBatchStatus(items: ReconItem[]): ReconBatchStatus {
  if (items.some((item) => item.status === '写入失败')) return '部分失败';
  if (items.every((item) => TERMINAL_STATUSES.includes(item.status))) return '已完成';
  return '处理中';
}

// 园区补发批次（模拟平台推送的外部对账文件）
export const PARK_RESEND_BATCH_NO = 'RCB-20260930-07';

export function buildParkResendBatch(receivedAt: string): ReconBatch {
  const inputs: ReconItemInput[] = [
    { externalId: 'PARK-E17', externalVersion: 3, activity: 431200, unit: 'kWh', reportedAt: '2026-09-29 18:00', note: '电表 E-17 / 四号压缩机组 · 七月读数补发' },
    { externalId: 'PARK-ST04', externalVersion: 1, activity: 2051.0, unit: 'GJ', reportedAt: '2026-09-29 18:00', note: '蒸汽流量计 ST-04 · 旧版本重传' },
    { externalId: 'PARK-NG02', externalVersion: 1, activity: 63400, unit: 'Nm3', reportedAt: '2026-09-29 18:00', note: '天然气流量计 NG-02 · 单位变更' },
    { externalId: 'PARK-WT09', externalVersion: 2, activity: 88.2, unit: 'kNm3', reportedAt: '2026-09-29 18:00', note: '新增水处理计量点 · 台账未建档' },
    { externalId: 'PARK-PV2', externalVersion: 1, activity: 181930, unit: 'kWh', reportedAt: '2026-09-29 18:00', note: '光伏逆变器阵列 PV-2 · 补发读数' }
  ];
  return {
    batchNo: PARK_RESEND_BATCH_NO,
    source: '临港园区能管平台 · 读数补发',
    receivedAt,
    status: '处理中',
    items: inputs.map((item) => ({ ...item, status: '待写入' as const, attempts: 0, findingIds: [] }))
  };
}

export function formatTs(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
