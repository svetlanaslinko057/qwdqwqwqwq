import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import { useAuth } from '../../src/auth';
import T from '../../src/theme';

/**
 * Tester Validation list — Stage 4 screen #2.
 *
 * GET /api/tester/validation-tasks returns:
 *   - validations assigned to ME (any status), and
 *   - unclaimed pending validations.
 *
 * Filters (local, no extra round-trips):
 *   all · queue · mine · pending · in_progress · passed · failed
 *
 * Paginated client-side (PAGE_SIZE=20) — the endpoint already caps at 100.
 */
type ValidationTask = {
  validation_id: string;
  unit_id?: string;
  work_unit_id?: string;
  project_id?: string;
  assigned_to?: string | null;
  tester_id?: string | null;
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | string;
  created_at?: string;
};

const claimedBy = (t: ValidationTask): string | null | undefined => t.assigned_to ?? t.tester_id;
const unitOf = (t: ValidationTask) => t.work_unit_id || t.unit_id || '';

type Filter = 'all' | 'queue' | 'mine' | 'pending' | 'in_progress' | 'passed' | 'failed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'queue', label: 'Queue' },
  { key: 'mine', label: 'Mine' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'passed', label: 'Passed' },
  { key: 'failed', label: 'Failed' },
];

const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, string> = {
  pending: T.warning,
  in_progress: T.info,
  passed: T.success,
  failed: T.danger,
};

export default function TesterValidations() {
  const router = useRouter();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<ValidationTask[]>([]);
  const [filter, setFilter] = useState<Filter>('queue');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await runtime.get<ValidationTask[]>('/api/tester/validation-tasks');
      setTasks(Array.isArray(data) ? data : []);
    } catch { /* read-only */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const me = user?.user_id;
    return tasks.filter((t) => {
      if (filter === 'all') return true;
      if (filter === 'mine') return claimedBy(t) === me;
      if (filter === 'queue') return !claimedBy(t) && t.status === 'pending';
      return t.status === filter;
    });
  }, [tasks, filter, user]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = filtered.length > visible.length;

  return (
    <ScrollView
      testID="tester-validations"
      style={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); setPage(1); await load(); setRefreshing(false); }}
          tintColor={T.primary}
        />
      }
    >
      <View style={s.content}>
        <Text style={s.title}>Validation queue</Text>
        <Text style={s.subtitle}>{filtered.length} item{filtered.length === 1 ? '' : 's'}</Text>

        {/* Filter pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterRow}
          testID="tester-validations-filters"
        >
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`tester-filter-${f.key}`}
                style={[s.pill, active && s.pillActive]}
                onPress={() => { setFilter(f.key); setPage(1); }}
                activeOpacity={0.7}
              >
                <Text style={[s.pillText, active && s.pillTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {visible.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="checkmark-circle-outline" size={32} color={T.textMuted} />
            <Text style={s.emptyText}>
              {filter === 'queue'
                ? 'Queue empty — nothing waiting for a tester right now.'
                : 'No validations match this filter.'}
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: T.sm }}>
            {visible.map((t) => {
              const color = STATUS_COLOR[t.status] || T.textMuted;
              const owner = claimedBy(t);
              const claimed = !!owner;
              const mine = owner === user?.user_id;
              return (
                <TouchableOpacity
                  key={t.validation_id}
                  testID={`tester-validation-row-${t.validation_id}`}
                  style={s.row}
                  onPress={() => router.push(`/tester/validation/${t.validation_id}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Validation {t.validation_id.slice(-6).toUpperCase()}</Text>
                    <Text style={s.rowMeta}>
                      Unit {unitOf(t).slice(-6)} · {t.status.replace('_', ' ')}{' '}
                      {mine ? '· you' : claimed ? '· taken' : '· unclaimed'}
                    </Text>
                  </View>
                  <View style={[s.badge, { borderColor: color }]}>
                    <Text style={[s.badgeText, { color }]}>{t.status.replace('_', ' ')}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {hasMore && (
              <TouchableOpacity
                testID="tester-validations-load-more"
                style={s.loadMore}
                onPress={() => setPage((p) => p + 1)}
                activeOpacity={0.7}
              >
                <Text style={s.loadMoreText}>Load more ({filtered.length - visible.length} remaining)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: T.xs, marginBottom: T.md },
  filterRow: { gap: T.xs, paddingVertical: T.xs },
  pill: {
    paddingHorizontal: T.md, paddingVertical: T.xs + 2,
    backgroundColor: T.surface1, borderRadius: 999,
    borderWidth: 1, borderColor: T.border,
  },
  pillActive: { backgroundColor: T.primary, borderColor: T.primary },
  pillText: { color: T.textMuted, fontSize: T.small, fontWeight: '600' },
  pillTextActive: { color: T.primaryInk },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.sm,
    borderWidth: 1, borderColor: T.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  rowMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2, textTransform: 'capitalize' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: T.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  empty: {
    alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.lg, marginTop: T.md,
    borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
  },
  emptyText: { color: T.textMuted, fontSize: T.body, textAlign: 'center' },
  loadMore: {
    alignItems: 'center', paddingVertical: T.md, marginTop: T.sm,
    borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.border,
  },
  loadMoreText: { color: T.primary, fontSize: T.small, fontWeight: '700' },
});
