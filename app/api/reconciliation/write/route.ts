import { NextResponse } from 'next/server';

// 模拟外部台账写入。按批次号记录写入次数：首次写入失败（模拟超时），重试成功。
// 生产环境此处为真实外部对账接口；失败后客户端可按批次号重试，已完成项不重复处理。
const writeAttempts = new Map<string, number>();

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { batchNo?: string };
  const batchNo = body.batchNo ?? 'unknown';
  const attempts = (writeAttempts.get(batchNo) ?? 0) + 1;
  writeAttempts.set(batchNo, attempts);

  if (attempts === 1) {
    return NextResponse.json(
      { ok: false, error: '外部台账写入超时，请按批次号重试', batchNo },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, batchNo, recordedAt: new Date().toISOString() });
}
