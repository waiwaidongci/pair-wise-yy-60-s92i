import { NextResponse } from 'next/server';
import { z } from 'zod';

const writeRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  batchNo: z.string().min(1),
  externalId: z.string().min(1),
  externalVersion: z.number().int().nonnegative(),
  activity: z.number(),
  unit: z.string().min(1)
});

type CommittedWrite = {
  idempotencyKey: string;
  recordedAt: string;
};

// 演示环境内存存储：同键重放幂等；“光伏阵列”第一次写入必然 502，可按批次重试。
const committed = new Map<string, CommittedWrite>();

export async function POST(request: Request) {
  const parsed = writeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ accepted: false, error: '请求结构不合法' }, { status: 400 });
  }
  const body = parsed.data;
  const existing = committed.get(body.idempotencyKey);
  if (existing) {
    return NextResponse.json({ accepted: true, idempotent: true, recordedAt: existing.recordedAt });
  }

  const isTransientFailure = body.externalId === 'PARK-PV2' && !body.idempotencyKey.includes('#retry');
  if (isTransientFailure) {
    return NextResponse.json({ accepted: false, error: '网关 502：外部写入服务暂时不可用，请按批次号重试。' }, { status: 502 });
  }

  const recordedAt = new Date().toISOString();
  committed.set(body.idempotencyKey, { idempotencyKey: body.idempotencyKey, recordedAt });
  return NextResponse.json({ accepted: true, idempotent: false, recordedAt });
}
