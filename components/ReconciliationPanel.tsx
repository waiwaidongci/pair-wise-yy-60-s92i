'use client';

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Stack,
  Typography
} from '@mui/material';
import {
  CloudDownloadOutlined,
  ExpandLessOutlined,
  ExpandMoreOutlined,
  RefreshOutlined
} from '@mui/icons-material';
import { useCarbonStore, type BatchStatus, type BatchItemStatus } from '@/lib/store';

const batchColor: Record<BatchStatus, 'success' | 'warning' | 'error' | 'default'> = {
  已完成: 'success',
  部分失败: 'warning',
  已失败: 'error',
  处理中: 'default'
};

const itemColor: Record<BatchItemStatus, 'success' | 'warning' | 'error' | 'default'> = {
  已完成: 'success',
  冲突: 'warning',
  失败: 'error',
  待处理: 'default'
};

export default function ReconciliationPanel() {
  const batches = useCarbonStore((s) => s.batches);
  const importBatch = useCarbonStore((s) => s.importBatch);
  const retryBatch = useCarbonStore((s) => s.retryBatch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(batches[0]?.batchNo ?? null);

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await importBatch();
      setExpanded(null);
    } catch {
      setError('导入失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async (batchNo: string) => {
    setBusy(true);
    setError(null);
    try {
      await retryBatch(batchNo);
    } catch {
      setError(`批次 ${batchNo} 重试失败，请稍后再试。`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card elevation={0} variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Box>
            <Typography fontWeight={800} fontSize={14}>外部对账批次</Typography>
            <Typography fontSize={11} color="text.secondary">园区补发读数按批次接入，按外部编号与记录版本匹配；版本落后或单位改变时保留原值并写入发现项，写入失败可按批次号重试，已完成项不重复处理。</Typography>
          </Box>
          <Button size="small" variant="contained" startIcon={<CloudDownloadOutlined />} onClick={handleImport} disabled={busy}>
            导入园区对账批次
          </Button>
        </Stack>
        {busy && <LinearProgress sx={{ mt: 1.5 }} />}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
        {batches.length === 0 && !busy && (
          <Typography fontSize={11.5} color="text.secondary" mt={2}>暂无对账批次。点击右上角「导入园区对账批次」拉取园区补发读数。</Typography>
        )}
        <Stack spacing={1} mt={2}>
          {batches.map((batch) => {
            const failed = batch.status === '已失败' || batch.status === '部分失败';
            const open = expanded === batch.batchNo;
            return (
              <Box key={batch.batchNo} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontSize={12.5} fontWeight={750}>{batch.batchNo}</Typography>
                    <Chip size="small" label={batch.status} color={batchColor[batch.status]} />
                    <Typography fontSize={10.5} color="text.secondary">{batch.source}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={.5} alignItems="center">
                    {failed && (
                      <Button size="small" color="warning" startIcon={<RefreshOutlined />} onClick={() => handleRetry(batch.batchNo)} disabled={busy}>
                        按批次号重试
                      </Button>
                    )}
                    <IconButton size="small" onClick={() => setExpanded(open ? null : batch.batchNo)}>
                      {open ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
                    </IconButton>
                  </Stack>
                </Stack>
                <Typography fontSize={10.5} color="text.secondary" mt={.3}>{new Date(batch.arrivedAt).toLocaleString('zh-CN')}</Typography>
                <Collapse in={open}>
                  <Stack spacing={.5} mt={1}>
                    {batch.items.map((item) => (
                      <Box key={item.externalId} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, bgcolor: '#f7f9f8', borderRadius: .5, px: 1, py: .6 }}>
                        <Box minWidth={0}>
                          <Typography fontSize={11.5} fontWeight={650}>{item.externalId} · V{item.version}</Typography>
                          <Typography fontSize={10.5} color="text.secondary" noWrap>{item.activity} {item.unit}{item.message ? ` · ${item.message}` : ''}</Typography>
                        </Box>
                        <Chip size="small" label={item.status} color={itemColor[item.status]} />
                      </Box>
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
