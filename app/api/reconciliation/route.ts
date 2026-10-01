import { NextResponse } from 'next/server';

// 园区补发读数：外部对账批次。
// 包含多种情形：版本更新可落地、版本落后、单位改变、版本一致。
export async function GET() {
  const batch = {
    batchNo: 'BATCH-2026-0930',
    source: '园区能耗监测平台 · 补发读数',
    arrivedAt: new Date().toISOString(),
    status: '处理中' as const,
    items: [
      // M-0318 当前 V3，上报 V4 且单位一致 → 可落地更新
      { externalId: 'M-0318', version: 4, activity: 431200, unit: 'kWh', status: '待处理' as const },
      // M-0321 当前 V2，上报 V2 → 版本一致，无需更新
      { externalId: 'M-0321', version: 2, activity: 2038.4, unit: 'GJ', status: '待处理' as const },
      // M-0325 当前 V4，上报 V3 → 版本落后，保留原值
      { externalId: 'M-0325', version: 3, activity: 1760, unit: 'L', status: '待处理' as const },
      // M-0331 当前 V1，上报 V2 但单位 kWh→MWh → 单位改变，保留原值
      { externalId: 'M-0331', version: 2, activity: 182.46, unit: 'MWh', status: '待处理' as const },
      // M-0337 当前 V1，上报 V1 → 版本一致
      { externalId: 'M-0337', version: 1, activity: 62.8, unit: 'kNm3', status: '待处理' as const }
    ]
  };
  return NextResponse.json(batch);
}
