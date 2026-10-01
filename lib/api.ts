import ky from 'ky';
import { evidenceResponseSchema } from './schema';

const client = ky.create({ timeout: 10_000, retry: { limit: 1 } });

export async function fetchEvidence() {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

export async function submitEvidenceCorrection(payload: { recordId: string; value: number; reason: string; actor: string }) {
  const response = await client.post('/api/evidence', { json: payload }).json<{ accepted: boolean; revision: number; recordedAt: string }>();
  return response;
}

export async function writeReconItem(payload: {
  idempotencyKey: string;
  batchNo: string;
  externalId: string;
  externalVersion: number;
  activity: number;
  unit: string;
}) {
  const response = await client.post('/api/reconcile', {
    json: payload,
    retry: { limit: 0 },
    timeout: 8_000
  }).json<{ accepted: boolean; idempotent?: boolean; recordedAt?: string; error?: string }>();
  return response;
}
