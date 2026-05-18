import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import { useAuth } from '../../src/auth';
import T from '../../src/theme';

/**
 * Tester Home — Stage 4 screen #1.
 *
 * Data sources (read-only, runtime-client from day one — no axios legacy):
 *   GET /api/tester/validation-tasks  → my + unassigned-pending validations
 *   GET /api/tester/issues            → issues I've raised
 *
 * Cards: Pending / In progress / Passed / Failed (today snapshot of MY work).
 * CTA: jump into Queue. Empty-state guides the tester to wait or refresh.
 */
type ValidationTask = {
  validation_id: string;
  unit_id?: string;
  work_unit_id?: string;
  project_id?: string;
  // Backend response model exposes `assigned_to`; the raw DB document also
  // carries `tester_id` (legacy field name). We treat them as the same.
  assigned_to?: string | null;
  tester_id?: string | null;
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | string;
  created_at?: string;
};

const claimedBy = (t: ValidationTask): string | null | undefined => t.assigned_to ?? t.tester_id;
const unitOf = (t: ValidationTask) => t.work_unit_id || t.unit_id || '';

const TODAY_MS = 24 * 60 * 60 * 1000;

export default function TesterHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<ValidationTask[]>([]);
  const [issuesCount, setIssuesCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        runtime.get<ValidationTask[]>('/api/tester/validation-tasks'),
        runtime.get<any[]>('/api/tester/issues'),
      ]);
      setTasks(Array.isArray(a.data) ? a.data : []);
      setIssuesCount(Array.isArray(b.data) ? b.data.length : 0);
    } catch { /* read-only: next refresh recovers */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = tasks.filter((t) => claimedBy(t) === user?.user_id);
  const queueCount = tasks.filter((t) => !claimedBy(t) && t.status === 'pending').length;
  const pendingMine = mine.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;

  // Today: count my passed/failed in the last 24h.
  const todayCut = Date.now() - TODAY_MS;
  const myToday = mine.filter((t) => {
    if (!t.created_at) return false;
    const ts = Date.parse(t.created_at);
    return Number.isFinite(ts) && ts >= todayCut;
  });
  const passedToday = myToday.filter((t) => t.status === 'passed').length;
  const failedToday = myToday.filter((t) => t.status === 'failed').length;

  return (
    <ScrollView
      testID="tester-home"
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
        <Text style={s.title}>QA Cockpit</Text>
        <Text style={s.subtitle}>
          {pendingMine > 0
            ? `${pendingMine} validation${pendingMine === 1 ? '' : 's'} waiting for you.`
            : queueCount > 0
              ? `${queueCount} task${queueCount === 1 ? '' : 's'} in the unclaimed queue.`
              : 'No active validations. New work shows up here automatically.'}
        </Text>

        {/* Summary grid */}
        <View style={s.grid}>
          <StatCard label="Mine, open" value={pendingMine} accent={T.info} testID="tester-stat-open" />
          <StatCard label="Queue" value={queueCount} accent={T.warning} testID="tester-stat-queue" />
          <StatCard label="Passed today" value={passedToday} accent={T.success} testID="tester-stat-passed" />
          <StatCard label="Failed today" value={failedToday} accent={T.danger} testID="tester-stat-failed" />
        </View>

        <TouchableOpacity
          testID="tester-home-cta-queue"
          style={s.primaryBtn}
          onPress={() => router.push('/tester/validations' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-done" size={18} color={T.primaryInk} />
          <Text style={s.primaryBtnText}>Open queue</Text>
        </TouchableOpacity>

        {/* My current work — top 5 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>My validations</Text>
          {mine.filter((t) => t.status === 'pending' || t.status === 'in_progress').slice(0, 5).map((t) => (
            <ValidationRow key={t.validation_id} t={t} onPress={() => router.push(`/tester/validation/${t.validation_id}` as any)} />
          ))}
          {mine.filter((t) => t.status === 'pending' || t.status === 'in_progress').length === 0 && (
            <View style={s.empty}>
              <Ionicons name="bed-outline" size={28} color={T.textMuted} />
              <Text style={s.emptyText}>Nothing on your plate. Pick one from the queue.</Text>
            </View>
          )}
        </View>

        {/* Footer: issues count link */}
        <TouchableOpacity
          testID="tester-home-history-link"
          style={s.footerLink}
          onPress={() => router.push('/tester/history' as any)}
          activeOpacity={0.7}
        >
          <Ionicons name="time-outline" size={14} color={T.textMuted} />
          <Text style={s.footerLinkText}>{issuesCount} issue{issuesCount === 1 ? '' : 's'} raised by you · view history →</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value, accent, testID }: { label: string; value: number; accent: string; testID: string }) {
  return (
    <View testID={testID} style={[s.statCard, { borderLeftColor: accent }]}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function ValidationRow({ t, onPress }: { t: ValidationTask; onPress: () => void }) {
  const color = STATUS_COLOR[t.status] || T.textMuted;
  return (
    <TouchableOpacity
      testID={`tester-home-row-${t.validation_id}`}
      style={s.row}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[s.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>Validation {t.validation_id.slice(-6).toUpperCase()}</Text>
        <Text style={s.rowMeta}>Unit {unitOf(t).slice(-6)} · {t.status.replace('_', ' ')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
    </TouchableOpacity>
  );
}

const STATUS_COLOR: Record<string, string> = {
  pending: T.warning,
  in_progress: T.info,
  passed: T.success,
  failed: T.danger,
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: T.xs, marginBottom: T.lg, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.sm, marginBottom: T.lg },
  statCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, borderLeftWidth: 3,
    borderWidth: 1, borderColor: T.border,
  },
  statValue: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  statLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, letterSpacing: 0.4 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 14, marginBottom: T.lg,
  },
  primaryBtnText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },
  section: { marginBottom: T.lg },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2, marginBottom: T.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.sm,
    borderWidth: 1, borderColor: T.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  rowMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2, textTransform: 'capitalize' },
  empty: {
    alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.lg, borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
  },
  emptyText: { color: T.textMuted, fontSize: T.body },
  footerLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: T.sm },
  footerLinkText: { color: T.textMuted, fontSize: T.small },
});
