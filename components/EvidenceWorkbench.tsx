'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import {
  AccountTreeOutlined,
  AssessmentOutlined,
  CloudUploadOutlined,
  DashboardOutlined,
  FindInPageOutlined,
  MenuOutlined,
  NotificationsNoneOutlined,
  PendingActionsOutlined,
  ReplayOutlined,
  RestoreOutlined,
  ScienceOutlined,
  SyncOutlined,
  TaskAltOutlined
} from '@mui/icons-material';
import { fetchEvidence } from '@/lib/api';
import { useCarbonStore } from '@/lib/store';
import type { Finding } from '@/lib/reconciliation';
import { RETRYABLE_STATUSES, TERMINAL_STATUSES, formatTs } from '@/lib/reconciliation';

const drawerWidth = 232;

type View = 'overview' | 'verify' | 'issuance';

const itemStatusColor = (status: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  if (status === '已写入') return 'success';
  if (status === '写入失败') return 'error';
  if (status === '待写入') return 'info';
  return 'warning';
};

export default function EvidenceWorkbench({ initialView }: { initialView: View }) {
  const [view] = useState<View>(initialView);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [recordFilter, setRecordFilter] = useState('全部');
  const [findingFilter, setFindingFilter] = useState<'待复核' | '开放' | '已失效' | '全部'>('开放');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['carbon-api'], queryFn: fetchEvidence });
  const store = useCarbonStore();
  const selected = store.records.find((record) => record.id === store.selectedRecordId) ?? store.records[0];
  const visibleRecords = useMemo(() => recordFilter === '全部' ? store.records : store.records.filter((record) => record.status === recordFilter), [recordFilter, store.records]);
  const totalReduction = store.records.reduce((total, record) => total + record.activity * record.factor / (record.unit === 'kWh' ? 1000 : record.unit === 'L' ? 1000 : 1), 0);

  const openFindings = store.findings.filter((item) => item.status !== '已关闭' && item.status !== '已失效');
  const invalidatedFindings = store.findings.filter((item) => item.status === '已失效');
  const closedFindings = store.findings.filter((item) => item.status === '已关闭');
  const reviewFindings = store.findings.filter((item) => item.needsReview && item.status !== '已失效');
  const checkEntries = Object.entries(store.issuanceChecks);
  const staleChecks = checkEntries.filter(([, check]) => check.stale);
  const freshChecked = checkEntries.filter(([, check]) => !check.stale && check.checked).length;
  const pendingCount = reviewFindings.length + staleChecks.length;
  const readiness = Math.round(freshChecked / 4 * 70 + (openFindings.length === 0 && reviewFindings.length === 0 ? 30 : 0));
  const allIssuanceChecked = staleChecks.length === 0 && freshChecked === 4 && openFindings.length === 0 && reviewFindings.length === 0;
  const verifiedCount = store.records.filter((record) => record.status === '已核验').length;
  const verifiedPct = Math.round(verifiedCount / store.records.length * 100);

  const pendingByRecord = useMemo(() => new Map(store.records.map((record) => [
    record.id,
    {
      review: reviewFindings.filter((finding) => finding.recordId === record.id),
      invalidated: invalidatedFindings.filter((finding) => finding.recordId === record.id)
    }
  ])), [store.records, reviewFindings, invalidatedFindings]);

  const latestBatch = store.reconBatches[0];

  const nav = [
    { id: 'overview', label: '监测期总览', href: '/', icon: DashboardOutlined },
    { id: 'verify', label: '证据与抽样核验', href: '/verify', icon: FindInPageOutlined },
    { id: 'issuance', label: '签发准备', href: '/issuance', icon: AssessmentOutlined }
  ];

  const staleReasons = Array.from(new Set(staleChecks.map(([, check]) => check.staleReason).filter(Boolean))) as string[];

  const invalidationBanner = pendingCount > 0 && (
    <Alert severity="warning" icon={<PendingActionsOutlined fontSize="inherit" />} sx={{ mb: 2, alignItems: 'center' }}>
      <Typography fontSize={12.5} fontWeight={750}>
        活动数据已更新，{staleChecks.length > 0 ? `${staleChecks.length} 项签发检查已失效` : ''}{staleChecks.length > 0 && reviewFindings.length > 0 ? '，' : ''}{reviewFindings.length > 0 ? `${reviewFindings.length} 个发现项待复核` : ''}，关闭结论已退出完成度。
      </Typography>
      {staleReasons.slice(0, 2).map((reason) => <Typography key={reason} fontSize={11} color="text.secondary" mt={.3}>失效来源：{reason}</Typography>)}
    </Alert>
  );

  const navDrawer = (
    <Box sx={{ width: drawerWidth, bgcolor: '#f8faf9', height: '100%' }}>
      <Box sx={{ p: 2.2, pt: 3 }}>
        <Typography variant="overline" color="text.secondary">当前项目</Typography>
        <Typography fontWeight={800} fontSize={13} mt={.5}>{data?.project.name ?? '临港工业园区能效提升项目'}</Typography>
        <Typography variant="caption" color="text.secondary">{data?.project.id ?? 'CN-ER-2026-041'}</Typography>
      </Box>
      <Divider />
      <List sx={{ px: 1, py: 1.2 }}>
        {nav.map(({ id, label, href, icon: Icon }) => (
          <ListItemButton key={id} component={Link} href={href} selected={view === id} sx={{ borderRadius: 1, mb: .4, '&.Mui-selected': { bgcolor: '#e4f1ec', color: '#12664f' } }}>
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13, fontWeight: view === id ? 750 : 500 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ p: 2, mt: 2 }}>
        <Box sx={{ p: 1.3, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'white' }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}><ScienceOutlined color="primary" fontSize="small" /><Typography fontSize={12} fontWeight={750}>核验状态</Typography></Stack>
          <LinearProgress variant="determinate" value={verifiedPct} sx={{ height: 5, borderRadius: 2 }} />
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>{verifiedPct}% 记录已核验{pendingCount > 0 ? ` · ${pendingCount} 项待复核` : ''}</Typography>
        </Box>
      </Box>
    </Box>
  );

  const renderFinding = (finding: Finding) => {
    const invalidated = finding.status === '已失效';
    return (
      <Box key={finding.id} sx={{ borderTop: '1px solid #edf0ef', py: 1.2, opacity: invalidated ? .85 : 1, bgcolor: finding.needsReview ? '#fff8ef' : invalidated ? '#f5f7f6' : 'transparent' }}>
        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
          <Typography fontSize={12} fontWeight={700}>{finding.title}</Typography>
          {invalidated
            ? <Chip size="small" label="依据已失效" color="default" variant="outlined" />
            : <Chip size="small" label={finding.needsReview ? '待复核' : finding.status} color={finding.status === '已关闭' ? 'success' : finding.status === '补证中' ? 'warning' : finding.needsReview ? 'warning' : 'error'} />}
        </Stack>
        <Typography fontSize={10.5} color="text.secondary" mt={.5}>{finding.detail}</Typography>
        {finding.basis && <Typography fontSize={10.5} sx={{ fontFamily: 'monospace', bgcolor: '#f2f6f4', p: .7, borderRadius: .5, mt: .6 }}>{finding.basis}</Typography>}
        {finding.conflict && <Typography fontSize={10.5} sx={{ color: 'secondary.main', mt: .6 }}>冲突：{finding.conflict}</Typography>}
        <Typography fontSize={10} color="text.secondary" mt={.6}>来源：{finding.source} · {finding.assignee} · 到期 {finding.due}</Typography>
        {invalidated && (
          <Typography fontSize={10} color="text.secondary" mt={.4}>
            失效时间 {finding.invalidatedAt ? formatTs(finding.invalidatedAt) : '-'} · {finding.invalidatedReason}{finding.supersededBy ? `（已由 ${finding.supersededBy} 替代，关闭结论退出完成度，可查）` : ''}
          </Typography>
        )}
        {!invalidated && finding.status !== '已关闭' && (
          <Stack direction="row" spacing={.7} mt={1}>
            <Button size="small" disabled={finding.status === '补证中'} onClick={() => store.requestEvidence(finding.id)}>发起补证</Button>
            <Button size="small" onClick={() => store.closeFinding(finding.id)}>关闭</Button>
            {finding.needsReview && <Button size="small" variant="contained" startIcon={<TaskAltOutlined />} onClick={() => store.reviewFinding(finding.id)}>标记已复核</Button>}
          </Stack>
        )}
      </Box>
    );
  };

  const filteredFindings = useMemo(() => {
    if (findingFilter === '待复核') return store.findings.filter((finding) => finding.needsReview && finding.status !== '已失效');
    if (findingFilter === '开放') return store.findings.filter((finding) => finding.status !== '已关闭' && finding.status !== '已失效');
    if (findingFilter === '已失效') return store.findings.filter((finding) => finding.status === '已失效');
    return store.findings;
  }, [findingFilter, store.findings]);

  const findingTabs = [
    { key: '待复核', count: reviewFindings.length },
    { key: '开放', count: openFindings.length },
    { key: '已失效', count: invalidatedFindings.length },
    { key: '全部', count: store.findings.length }
  ] as const;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: '#173a31', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
        <Toolbar sx={{ minHeight: '62px !important', gap: 1.4 }}>
          <IconButton color="inherit" sx={{ display: { md: 'none' } }} onClick={() => setMobileOpen(true)}><MenuOutlined /></IconButton>
          <Box sx={{ width: 36, height: 36, borderRadius: 1, border: '1px solid #80b6a6', display: 'grid', placeItems: 'center' }}>
            <AccountTreeOutlined fontSize="small" />
          </Box>
          <Box>
            <Typography fontSize={15} fontWeight={800}>碳减排项目监测核验</Typography>
            <Typography fontSize={10} color="#a9c5bc">MRV Evidence & Issuance Readiness</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {pendingCount > 0 && <Chip size="small" icon={<PendingActionsOutlined />} label={`${pendingCount} 项待复核`} sx={{ color: '#ffdda7', borderColor: '#a87935', bgcolor: 'rgba(255,255,255,.05)', '& .MuiChip-icon': { color: '#ffdda7' } }} variant="outlined" />}
          <Chip size="small" label={`${openFindings.length} 项发现开放`} sx={{ color: '#ffdda7', borderColor: '#a87935', bgcolor: 'rgba(255,255,255,.05)' }} variant="outlined" />
          <IconButton color="inherit"><NotificationsNoneOutlined /></IconButton>
          <Avatar sx={{ width: 30, height: 30, bgcolor: '#e1a45d', fontSize: 12 }}>沈</Avatar>
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px', boxSizing: 'border-box', borderRightColor: '#dce4e0' } }}>{navDrawer}</Drawer>
      <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px' } }}>{navDrawer}</Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, bgcolor: '#f2f5f3', pt: '62px' }}>
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1640, mx: 'auto' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={2.4}>
            <Box>
              <Typography variant="overline" color="text.secondary" fontWeight={750}>CN-ER-2026-041 / {data?.summary.period ?? '第三监测期'}</Typography>
              <Typography variant="h5" fontWeight={850} mt={.3}>{view === 'overview' ? '监测期总览' : view === 'verify' ? '证据与抽样核验' : '签发准备'}</Typography>
              <Typography variant="body2" color="text.secondary" mt={.5}>{view === 'overview' ? '汇总活动数据、排放因子、证据完整度和异常波动。' : view === 'verify' ? '按外部编号与记录版本对账，数据更新后发现项和签发门禁即时失效重算。' : '关闭发现项并完成签发前完整性门禁。'}</Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<CloudUploadOutlined />} component={Link} href="/verify">导入监测数据</Button>
              <Button variant="contained" startIcon={<TaskAltOutlined />} disabled={view !== 'issuance' || !allIssuanceChecked}>提交签发准备</Button>
            </Stack>
          </Stack>
          {isLoading && <LinearProgress />}
          {invalidationBanner}

          {view === 'overview' && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 1.4, mb: 2 }}>
                {[
                  { label: '减排量', value: totalReduction.toLocaleString(undefined, { maximumFractionDigits: 0 }), unit: 'tCO₂e', note: '较上期 +6.4%' },
                  { label: '证据完整度', value: `${data?.summary.evidenceRate ?? 92}%`, unit: '', note: reviewFindings.length > 0 ? `${reviewFindings.length} 项补发依据待复核` : '5 份证据待补充' },
                  { label: '开放发现项', value: `${openFindings.length}`, unit: '项', note: invalidatedFindings.length > 0 ? `${invalidatedFindings.length} 项旧结论已失效退出完成度` : '1 项阻塞签发' },
                  { label: '抽样任务', value: `${store.sampledIds.length} / 18`, unit: '', note: staleChecks.length > 0 ? `${staleChecks.length} 项签发检查已失效` : '完成率 67%' }
                ].map((item) => <Card elevation={0} variant="outlined" key={item.label}><CardContent sx={{ p: 1.8, '&:last-child': { pb: 1.8 } }}><Typography variant="caption" color="text.secondary">{item.label}</Typography><Stack direction="row" alignItems="baseline" spacing={.6} mt={.5}><Typography variant="h5" fontWeight={850}>{item.value}</Typography><Typography fontSize={12} color="text.secondary">{item.unit}</Typography></Stack><Typography fontSize={11} color="text.secondary" mt={.7}>{item.note}</Typography></CardContent></Card>)}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.55fr) minmax(300px, .7fr)' }, gap: 1.5 }}>
                <Card elevation={0} variant="outlined">
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1.6 }}>
                    <Box><Typography fontWeight={800} fontSize={14}>活动数据与计算链</Typography><Typography fontSize={11} color="text.secondary">选择记录查看公式、来源证据和修订版本</Typography></Box>
                    <Tabs value={recordFilter} onChange={(_, value) => setRecordFilter(value)} variant="scrollable"><Tab value="全部" label="全部" /><Tab value="待核验" label="待核验" /><Tab value="需补证" label="需补证" /><Tab value="已核验" label="已核验" /></Tabs>
                  </Stack>
                  <Divider />
                  <Box sx={{ overflowX: 'auto' }}>
                    <Box sx={{ minWidth: 840 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1.7fr .9fr .8fr 1fr .7fr .9fr', gap: 1, px: 1.7, py: 1, bgcolor: '#f7f9f8', color: 'text.secondary', fontSize: 11, fontWeight: 750 }}>
                        <span>数据来源</span><span>活动数据</span><span>排放因子</span><span>时间范围</span><span>证据</span><span>状态</span>
                      </Box>
                      {visibleRecords.map((record) => {
                        const pending = pendingByRecord.get(record.id);
                        return (
                          <Box key={record.id} role="button" tabIndex={0} onClick={() => store.selectRecord(record.id)} sx={{ display: 'grid', gridTemplateColumns: '1.7fr .9fr .8fr 1fr .7fr .9fr', gap: 1, px: 1.7, py: 1.25, borderTop: '1px solid #e8ecea', cursor: 'pointer', bgcolor: selected.id === record.id ? '#eff7f3' : 'white', '&:hover': { bgcolor: '#f6faf8' } }}>
                            <Box><Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography><Typography fontSize={10} color="text.secondary">{record.id} · {record.externalId} · {record.owner} · V{record.revision}</Typography></Box>
                            <Box><Typography fontSize={12}>{record.activity.toLocaleString()} {record.unit}</Typography><Typography fontSize={10} color={record.anomaly > 5 ? 'secondary.main' : 'text.secondary'}>异常 {record.anomaly > 0 ? '+' : ''}{record.anomaly}%</Typography></Box>
                            <Typography fontSize={12}>{record.factor} <small>{record.factorUnit}</small></Typography>
                            <Typography fontSize={11}>{record.timeRange}</Typography>
                            <Typography fontSize={12}>{record.evidenceCount} 项</Typography>
                            <Stack spacing={.4}>
                              <Chip size="small" label={record.status} color={record.status === '已核验' ? 'success' : record.status === '需补证' ? 'warning' : 'default'} variant={record.status === '已核验' ? 'filled' : 'outlined'} />
                              {(pending?.review.length ?? 0) > 0 && <Chip size="small" label={`${pending?.review.length} 项待复核`} color="warning" variant="outlined" />}
                              {(pending?.invalidated.length ?? 0) > 0 && <Chip size="small" label="依据已失效" variant="outlined" />}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                </Card>
                <Stack spacing={1.5}>
                  <Card elevation={0} variant="outlined"><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={800} fontSize={14}>计算链展开</Typography><Chip size="small" label={selected.id} /></Stack><Box sx={{ mt: 1.5, p: 1.3, bgcolor: '#f4f7f5', fontFamily: 'monospace', borderRadius: 1, fontSize: 11 }}>
                    <Box>活动数据 = {selected.activity.toLocaleString()} {selected.unit}</Box>
                    <Box mt={.6}>排放因子 = {selected.factor} {selected.factorUnit}</Box>
                    <Box mt={.6}>换算系数 = 0.001</Box>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ color: '#14644f', fontWeight: 800 }}>减排量 = {(selected.activity * selected.factor / 1000).toFixed(2)} tCO₂e</Box>
                  </Box>
                    {pendingByRecord.get(selected.id)?.review.some((finding) => finding.basis) && (
                      <Alert severity="warning" sx={{ mt: 1.2 }} icon={false}><Typography fontSize={10.5}>{pendingByRecord.get(selected.id)?.review.find((finding) => finding.basis)?.basis}</Typography></Alert>
                    )}
                    <Stack direction="row" spacing={1} mt={1.5}><Button size="small" variant="outlined" onClick={() => { setCorrectionOpen(true); setCorrectionValue(String(selected.activity)); }}>修订数据</Button><Button size="small">查看证据</Button></Stack></CardContent></Card>
                  <Card elevation={0} variant="outlined"><CardContent sx={{ pb: 1.2 }}><Typography fontWeight={800} fontSize={14} mb={.6}>核验发现项</Typography>{reviewFindings.slice(0, 2).map((finding) => <Box key={finding.id} sx={{ py: 1, borderTop: '1px solid #edf0ef' }}><Stack direction="row" spacing={1}><Alert severity="warning" sx={{ p: .2, '& .MuiAlert-icon': { mr: .3, fontSize: 17 } }} /><Box><Typography fontSize={12} fontWeight={700}>{finding.title}</Typography><Typography fontSize={10} color="text.secondary" mt={.3}>{finding.source} · {finding.assignee} · 待复核</Typography></Box></Stack></Box>)}{openFindings.filter((finding) => !finding.needsReview).slice(0, 2).map((finding) => <Box key={finding.id} sx={{ py: 1, borderTop: '1px solid #edf0ef' }}><Stack direction="row" spacing={1}><Alert severity={finding.status === '补证中' ? 'warning' : 'error'} sx={{ p: .2, '& .MuiAlert-icon': { mr: .3, fontSize: 17 } }} /><Box><Typography fontSize={12} fontWeight={700}>{finding.title}</Typography><Typography fontSize={10} color="text.secondary" mt={.3}>{finding.assignee} · {finding.due}</Typography></Box></Stack></Box>)}{invalidatedFindings.length > 0 && <Typography fontSize={10.5} color="text.secondary" sx={{ pt: 1, borderTop: '1px solid #edf0ef' }}>{invalidatedFindings.length} 项旧发现项依据已失效，已退出完成度（核验页可查）。</Typography>}</CardContent></Card>
                </Stack>
              </Box>
            </>
          )}

          {view === 'verify' && (
            <Stack spacing={1.5}>
              <Card elevation={0} variant="outlined">
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ p: 1.6 }}>
                  <Box>
                    <Typography fontWeight={800} fontSize={14}>外部对账批次（可恢复）</Typography>
                    <Typography fontSize={11} color="text.secondary">园区补发读数按外部编号与记录版本匹配；版本落后或单位改变保留原值，换算依据与冲突写入发现项。写入失败可按批次号重试，完成项不重复。</Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" startIcon={<SyncOutlined />} disabled={store.reconBusy || Boolean(latestBatch)} onClick={() => void store.receiveParkResendBatch()}>
                      {store.reconBusy ? '对账写入中…' : '接收园区补发批次'}
                    </Button>
                    {latestBatch && (
                      <Tooltip title={latestBatch.items.some((item) => RETRYABLE_STATUSES.includes(item.status)) ? '仅重发失败/待写入条目，终态条目不重复' : '批次无失败项'}>
                        <span>
                          <Button variant="outlined" startIcon={<ReplayOutlined />} disabled={store.reconBusy || !latestBatch.items.some((item) => RETRYABLE_STATUSES.includes(item.status))} onClick={() => void store.retryBatch(latestBatch.batchNo)}>
                            按批次号重试
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </Stack>
                </Stack>
                <Divider />
                {!latestBatch && (
                  <Box sx={{ p: 2.4, textAlign: 'center' }}>
                    <RestoreOutlined color="disabled" sx={{ fontSize: 34 }} />
                    <Typography fontSize={12.5} color="text.secondary" mt={1}>尚未接收外部批次。点击「接收园区补发批次」模拟园区补发七月读数（含版本落后、单位改变、无匹配与写入失败各一条）。</Typography>
                  </Box>
                )}
                {latestBatch && (
                  <Box>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ px: 1.6, py: 1.1, bgcolor: '#f7f9f8' }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Chip size="small" label={latestBatch.batchNo} color="primary" variant="outlined" />
                        <Typography fontSize={11.5} fontWeight={700}>{latestBatch.source}</Typography>
                        <Typography fontSize={10.5} color="text.secondary">接收于 {formatTs(latestBatch.receivedAt)}</Typography>
                      </Stack>
                      <Chip size="small" label={latestBatch.status} color={latestBatch.status === '已完成' ? 'success' : latestBatch.status === '部分失败' ? 'error' : 'info'} />
                    </Stack>
                    {latestBatch.items.map((item) => {
                      const matched = item.matchedRecordId ? store.records.find((record) => record.id === item.matchedRecordId) : undefined;
                      const terminal = TERMINAL_STATUSES.includes(item.status);
                      return (
                        <Box key={`${item.externalId}-v${item.externalVersion}`} sx={{ px: 1.6, py: 1.2, borderTop: '1px solid #edf0ef' }}>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                <Typography fontSize={12.5} fontWeight={750}>{item.externalId}</Typography>
                                <Chip size="small" label={`外部 V${item.externalVersion}`} variant="outlined" />
                                {matched && <Chip size="small" label={`台账 ${matched.id} V${matched.revision}`} variant="outlined" />}
                                <Typography fontSize={11}>{item.activity.toLocaleString()} {item.unit}</Typography>
                              </Stack>
                              <Typography fontSize={10.5} color="text.secondary" mt={.4}>{item.note} · 上报 {item.reportedAt}{item.attempts > 0 ? ` · 尝试 ${item.attempts} 次` : ''}{item.writtenAt ? ` · 写入 ${formatTs(item.writtenAt)}` : ''}</Typography>
                              {item.writeError && <Alert severity="error" sx={{ mt: .7, py: 0 }}><Typography fontSize={10.5}>{item.writeError}</Typography></Alert>}
                              {item.conflict && <Typography fontSize={10.5} sx={{ color: 'secondary.main', mt: .6 }}>冲突：{item.conflict}</Typography>}
                              {item.basis && <Typography fontSize={10.5} sx={{ fontFamily: 'monospace', bgcolor: '#f2f6f4', p: .7, borderRadius: .5, mt: .6 }}>{item.basis}</Typography>}
                              {item.findingIds.length > 0 && <Typography fontSize={10} color="primary.main" mt={.5}>已登记发现项：{item.findingIds.join('、')}</Typography>}
                            </Box>
                            <Chip size="small" label={item.status} color={itemStatusColor(item.status)} variant={terminal ? 'outlined' : 'filled'} />
                          </Stack>
                        </Box>
                      );
                    })}
                  </Box>
                )}
                {store.reconMessage && (
                  <Alert severity={store.reconMessage.includes('失败') ? 'warning' : 'success'} sx={{ m: 1.4, mt: 1 }} onClose={store.acknowledgeReconMessage}>
                    <Typography fontSize={11.5}>{store.reconMessage}</Typography>
                  </Alert>
                )}
              </Card>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 340px' }, gap: 1.5 }}>
                <Card elevation={0} variant="outlined">
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ p: 1.6 }}>
                    <Box><Typography fontWeight={800} fontSize={14}>证据矩阵与抽样任务</Typography><Typography fontSize={11} color="text.secondary">已抽取 {store.sampledIds.length} 条高价值记录</Typography></Box>
                    <Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => useCarbonStore.setState((state) => ({ sampledIds: store.records.filter((item) => Math.abs(item.anomaly) > 5).map((item) => item.id) }))}>按异常抽样</Button><Button variant="contained" onClick={store.batchVerify}>批量核验</Button></Stack>
                  </Stack><Divider />
                  {store.records.map((record) => (
                    <Box key={record.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '22px minmax(210px, 1.3fr) .8fr .8fr .8fr auto' }, alignItems: 'center', gap: 1.2, px: 1.6, py: 1.3, borderTop: '1px solid #edf0ef' }}>
                      <input type="checkbox" checked={store.sampledIds.includes(record.id)} onChange={() => store.toggleSample(record.id)} aria-label={`抽样 ${record.id}`} />
                      <Box>
                        <Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography>
                        <Typography fontSize={10} color="text.secondary">{record.id} · {record.externalId} · 证据 {record.evidenceCount} 份</Typography>
                        <Stack direction="row" spacing={.5} mt={.4}>
                          {(pendingByRecord.get(record.id)?.review.length ?? 0) > 0 && <Chip size="small" label="待复核" color="warning" sx={{ height: 18, fontSize: 10 }} />}
                          {(pendingByRecord.get(record.id)?.invalidated.length ?? 0) > 0 && <Chip size="small" label="依据失效" variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
                        </Stack>
                      </Box>
                      <Box><Typography variant="caption" color="text.secondary">来源</Typography><Typography fontSize={11}>原始计量记录</Typography></Box>
                      <Box><Typography variant="caption" color="text.secondary">单位</Typography><Typography fontSize={11}>{record.unit} / {record.factorUnit}</Typography></Box>
                      <Box><Typography variant="caption" color="text.secondary">时间范围</Typography><Typography fontSize={11}>{record.timeRange.includes('至') ? '已覆盖整期' : '待检查'}</Typography></Box>
                      <Stack direction="row" spacing={.7}><Button size="small" variant="outlined" onClick={() => store.startCorrection(record.id)}>复核</Button><Button size="small" variant="contained" disabled={record.status === '需补证'} onClick={() => store.verifyRecord(record.id)}>通过</Button></Stack>
                    </Box>
                  ))}
                </Card>
                <Stack spacing={1.5}>
                  <Card elevation={0} variant="outlined">
                    <CardContent sx={{ pb: 1 }}>
                      <Typography fontWeight={800} fontSize={14} mb={.8}>发现项闭环</Typography>
                      <Tabs value={findingFilter} onChange={(_, value) => setFindingFilter(value)} variant="fullWidth" sx={{ minHeight: 30, '& .MuiTab-root': { minHeight: 30, fontSize: 10.5, px: .5 } }}>
                        {findingTabs.map((tab) => <Tab key={tab.key} value={tab.key} label={`${tab.key} ${tab.count}`} />)}
                      </Tabs>
                      {filteredFindings.length === 0 && <Typography fontSize={11} color="text.secondary" sx={{ py: 1.6, textAlign: 'center' }}>当前筛选下暂无发现项。</Typography>}
                      {filteredFindings.map(renderFinding)}
                    </CardContent>
                  </Card>
                  <Alert severity="info">活动数据一旦更新，相关发现项与签发检查立即失效重算；关闭结论退出完成度但保留留痕可查。</Alert>
                </Stack>
              </Box>
            </Stack>
          )}

          {view === 'issuance' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 380px' }, gap: 1.5 }}>
              <Card elevation={0} variant="outlined">
                <CardContent>
                  <Typography fontWeight={800} fontSize={14}>签发前完整性检查</Typography>
                  <Typography fontSize={11} color="text.secondary" mb={1.5}>所有门禁项必须确认，开放发现项必须关闭；依据失效的门禁需重新核验。</Typography>
                  {[
                    { id: 'evidence', title: '证据与计算链完整', detail: '活动数据、排放因子、来源证据与修订说明可追溯。' },
                    { id: 'calculation', title: '计算过程复核通过', detail: '单位和换算系数一致，关键公式由核验员确认。' },
                    { id: 'revisions', title: '历史修订未覆盖原始数据', detail: '所有数据均有版本号和修订原因。' },
                    { id: 'methodology', title: '方法学与监测计划匹配', detail: `项目采用 ${data?.project.methodology ?? 'CMS-052-V01'}。` }
                  ].map((item) => {
                    const check = store.issuanceChecks[item.id];
                    return (
                      <Box key={item.id} sx={{ display: 'flex', gap: 1.3, alignItems: 'flex-start', borderTop: '1px solid #edf0ef', py: 1.5, bgcolor: check.stale ? '#fff8ef' : 'transparent', px: 1, borderRadius: .5 }}>
                        <input type="checkbox" checked={check.checked && !check.stale} disabled={check.stale} onChange={() => store.toggleIssuanceCheck(item.id)} style={{ marginTop: 3 }} />
                        <Box sx={{ flex: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography fontSize={12.5} fontWeight={700}>{item.title}</Typography>
                            {check.stale
                              ? <Chip size="small" label="已失效 · 待复核" color="warning" />
                              : check.checked && <Chip size="small" label="已确认" color="success" variant="outlined" />}
                          </Stack>
                          <Typography fontSize={10.5} color="text.secondary" mt={.4}>{item.detail}</Typography>
                          {check.stale && (
                            <Alert severity="warning" sx={{ mt: .8, py: 0 }} icon={<PendingActionsOutlined fontSize="small" />}>
                              <Typography fontSize={10.5}>失效来源：{check.staleReason}{check.reviewedAt ? '' : ''}</Typography>
                            </Alert>
                          )}
                        </Box>
                        {check.stale && <Button size="small" variant="contained" startIcon={<TaskAltOutlined />} onClick={() => store.recheckIssuanceCheck(item.id)}>重新核验</Button>}
                      </Box>
                    );
                  })}
                </CardContent>
              </Card>
              <Stack spacing={1.5}>
                <Card elevation={0} variant="outlined"><CardContent>
                  <Typography fontWeight={800} fontSize={14}>签发就绪度</Typography>
                  <Stack direction="row" alignItems="baseline" spacing={1} mt={1}><Typography variant="h4" fontWeight={850}>{readiness}%</Typography><Typography fontSize={11} color="text.secondary">完成度</Typography></Stack>
                  <LinearProgress variant="determinate" value={readiness} color={staleChecks.length > 0 ? 'warning' : 'primary'} sx={{ height: 7, borderRadius: 3, mt: 1 }} />
                  <Typography fontSize={11} color="text.secondary" mt={1.2}>
                    {freshChecked}/4 项门禁有效确认；{openFindings.length} 个开放发现项；{staleChecks.length} 项检查失效；{reviewFindings.length} 项待复核。
                  </Typography>
                  {staleChecks.length > 0 && <Typography fontSize={10.5} sx={{ color: '#a87935', mt: .8 }}>失效门禁与开放结论已退出完成度，重新核验后恢复计入。</Typography>}
                </CardContent></Card>

                <Card elevation={0} variant="outlined"><CardContent sx={{ pb: 1 }}>
                  <Typography fontWeight={800} fontSize={14} mb={.8}>失效来源与待复核项</Typography>
                  {pendingCount === 0 && invalidatedFindings.length === 0 && <Typography fontSize={11} color="text.secondary" sx={{ py: 1 }}>暂无失效项，全部依据均在有效期内。</Typography>}
                  {reviewFindings.map((finding) => (
                    <Box key={finding.id} sx={{ borderTop: '1px solid #edf0ef', py: 1 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography fontSize={11.5} fontWeight={700}>{finding.title}</Typography>
                        <Button size="small" onClick={() => store.reviewFinding(finding.id)}>复核通过</Button>
                      </Stack>
                      <Typography fontSize={10} color="text.secondary" mt={.3}>来源：{finding.source} · {finding.assignee}</Typography>
                    </Box>
                  ))}
                  {staleChecks.map(([id, check]) => (
                    <Box key={id} sx={{ borderTop: '1px solid #edf0ef', py: 1 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography fontSize={11.5} fontWeight={700}>门禁已失效：{id}</Typography>
                        <Button size="small" variant="contained" onClick={() => store.recheckIssuanceCheck(id)}>重新核验</Button>
                      </Stack>
                      <Typography fontSize={10} color="text.secondary" mt={.3}>{check.staleReason}</Typography>
                    </Box>
                  ))}
                  {invalidatedFindings.slice(0, 4).map((finding) => (
                    <Box key={finding.id} sx={{ borderTop: '1px solid #edf0ef', py: 1, opacity: .8 }}>
                      <Typography fontSize={11} fontWeight={700}>{finding.title}</Typography>
                      <Typography fontSize={10} color="text.secondary" mt={.3}>关闭结论已退出完成度（可查）· {finding.invalidatedReason} · 失效于 {finding.invalidatedAt ? formatTs(finding.invalidatedAt) : '-'}</Typography>
                    </Box>
                  ))}
                  {closedFindings.length > 0 && <Typography fontSize={10} color="text.secondary" sx={{ pt: 1, borderTop: '1px solid #edf0ef' }}>{closedFindings.length} 项关闭结论仍然有效，计入完成度。</Typography>}
                </CardContent></Card>

                <Card elevation={0} variant="outlined"><CardContent><Stack direction="row" justifyContent="space-between"><Typography fontWeight={800} fontSize={14}>版本与核验意见</Typography></Stack>{[['V4', '韩跃', '修订柴油活动数据并补充测试运行说明'], ['V3', '沈楠', '要求补充流量计校准证据'], ['V2', '徐璐', '统一电量单位并附原始记录']].map((item) => <Stack key={item[0]} direction="row" spacing={1.2} sx={{ borderTop: '1px solid #edf0ef', py: 1.2 }}><Chip size="small" label={item[0]} /><Box><Typography fontSize={11.5} fontWeight={700}>{item[1]}</Typography><Typography fontSize={10.5} color="text.secondary">{item[2]}</Typography></Box></Stack>)}</CardContent></Card>
                <Alert severity={allIssuanceChecked ? 'success' : 'warning'}>{allIssuanceChecked ? '全部门禁已完成，可提交签发准备。' : `完成失效复核并关闭 ${openFindings.length} 个开放发现项后可提交。`}</Alert>
              </Stack>
            </Box>
          )}
        </Box>
      </Box>

      {correctionOpen && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 60, bgcolor: 'rgba(15,25,22,.4)', display: 'grid', placeItems: 'center', p: 2 }} onMouseDown={() => setCorrectionOpen(false)}>
          <Card sx={{ width: 'min(520px, 100%)' }} onMouseDown={(event) => event.stopPropagation()}><CardContent sx={{ p: 2.2 }}>
            <Typography variant="h6" fontWeight={800}>修订活动数据</Typography>
            <Typography variant="body2" color="text.secondary" mt={.5}>当前值 {selected.activity.toLocaleString()} {selected.unit}。修订将生成 V{selected.revision + 1}，原始版本保持不变；该记录的发现项与签发检查将立即失效并重算，关闭结论退出完成度并留痕。</Typography>
            <TextField fullWidth size="small" label={`修订值 / ${selected.unit}`} value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} margin="normal" />
            <TextField fullWidth size="small" label="修订原因" multiline rows={3} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} margin="normal" />
            {!correctionReason.trim() && <Alert severity="warning">必须填写修订原因。</Alert>}
            <Stack direction="row" spacing={1} justifyContent="flex-end" mt={2}><Button onClick={() => setCorrectionOpen(false)}>取消</Button><Button variant="contained" disabled={!correctionReason.trim() || !Number(correctionValue)} onClick={() => { store.reviseValue(selected.id, Number(correctionValue), correctionReason); setCorrectionOpen(false); setCorrectionReason(''); }}>生成新版本</Button></Stack>
          </CardContent></Card>
        </Box>
      )}
    </Box>
  );
}
