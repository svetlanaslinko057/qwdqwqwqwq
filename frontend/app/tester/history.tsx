import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import { useAuth } from '../../src/auth';
import T from '../../src/theme';

/**
 * Tester History / Performance — Stage 4 screen #4.
 *
 *   GET /api/tester/validation-tasks   → derives MY decided validations (passed+failed)
 *   GET /api/tester/issues             → my reported issues
 *
 * Local-only metrics (no extra endpoint added):
 *   total decided · pass rate · failed count · issues raised
 *   decision histogram by day (last 7 days)
 *
 * If we ever need server-side performance computation, the right place
 * is a new `/api/tester/performance` route. Keep this client-only until
 * volume forces it.
 */
type ValidationTask = {
  validation_id: string;
  unit_id?: string;
  work_unit_id?: string;
  assigned_to?: string | null;
  tester_id?: string | null;
  status: string;
  created_at?: string;
};

const claimedBy = (t: ValidationTask): string | null | undefined => t.assigned_to ?? t.tester_id;
const unitOf = (t: ValidationTask) => t.work_unit_id || t.unit_id || '';

type Issue = { issue_id: string; severity: string; created_at?: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export default function TesterHistory() {
  const router = useRouter();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<ValidationTask[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        runtime.get<ValidationTask[]>('/api/tester/validation-tasks'),
        runtime.get<Issue[]>('/api/tester/issues'),
      ]);
      setTasks(Array.isArray(a.data) ? a.data : []);
      setIssues(Array.isArray(b.data) ? b.data : []);
    } catch { /* read-only */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const me = user?.user_id;

  const mineDecided = useMemo(
    () => tasks.filter((t) => claimedBy(t) === me && (t.status === 'passed' || t.status === 'failed')),
    [tasks, me],
  );

  const total = mineDecided.length;
  const passed = mineDecided.filter((t) => t.status === 'passed').length;
  const failed = total - passed;
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 100);

  // 7-day histogram.
  const buckets = useMemo(() => {
    const now = new Date();
    const arr: { date: string; passed: number; failed: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * DAY_MS);
      arr.push({ date: dayKey(d), passed: 0, failed: 0 });
    }
    const byDate = new Map(arr.map((b) => [b.date, b]));
    for (const t of mineDecided) {
      if (!t.created_at) continue;
      const dt = new Date(t.created_at);
      if (!Number.isFinite(dt.getTime())) continue;
      const k = dayKey(dt);
      const bucket = byDate.get(k);
      if (!bucket) continue;
      if (t.status === 'passed') bucket.passed += 1;
      else if (t.status === 'failed') bucket.failed += 1;
    }
    return arr;
  }, [mineDecided]);

  const maxInDay = buckets.reduce((acc, b) => Math.max(acc, b.passed + b.failed), 0) || 1;
  const issuesMine = issues.length;

  // Recently decided (last 20, newest first)
  const recent = useMemo(() => {
    const sorted = [...mineDecided].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return sorted.slice(0, 20);
  }, [mineDecided]);

  return (
    <ScrollView
      testID="tester-history"
      style={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={T.primary}
        />
      }
    >
      <View style={s.content}>
        <Text style={s.title}>Performance</Text>
        <Text style={s.subtitle}>Last 7 days · my decisions</Text>

        {/* KPI grid */}
        <View style={s.grid}>
          <Kpi label="Decided" value={total} accent={T.info} testID="tester-history-kpi-decided" />
          <Kpi label="Pass rate" value={`${passRate}%`} accent={T.success} testID="tester-history-kpi-passrate" />
          <Kpi label="Failed" value={failed} accent={T.danger} testID="tester-history-kpi-failed" />
          <Kpi label="Issues" value={issuesMine} accent={T.warning} testID="tester-history-kpi-issues" />
        </View>

        {/* Histogram */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>7-day activity</Text>
          <View style={s.chart}>
            {buckets.map((b, i) => {
              const totalDay = b.passed + b.failed;
              const passedH = (b.passed / maxInDay) * 80;
              const failedH = (b.failed / maxInDay) * 80;
              const label = b.date.slice(5); // MM-DD
              return (
                <View key={b.date} style={s.barCol} testID={`tester-bar-${i}`}>
                  <View style={s.barStack}>
                    <View style={[s.bar, { height: failedH, backgroundColor: T.danger }]} />
                    <View style={[s.bar, { height: passedH, backgroundColor: T.success }]} />
                  </View>
                  <Text style={s.barCount}>{totalDay > 0 ? totalDay : ''}</Text>
                  <Text style={s.barLabel}>{label}</Text>
                </View>
              );
            })}
          </View>
          <View style={s.legendRow}>
            <Legend dot={T.success} label="Passed" />
            <Legend dot={T.danger} label="Failed" />
          </View>
        </View>

        {/* Recent decisions */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Recent decisions ({recent.length})</Text>
          {recent.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="hourglass-outline" size={28} color={T.textMuted} />
              <Text style={s.emptyText}>You have not decided any validations yet.</Text>
              <TouchableOpacity
                testID="tester-history-go-queue"
                style={s.gotoBtn}
                onPress={() => router.push('/tester/validations' as any)}
                activeOpacity={0.85}
              >
                <Text style={s.gotoBtnText}>Open queue</Text>
              </TouchableOpacity>
            </View>
          ) : (
            recent.map((t) => {
              const color = t.status === 'passed' ? T.success : T.danger;
              return (
                <TouchableOpacity
                  key={t.validation_id}
                  testID={`tester-history-row-${t.validation_id}`}
                  style={s.row}
                  onPress={() => router.push(`/tester/validation/${t.validation_id}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Validation {t.validation_id.slice(-6).toUpperCase()}</Text>
                    <Text style={s.rowMeta}>Unit {unitOf(t).slice(-6)} · {t.status}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function Kpi({ label, value, accent, testID }: { label: string; value: number | string; accent: string; testID: string }) {
  return (
    <View testID={testID} style={[s.kpiCard, { borderLeftColor: accent }]}>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={[s.legendDot, { backgroundColor: dot }]} />
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: T.xs, marginBottom: T.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.sm, marginBottom: T.lg },
  kpiCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, borderLeftWidth: 3,
    borderWidth: 1, borderColor: T.border,
  },
  kpiValue: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  kpiLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, letterSpacing: 0.4 },
  section: { marginBottom: T.lg },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2, marginBottom: T.sm },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, borderWidth: 1, borderColor: T.border,
    minHeight: 130,
  },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barStack: { height: 90, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: 16, borderRadius: 3, marginTop: 2 },
  barCount: { color: T.textSecondary, fontSize: T.tiny, fontWeight: '700', minHeight: 12 },
  barLabel: { color: T.textMuted, fontSize: 9, letterSpacing: 0.4 },
  legendRow: { flexDirection: 'row', gap: T.lg, marginTop: T.sm, justifyContent: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: T.textMuted, fontSize: T.tiny },
  empty: {
    alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.lg, borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
  },
  emptyText: { color: T.textMuted, fontSize: T.body, textAlign: 'center' },
  gotoBtn: { backgroundColor: T.primary, paddingHorizontal: T.lg, paddingVertical: 10, borderRadius: T.radiusSm },
  gotoBtnText: { color: T.primaryInk, fontWeight: '800' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.sm,
    borderWidth: 1, borderColor: T.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  rowMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2, textTransform: 'capitalize' },
});
