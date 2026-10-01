import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { writeReconItem } from './api';
import {
  Finding,
  ReconBatch,
  ReconItem,
  RETRYABLE_STATUSES,
  TERMINAL_STATUSES,
  PARK_RESEND_BATCH_NO,
  batchIsFinished,
  buildParkResendBatch,
  describeUnitConversion,
  formatTs,
  nextBatchStatus
} from './reconciliation';

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';
export type CarbonRecord = {
  id: string;
  // 外部编号（园区能管平台侧主键），对账按它与记录版本匹配
  externalId: string;
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

export type IssuanceCheck = {
  checked: boolean;
  // 活动数据更新后立即失效
  stale: boolean;
  staleReason?: string;
  reviewedAt?: string;
};

type AppliedWrite = {
  item: ReconItem;
  recordId: string;
  recordedAt: string;
  source: string;
};

type State = {
  records: CarbonRecord[];
  findings: Finding[];
  selectedRecordId: string;
  sampledIds: string[];
  issuanceChecks: Record<string, IssuanceCheck>;
  reconBatches: ReconBatch[];
  findingSeq: number;
  reconBusy: boolean;
  reconMessage: string | null;

  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;
  requestEvidence: (findingId: string) => void;
  closeFinding: (findingId: string) => void;
  reviewFinding: (findingId: string) => void;
  toggleIssuanceCheck: (id: string) => void;
  recheckIssuanceCheck: (id: string) => void;
  reviseValue: (id: string, value: number, reason: string) => void;
  receiveParkResendBatch: () => Promise<void>;
  retryBatch: (batchNo: string) => Promise<void>;
  acknowledgeReconMessage: () => void;
};

const now = () => new Date().toISOString();

const defaultRecords: CarbonRecord[] = [
  { id: 'ACT-0318', externalId: 'PARK-E17', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3 },
  { id: 'ACT-0321', externalId: 'PARK-ST04', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2 },
  { id: 'ACT-0325', externalId: 'PARK-DSL01', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4 },
  { id: 'ACT-0331', externalId: 'PARK-PV2', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1 },
  { id: 'ACT-0337', externalId: 'PARK-NG02', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1 }
];

const defaultFindings: Finding[] = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放', source: '人工核验', needsReview: false, createdAt: '2026-09-20T09:00:00.000Z' },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中', source: '人工核验', needsReview: false, createdAt: '2026-09-21T09:00:00.000Z' },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放', source: '人工核验', needsReview: false, createdAt: '2026-09-22T09:00:00.000Z' }
];

const defaultIssuanceChecks = (): Record<string, IssuanceCheck> => ({
  evidence: { checked: false, stale: false },
  calculation: { checked: true, stale: false },
  revisions: { checked: true, stale: false },
  methodology: { checked: false, stale: false }
});

type PersistedState = Partial<Omit<State, 'records'>> & {
  records?: CarbonRecord[];
  issuanceChecks?: Record<string, IssuanceCheck>;
  // v1 旧结构兼容
  findings?: Finding[];
};

// v1：旧发现项/旧布尔检查项升级，关闭结论失效后仍保留可查
function migratePersisted(persisted: unknown): PersistedState | undefined {
  if (!persisted || typeof persisted !== 'object') return undefined;
  const legacy = persisted as Record<string, unknown>;
  const result: PersistedState = { ...(legacy as PersistedState) };

  if (Array.isArray(result.records)) {
    result.records = result.records.map((record) => (record.externalId ? record : {
      ...record,
      externalId: defaultRecords.find((entry) => entry.id === record.id)?.externalId ?? record.id
    }));
  }
  if (Array.isArray(result.findings)) {
    result.findings = result.findings.map((finding) => ({
      ...finding,
      source: finding.source ?? '人工核验',
      needsReview: finding.needsReview ?? false,
      createdAt: finding.createdAt ?? now()
    }));
  }
  const checks = result.issuanceChecks as unknown;
  if (checks && typeof checks === 'object' && !Array.isArray(checks)) {
    result.issuanceChecks = Object.fromEntries(
      Object.entries(checks as Record<string, unknown>).map(([id, value]) => [
        id,
        typeof value === 'boolean' ? { checked: value, stale: false } : (value as IssuanceCheck)
      ])
    );
  }
  return result;
}

type AttemptResult = {
  outcome: ReconItem;
  write: AppliedWrite | null;
  directFinding: () => Omit<Finding, 'id'> | null;
};

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => {
      // 活动数据更新后的统一级联：旧发现项失效、产生待复核项、签发检查失效
      const applyActivityUpdate = (
        state: State,
        write: AppliedWrite,
        seq: { value: number }
      ): { records: CarbonRecord[]; findings: Finding[]; newFindingIds: string[] } => {
        const { item, recordId, recordedAt, source } = write;
        const target = state.records.find((record) => record.id === recordId);
        if (!target) return { records: state.records, findings: state.findings, newFindingIds: [] };

        const nextId = () => {
          seq.value += 1;
          return `F-${seq.value}`;
        };
        const timestamp = formatTs(recordedAt);
        const updateId = nextId();
        const pct = Math.abs(item.activity - target.activity) / target.activity * 100;

        const newFindings: Finding[] = [
          {
            id: updateId,
            recordId,
            type: '数据更新',
            title: `活动数据已由${source === '手工修订' ? '手工修订' : '外部批次'}更新 · ${target.id}`,
            detail:
              `来源 ${source}：按外部编号 ${item.externalId} 与记录版本 V${target.revision} 匹配，` +
              `活动数据 ${target.activity.toLocaleString()} ${target.unit} → ${item.activity.toLocaleString()} ${item.unit}（${timestamp}）。` +
              `换算依据、排放因子与计算链需重新核验后再确认。${item.note ? ` 外部备注：${item.note}` : ''}`,
            assignee: target.owner,
            due: '10-08',
            status: '开放',
            source,
            needsReview: true,
            createdAt: recordedAt
          }
        ];
        if (pct > 5) {
          newFindings.push({
            id: nextId(),
            recordId,
            type: '异常波动',
            title: `补发读数波动 ${pct.toFixed(1)}% · ${target.id}`,
            detail: `外部补发值 ${item.activity.toLocaleString()} ${item.unit} 与台账值 ${target.activity.toLocaleString()} ${target.unit} 相差 ${pct.toFixed(1)}%，需说明波动原因并重算。`,
            assignee: target.owner,
            due: '10-08',
            status: '开放',
            source,
            needsReview: true,
            createdAt: recordedAt
          });
        }

        const reason = `活动数据更新（${source}，${timestamp}），原核验依据已过期，由 ${updateId} 重算`;
        const findings = [
          ...state.findings.map((finding) => finding.recordId === recordId && finding.status !== '已失效'
            ? { ...finding, status: '已失效' as const, invalidatedAt: recordedAt, invalidatedReason: reason, supersededBy: updateId, needsReview: false }
            : finding),
          ...newFindings
        ];
        const records = state.records.map((record) =>
          record.id === recordId
            ? { ...record, activity: item.activity, revision: Math.max(record.revision, item.externalVersion), status: '复核中' as const }
            : record
        );
        return { records, findings, newFindingIds: newFindings.map((finding) => finding.id) };
      };

      const invalidateChecks = (checks: Record<string, IssuanceCheck>, staleReason: string) =>
        Object.fromEntries(Object.entries(checks).map(([id, check]) => [id, { ...check, stale: true, staleReason }]));

      // 跑完一批对账项后的统一落库
      const settleBatch = (
        batchNo: string,
        batch: ReconBatch,
        results: AttemptResult[]
      ) => {
        set((state) => {
          const seq = { value: state.findingSeq };
          let records = state.records;
          let findings = state.findings;
          let checks = state.issuanceChecks;
          let anyApplied = false;
          const items: ReconItem[] = [];

          for (const result of results) {
            const findingIds: string[] = [];
            const direct = result.directFinding();
            if (direct) {
              seq.value += 1;
              findings = [...findings, { ...direct, id: `F-${seq.value}` }];
              findingIds.push(`F-${seq.value}`);
            }
            if (result.write) {
              const applied = applyActivityUpdate({ ...state, records, findings }, result.write, seq);
              records = applied.records;
              findings = applied.findings;
              findingIds.push(...applied.newFindingIds);
              checks = invalidateChecks(checks, `活动数据更新：批次 ${batchNo} 写入 ${result.write.recordId}（${formatTs(result.write.recordedAt)}），原核验依据已过期`);
              anyApplied = true;
            }
            // 重试时保留该条目此前已登记的发现项
            const priorIds = batch.items.find((entry) => entry.externalId === result.outcome.externalId)?.findingIds ?? [];
            const mergedIds = [...priorIds, ...findingIds].filter((id, index, all) => all.indexOf(id) === index);
            items.push({ ...result.outcome, findingIds: mergedIds.length ? mergedIds : result.outcome.findingIds });
          }

          const settledBatch: ReconBatch = { ...batch, items, status: nextBatchStatus(items) };
          const reconBatches = state.reconBatches.map((entry) => (entry.batchNo === batchNo ? settledBatch : entry));
          const failed = items.filter((item) => item.status === '写入失败').length;
          const applied = items.filter((item) => item.status === '已写入').length;
          const held = items.filter((item) => item.status === '版本落后' || item.status === '单位冲突' || item.status === '无匹配').length;
          const reconMessage = failed > 0
            ? `批次 ${batchNo} 部分失败：${applied} 条已入账，${held} 条原值保留，${failed} 条写入失败，可按批次号重试。`
            : `批次 ${batchNo} 处理完成：${applied} 条已入账${anyApplied ? '，相关发现项与签发检查已失效重算' : ''}${held ? `，${held} 条按规则原值保留` : ''}。`;

          return { records, findings, issuanceChecks: checks, reconBatches, findingSeq: seq.value, reconBusy: false, reconMessage };
        });
      };

      // 调外部写入接口并按外部编号+版本判定落点
      const attemptItem = async (item: ReconItem, batch: ReconBatch, retryKey?: string): Promise<AttemptResult> => {
        const idempotencyKey = retryKey ?? `${batch.batchNo}:${item.externalId}:v${item.externalVersion}`;
        try {
          const response = await writeReconItem({
            idempotencyKey,
            batchNo: batch.batchNo,
            externalId: item.externalId,
            externalVersion: item.externalVersion,
            activity: item.activity,
            unit: item.unit
          });
          if (!response.accepted) throw new Error(response.error ?? '写入被拒绝');
          const recordedAt = response.recordedAt ?? now();
          const match = get().records.find((record) => record.externalId === item.externalId);

          if (!match) {
            const outcome: ReconItem = { ...item, status: '无匹配', attempts: item.attempts + 1, writtenAt: recordedAt };
            return {
              outcome,
              write: null,
              directFinding: () => ({
                recordId: item.externalId,
                type: '外部对账',
                title: `外部编号 ${item.externalId} 无匹配台账记录`,
                detail: item.note ? `${item.note}；批次 ${batch.batchNo} 上报 ${item.activity.toLocaleString()} ${item.unit}（V${item.externalVersion}）。` : `批次 ${batch.batchNo} 上报 ${item.activity.toLocaleString()} ${item.unit}（V${item.externalVersion}）。`,
                conflict: `按外部编号 ${item.externalId} 与记录版本均未匹配到活动数据记录，未入账，需建档或核对编号映射。`,
                assignee: '核验员 · 沈楠',
                due: '10-08',
                status: '开放',
                source: batch.batchNo,
                needsReview: true,
                createdAt: recordedAt
              })
            };
          }

          if (item.externalVersion < match.revision) {
            const outcome: ReconItem = { ...item, status: '版本落后', attempts: item.attempts + 1, matchedRecordId: match.id, writtenAt: recordedAt };
            return {
              outcome,
              write: null,
              directFinding: () => ({
                recordId: match.id,
                type: '外部对账',
                title: `外部版本 V${item.externalVersion} 落后台账 V${match.revision}，原值保留 · ${match.id}`,
                detail: `${item.note ?? '园区补发读数'}；外部上报 ${item.activity.toLocaleString()} ${item.unit}（V${item.externalVersion}），台账为 ${match.activity.toLocaleString()} ${match.unit}（V${match.revision}）。`,
                conflict: `版本落后：按外部编号 ${item.externalId} 匹配到 ${match.id}，但外部 V${item.externalVersion} < 台账 V${match.revision}，判定为旧版本重传，原值保留不回退。`,
                assignee: `${match.owner} · 待复核`,
                due: '10-08',
                status: '开放',
                source: batch.batchNo,
                needsReview: true,
                createdAt: recordedAt
              })
            };
          }

          if (item.unit !== match.unit) {
            const { basis } = describeUnitConversion(item.unit, match.unit, item.activity);
            const outcome: ReconItem = { ...item, status: '单位冲突', attempts: item.attempts + 1, matchedRecordId: match.id, basis, writtenAt: recordedAt };
            return {
              outcome,
              write: null,
              directFinding: () => ({
                recordId: match.id,
                type: '单位不一致',
                title: `外部单位由 ${match.unit} 改为 ${item.unit}，原值保留 · ${match.id}`,
                detail: `${item.note ?? '园区补发读数'}；外部上报 ${item.activity.toLocaleString()} ${item.unit}（V${item.externalVersion}），台账为 ${match.activity.toLocaleString()} ${match.unit}（V${match.revision}）。`,
                conflict: `单位改变：外部编号 ${item.externalId} 的 ${item.unit} 与台账 ${match.unit} 不一致，未自动换算覆盖，原值保留。`,
                basis,
                assignee: `${match.owner} · 待复核`,
                due: '10-08',
                status: '开放',
                source: batch.batchNo,
                needsReview: true,
                createdAt: recordedAt
              })
            };
          }

          const outcome: ReconItem = { ...item, status: '已写入', attempts: item.attempts + 1, matchedRecordId: match.id, writtenAt: recordedAt };
          return { outcome, write: { item, recordId: match.id, recordedAt, source: batch.batchNo }, directFinding: () => null };
        } catch (error) {
          return {
            outcome: { ...item, status: '写入失败', attempts: item.attempts + 1, writeError: error instanceof Error ? error.message : '写入失败' },
            write: null,
            directFinding: () => null
          };
        }
      };

      return {
        records: defaultRecords,
        findings: defaultFindings,
        selectedRecordId: 'ACT-0318',
        sampledIds: ['ACT-0318', 'ACT-0337'],
        issuanceChecks: defaultIssuanceChecks(),
        reconBatches: [],
        findingSeq: 106,
        reconBusy: false,
        reconMessage: null,

        selectRecord: (id) => set({ selectedRecordId: id }),
        toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),
        startCorrection: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '复核中' } : record) })),
        verifyRecord: (id) => set((state) => ({
          records: state.records.map((record) => record.id === id ? { ...record, status: '已核验' } : record),
          findings: state.findings.map((finding) => finding.recordId === id && finding.needsReview ? { ...finding, needsReview: false } : finding)
        })),
        batchVerify: () => set((state) => ({
          records: state.records.map((record) => state.sampledIds.includes(record.id) && record.status !== '需补证' ? { ...record, status: '已核验' } : record),
          findings: state.findings.map((finding) => state.sampledIds.includes(finding.recordId) && finding.needsReview ? { ...finding, needsReview: false } : finding)
        })),
        requestEvidence: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '补证中' } : finding) })),
        closeFinding: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '已关闭', closedAt: now(), needsReview: false } : finding) })),
        reviewFinding: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, needsReview: false } : finding) })),
        toggleIssuanceCheck: (id) => set((state) => {
          const check = state.issuanceChecks[id];
          if (!check || check.stale) return {};
          return { issuanceChecks: { ...state.issuanceChecks, [id]: { ...check, checked: !check.checked } } };
        }),
        recheckIssuanceCheck: (id) => set((state) => ({
          issuanceChecks: { ...state.issuanceChecks, [id]: { ...state.issuanceChecks[id], stale: false, checked: true, reviewedAt: now(), staleReason: undefined } }
        })),
        acknowledgeReconMessage: () => set({ reconMessage: null }),

        reviseValue: (id, value, reason) => set((state) => {
          const target = state.records.find((record) => record.id === id);
          if (!target) return {};
          const virtualItem: ReconItem = { externalId: target.externalId, externalVersion: target.revision + 1, activity: value, unit: target.unit, reportedAt: now(), status: '已写入', attempts: 0, findingIds: [] };
          const seq = { value: state.findingSeq };
          const applied = applyActivityUpdate(state, { item: virtualItem, recordId: id, recordedAt: now(), source: '手工修订' }, seq);
          const staleReason = `活动数据更新：手工修订 ${id}（${reason}），原核验依据已过期`;
          return {
            records: applied.records,
            findings: applied.findings,
            issuanceChecks: invalidateChecks(state.issuanceChecks, staleReason),
            findingSeq: seq.value
          };
        }),

        receiveParkResendBatch: async () => {
          const batchNo = PARK_RESEND_BATCH_NO;
          if (get().reconBatches.some((batch) => batch.batchNo === batchNo)) {
            set({ reconMessage: `批次 ${batchNo} 已接收，完成项不会重复处理；如仍有失败项，请按批次号重试。` });
            return;
          }
          const batch = buildParkResendBatch(now());
          set({ reconBusy: true, reconMessage: null, reconBatches: [batch, ...get().reconBatches] });

          const results = [];
          for (const item of batch.items) {
            // eslint-disable-next-line no-await-in-loop
            results.push(await attemptItem(item, batch));
          }
          settleBatch(batchNo, batch, results);
        },

        retryBatch: async (batchNo) => {
          const batch = get().reconBatches.find((entry) => entry.batchNo === batchNo);
          if (!batch || get().reconBusy) return;
          set({ reconBusy: true, reconMessage: null });

          const results = [];
          for (const item of batch.items) {
            if (!RETRYABLE_STATUSES.includes(item.status)) {
              // 完成项不重复：终态项直接原样带回
              results.push({ item, outcome: item, write: null, directFinding: () => null });
              continue;
            }
            // eslint-disable-next-line no-await-in-loop
            results.push(await attemptItem(item, batch, `${batch.batchNo}:${item.externalId}:v${item.externalVersion}#retry-${item.attempts + 1}`));
          }
          settleBatch(batchNo, batch, results);
        }
      };
    },
    {
      name: 'yy60-carbon-evidence',
      version: 2,
      partialize: (state) => ({
        records: state.records,
        findings: state.findings,
        selectedRecordId: state.selectedRecordId,
        sampledIds: state.sampledIds,
        issuanceChecks: state.issuanceChecks,
        reconBatches: state.reconBatches,
        findingSeq: state.findingSeq
      }),
      migrate: ((persisted: unknown, version: number) => (version < 2 ? migratePersisted(persisted) : persisted)) as never
    }
  )
);

export { batchIsFinished, TERMINAL_STATUSES };
