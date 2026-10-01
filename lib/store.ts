import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';
export type CarbonRecord = {
  id: string;
  externalId: string; // 外部编号：与园区对账批次匹配
  externalVersion: number; // 记录版本：外部台账版本号
  source: string;
  activity: number;
  unit: string;
  factor: number;
  factorUnit: string;
  timeRange: string;
  evidenceCount: number;
  anomaly: number;
  owner: string;
  status: RecordStatus;
  revision: number;
};

export type FindingType = '缺失证据' | '单位不一致' | '时间范围' | '异常波动' | '版本落后' | '对账冲突';
export type FindingStatus = '开放' | '补证中' | '已关闭';
export type FindingSourceType = '手工修订' | '外部对账' | '系统';
export type ConflictType = '版本落后' | '单位改变';

export type Finding = {
  id: string;
  recordId: string;
  type: FindingType;
  title: string;
  detail: string;
  assignee: string;
  due: string;
  status: FindingStatus;
  // 失效与对账依据
  invalidated: boolean; // 依据已过期（活动数据被更新）
  invalidationSource?: string; // 失效来源，如批次号
  sourceType: FindingSourceType;
  sourceRef?: string; // 来源引用，如批次号
  conflictType?: ConflictType;
  conversionBasis?: string; // 换算依据，如 "1 MWh = 1000 kWh"
  createdAt: string;
};

// 外部对账批次
export type BatchItemStatus = '待处理' | '已完成' | '冲突' | '失败';
export type ReconciliationBatchItem = {
  externalId: string;
  version: number;
  activity: number;
  unit: string;
  status: BatchItemStatus;
  message?: string;
  findingId?: string;
};
export type BatchStatus = '处理中' | '已完成' | '部分失败' | '已失败';
export type ReconciliationBatch = {
  batchNo: string; // 批次号
  source: string; // 来源，如 园区补发读数
  arrivedAt: string;
  status: BatchStatus;
  items: ReconciliationBatchItem[];
};

// 签发检查：checked 为已确认，stale 为数据更新后需重算
export type IssuanceCheck = { checked: boolean; stale: boolean };

const defaultRecords: CarbonRecord[] = [
  { id: 'ACT-0318', externalId: 'M-0318', externalVersion: 3, source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3 },
  { id: 'ACT-0321', externalId: 'M-0321', externalVersion: 2, source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2 },
  { id: 'ACT-0325', externalId: 'M-0325', externalVersion: 4, source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4 },
  { id: 'ACT-0331', externalId: 'M-0331', externalVersion: 1, source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1 },
  { id: 'ACT-0337', externalId: 'M-0337', externalVersion: 1, source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1 }
];

const now = () => new Date().toISOString();

const defaultFindings: Finding[] = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放', invalidated: false, sourceType: '系统', createdAt: now() },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中', invalidated: false, sourceType: '系统', createdAt: now() },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放', invalidated: false, sourceType: '系统', createdAt: now() }
];

const defaultIssuanceChecks: Record<string, IssuanceCheck> = {
  evidence: { checked: false, stale: false },
  calculation: { checked: true, stale: false },
  revisions: { checked: true, stale: false },
  methodology: { checked: false, stale: false }
};

// 常见单位换算依据（仅用于写入发现项，不自动覆盖原值）
function conversionBasis(fromUnit: string, toUnit: string): string {
  const pair = [fromUnit, toUnit].join('/');
  const table: Record<string, string> = {
    'kWh/MWh': '1 MWh = 1000 kWh',
    'MWh/kWh': '1 MWh = 1000 kWh',
    'GJ/MJ': '1 GJ = 1000 MJ',
    'MJ/GJ': '1 GJ = 1000 MJ',
    't/kg': '1 t = 1000 kg',
    'kg/t': '1 t = 1000 kg',
    'kNm3/m3': '1 kNm3 = 1000 m³（标况）',
    'm3/kNm3': '1 kNm3 = 1000 m³（标况）'
  };
  return table[pair] ?? `${fromUnit} 与 ${toUnit} 为不同计量单位，需按监测计划换算`;
}

// 处理一个对账批次：按外部编号+版本匹配，版本落后/单位改变保留原值并写发现项，
// 版本更新且单位一致则落地更新并失效旧发现项与签发检查。
// 已完成项跳过（幂等），冲突项重复处理不重建发现项。
function processBatch(
  records: CarbonRecord[],
  findings: Finding[],
  batch: ReconciliationBatch
): { records: CarbonRecord[]; findings: Finding[]; batch: ReconciliationBatch; dataChanged: boolean } {
  let nextRecords = [...records];
  let nextFindings = [...findings];
  let dataChanged = false;

  const items = batch.items.map((item) => {
    if (item.status === '已完成') return item; // 完成项不重复处理

    const record = nextRecords.find((r) => r.externalId === item.externalId);
    if (!record) {
      return { ...item, status: '失败' as BatchItemStatus, message: `未找到外部编号 ${item.externalId} 对应的活动记录` };
    }

    // 版本落后：保留原值，写冲突发现项
    if (item.version < record.externalVersion) {
      const existing = nextFindings.find(
        (f) => f.recordId === record.id && f.sourceRef === batch.batchNo && f.conflictType === '版本落后' && !f.invalidated
      );
      const findingId = existing?.id ?? `F-${batch.batchNo}-${item.externalId}`;
      if (!existing) {
        nextFindings.push({
          id: findingId,
          recordId: record.id,
          type: '版本落后',
          title: `外部上报版本落后：${record.source}`,
          detail: `外部编号 ${item.externalId} 上报版本 V${item.version}，低于当前台账版本 V${record.externalVersion}，原值保留，待核验员确认。`,
          assignee: record.owner,
          due: '',
          status: '开放',
          invalidated: false,
          sourceType: '外部对账',
          sourceRef: batch.batchNo,
          conflictType: '版本落后',
          createdAt: now()
        });
      }
      return { ...item, status: '冲突' as BatchItemStatus, message: `版本落后（V${item.version} < V${record.externalVersion}），原值已保留`, findingId };
    }

    // 单位改变：保留原值，写换算依据与冲突发现项
    if (item.unit !== record.unit) {
      const basis = conversionBasis(record.unit, item.unit);
      const existing = nextFindings.find(
        (f) => f.recordId === record.id && f.sourceRef === batch.batchNo && f.conflictType === '单位改变' && !f.invalidated
      );
      const findingId = existing?.id ?? `F-${batch.batchNo}-${item.externalId}`;
      if (!existing) {
        nextFindings.push({
          id: findingId,
          recordId: record.id,
          type: '对账冲突',
          title: `单位改变：${record.source}`,
          detail: `外部读数 ${item.activity} ${item.unit} 与台账 ${record.activity} ${record.unit} 单位不一致，原值保留。换算依据：${basis}。`,
          assignee: record.owner,
          due: '',
          status: '开放',
          invalidated: false,
          sourceType: '外部对账',
          sourceRef: batch.batchNo,
          conflictType: '单位改变',
          conversionBasis: basis,
          createdAt: now()
        });
      }
      return { ...item, status: '冲突' as BatchItemStatus, message: `单位改变（${record.unit} → ${item.unit}），原值已保留`, findingId };
    }

    // 版本更新且单位一致：落地更新，失效该记录的旧发现项
    if (item.version > record.externalVersion) {
      dataChanged = true;
      nextRecords = nextRecords.map((r) =>
        r.id === record.id
          ? { ...r, activity: item.activity, externalVersion: item.version, revision: r.revision + 1, status: '复核中' as RecordStatus }
          : r
      );
      nextFindings = nextFindings.map((f) =>
        f.recordId === record.id && f.status !== '已关闭' && !f.invalidated
          ? { ...f, invalidated: true, invalidationSource: batch.batchNo }
          : f
      );
      return { ...item, status: '已完成' as BatchItemStatus, message: `已更新至 V${item.version}` };
    }

    // 版本一致、单位一致：无需更新
    return { ...item, status: '已完成' as BatchItemStatus, message: '版本一致，无需更新' };
  });

  const status: BatchStatus = items.every((i) => i.status === '已完成')
    ? '已完成'
    : items.some((i) => i.status === '失败')
      ? '已失败'
      : '部分失败';

  return { records: nextRecords, findings: nextFindings, batch: { ...batch, items, status }, dataChanged };
}

type State = {
  records: CarbonRecord[];
  findings: Finding[];
  batches: ReconciliationBatch[];
  selectedRecordId: string;
  sampledIds: string[];
  issuanceChecks: Record<string, IssuanceCheck>;
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;
  requestEvidence: (findingId: string) => void;
  closeFinding: (findingId: string) => void;
  toggleIssuanceCheck: (id: string) => void;
  reviseValue: (id: string, value: number, reason: string) => void;
  importBatch: () => Promise<void>;
  retryBatch: (batchNo: string) => Promise<void>;
};

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => ({
      records: defaultRecords,
      findings: defaultFindings,
      batches: [],
      selectedRecordId: 'ACT-0318',
      sampledIds: ['ACT-0318', 'ACT-0337'],
      issuanceChecks: defaultIssuanceChecks,
      selectRecord: (id) => set({ selectedRecordId: id }),
      toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),
      startCorrection: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '复核中' } : record) })),
      verifyRecord: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '已核验' } : record) })),
      batchVerify: () => set((state) => ({ records: state.records.map((record) => state.sampledIds.includes(record.id) && record.status !== '需补证' ? { ...record, status: '已核验' } : record) })),
      requestEvidence: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '补证中' } : finding) })),
      closeFinding: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '已关闭' } : finding) })),
      toggleIssuanceCheck: (id) => set((state) => ({
        issuanceChecks: {
          ...state.issuanceChecks,
          [id]: { checked: !state.issuanceChecks[id].checked, stale: false }
        }
      })),
      reviseValue: (id, value, reason) => set((state) => {
        // 活动数据更新：失效该记录的旧发现项，签发检查需重算
        const findings = state.findings.map((f) =>
          f.recordId === id && f.status !== '已关闭' && !f.invalidated
            ? { ...f, invalidated: true, invalidationSource: '手工修订' }
            : f
        );
        return {
          records: state.records.map((record) => record.id === id ? { ...record, activity: value, revision: record.revision + 1, status: '复核中' } : record),
          findings,
          issuanceChecks: Object.fromEntries(Object.entries(state.issuanceChecks).map(([key]) => [key, { checked: false, stale: true }]))
        };
      }),
      importBatch: async () => {
        const response = await fetch('/api/reconciliation');
        const batch = (await response.json()) as ReconciliationBatch;
        // 写入外部台账：首次写入可能失败，失败则批次置为已失败，可按批次号重试
        const write = await fetch('/api/reconciliation/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchNo: batch.batchNo })
        });
        if (!write.ok) {
          set((state) => ({ batches: [{ ...batch, status: '已失败' }, ...state.batches.filter((b) => b.batchNo !== batch.batchNo)] }));
          return;
        }
        set((state) => {
          const { records, findings, batch: processed, dataChanged } = processBatch(state.records, state.findings, batch);
          // 仅当有记录落地更新时，签发检查失效重算
          const issuanceChecks = dataChanged
            ? Object.fromEntries(Object.entries(state.issuanceChecks).map(([key]) => [key, { checked: false, stale: true }]))
            : state.issuanceChecks;
          return { records, findings, issuanceChecks, batches: [processed, ...state.batches.filter((b) => b.batchNo !== batch.batchNo)] };
        });
      },
      retryBatch: async (batchNo) => {
        const state = get();
        const existing = state.batches.find((b) => b.batchNo === batchNo);
        if (!existing) return;
        // 写入外部台账：仅重试未完成项
        const write = await fetch('/api/reconciliation/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchNo: existing.batchNo })
        });
        if (!write.ok) {
          set((s) => ({ batches: s.batches.map((b) => b.batchNo === batchNo ? { ...b, status: '已失败' } : b) }));
          return;
        }
        set((s) => {
          const { records, findings, batch: processed, dataChanged } = processBatch(s.records, s.findings, existing);
          const issuanceChecks = dataChanged
            ? Object.fromEntries(Object.entries(s.issuanceChecks).map(([key]) => [key, { checked: false, stale: true }]))
            : s.issuanceChecks;
          return { records, findings, issuanceChecks, batches: s.batches.map((b) => b.batchNo === batchNo ? processed : b) };
        });
      }
    }),
    { name: 'yy60-carbon-evidence-v2' }
  )
);
