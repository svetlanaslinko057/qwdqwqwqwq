import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../../src/runtime-client';
import { runtime as r } from '../../../src/runtime';
import T from '../../../src/theme';

/**
 * Tester Validation detail — Stage 4 screen #3.
 *
 * Deep-link only; accessed from queue / home rows.
 *
 *   GET  /api/tester/validation/{id}/details   → { validation, work_unit, submission }
 *   GET  /api/tester/validation/{id}/issues    → existing issues
 *   POST /api/validation/{id}/pass             → mark passed (idempotencyKey: pass:<id>)
 *   POST /api/validation/{id}/fail             → mark failed (idempotencyKey: fail:<id>)
 *   POST /api/validation/{id}/issue            → file an issue (idempotency keyed by title)
 *
 * All POSTs preserve `loading/error` triplets per runtime-client doctrine.
 * 409 collisions (already decided) surface as a clean message; we re-fetch.
 *
 * NOTE: we deliberately import the bare `runtime-client` module too so we
 * can discriminate `ApiError` cleanly without importing axios shapes.
 */
type ValidationDetailResp = {
  validation: any;
  work_unit: any | null;
  submission: any | null;
};

type Issue = {
  issue_id: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical' | string;
  status?: string;
  created_at?: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  low: T.info,
  medium: T.warning,
  high: T.danger,
  critical: T.danger,
};

const STATUS_COLOR: Record<string, string> = {
  pending: T.warning,
  in_progress: T.info,
  passed: T.success,
  failed: T.danger,
};

export default function TesterValidationDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<ValidationDetailResp | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Issue compose form
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDesc, setIssueDesc] = useState('');
  const [issueSev, setIssueSev] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, b] = await Promise.all([
        r.get<ValidationDetailResp>(`/api/tester/validation/${id}/details`),
        r.get<Issue[]>(`/api/tester/validation/${id}/issues`),
      ]);
      setDetail(a.data || null);
      setIssues(Array.isArray(b.data) ? b.data : []);
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.message || 'Failed to load');
      setError(msg);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const decide = async (action: 'pass' | 'fail') => {
    if (!id || busy) return;
    setBusy(true);
    setError('');
    try {
      await r.post(`/api/validation/${id}/${action}`, undefined, {
        idempotencyKey: `${action}:${id}`,
      });
      await load();
      Alert.alert('Saved', action === 'pass' ? 'Validation marked as PASSED' : 'Validation marked as FAILED');
    } catch (e: any) {
      const msg = e instanceof ApiError
        ? (e.status === 400 ? (e.hint || `Cannot ${action} in current status`) : (e.hint || e.message))
        : (e?.message || `Could not ${action} validation`);
      setError(msg);
      Alert.alert('Error', msg);
    } finally {
      setBusy(false);
    }
  };

  const fileIssue = async () => {
    const title = issueTitle.trim();
    if (!id || !title) {
      setError('Issue title is required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await r.post(`/api/validation/${id}/issue`, {
        title,
        description: issueDesc.trim(),
        severity: issueSev,
      }, {
        idempotencyKey: `issue:${id}:${title.slice(0, 40).toLowerCase()}`,
      });
      setIssueTitle('');
      setIssueDesc('');
      setIssueSev('medium');
      await load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.message || 'Could not file issue');
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const v = detail?.validation;
  const wu = detail?.work_unit;
  const sub = detail?.submission;
  const statusColor = STATUS_COLOR[v?.status || ''] || T.textMuted;
  const canDecide = v && (v.status === 'pending' || v.status === 'in_progress');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.container} keyboardShouldPersistTaps="handled" testID="tester-validation-detail">
        <View style={s.content}>
          <TouchableOpacity
            testID="tester-detail-back"
            style={s.backRow}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={18} color={T.textMuted} />
            <Text style={s.backText}>Queue</Text>
          </TouchableOpacity>

          {!detail ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={T.primary} />
              <Text style={s.muted}>Loading validation…</Text>
            </View>
          ) : (
            <>
              <Text style={s.title}>Validation {String(id || '').slice(-6).toUpperCase()}</Text>
              <View style={[s.statusBadge, { borderColor: statusColor }]}>
                <View style={[s.dot, { backgroundColor: statusColor }]} />
                <Text style={[s.statusText, { color: statusColor }]}>{String(v?.status || 'unknown').replace('_', ' ')}</Text>
              </View>

              {/* Work unit */}
              <Section title="Work unit">
                {wu ? (
                  <>
                    <Text style={s.workTitle}>{wu.title || 'Untitled'}</Text>
                    {wu.description ? <Text style={s.workDesc}>{wu.description}</Text> : null}
                    <View style={s.metaRow}>
                      <Meta label="Type" value={wu.unit_type || '—'} />
                      <Meta label="Status" value={String(wu.status || '—').replace('_', ' ')} />
                      <Meta label="Hours" value={`${wu.actual_hours || 0}/${wu.estimated_hours || 0}h`} />
                    </View>
                  </>
                ) : <Text style={s.muted}>No work unit linked.</Text>}
              </Section>

              {/* Submission */}
              <Section title="Developer submission">
                {sub ? (
                  <>
                    <Text style={s.workTitle}>{sub.summary || '—'}</Text>
                    {Array.isArray(sub.links) && sub.links.length > 0 && (
                      <View style={{ marginTop: T.xs }}>
                        {sub.links.map((l: string, i: number) => (
                          <Text key={i} style={s.link} numberOfLines={1}>{l}</Text>
                        ))}
                      </View>
                    )}
                  </>
                ) : <Text style={s.muted}>Developer has not submitted yet.</Text>}
              </Section>

              {/* Decisions */}
              <Section title="Decision">
                {canDecide ? (
                  <View style={s.actionRow}>
                    <TouchableOpacity
                      testID="tester-detail-pass"
                      style={[s.actionBtn, { backgroundColor: T.success }]}
                      onPress={() => decide('pass')}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <Ionicons name="checkmark-done" size={18} color="#fff" />
                          <Text style={s.actionText}>Pass</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="tester-detail-fail"
                      style={[s.actionBtn, { backgroundColor: T.danger }]}
                      onPress={() => decide('fail')}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <Ionicons name="close-circle" size={18} color="#fff" />
                          <Text style={s.actionText}>Fail</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={s.muted}>
                    Validation already decided ({String(v?.status || '').replace('_', ' ')}). No further action.
                  </Text>
                )}
              </Section>

              {/* Issues */}
              <Section title={`Issues (${issues.length})`}>
                {issues.length === 0 ? (
                  <Text style={s.muted}>No issues raised yet.</Text>
                ) : (
                  issues.map((i) => {
                    const c = SEVERITY_COLOR[i.severity] || T.textMuted;
                    return (
                      <View key={i.issue_id} testID={`tester-issue-${i.issue_id}`} style={s.issueRow}>
                        <View style={[s.dot, { backgroundColor: c }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.issueTitle}>{i.title}</Text>
                          {i.description ? <Text style={s.issueDesc}>{i.description}</Text> : null}
                          <Text style={[s.issueSev, { color: c }]}>{i.severity.toUpperCase()}</Text>
                        </View>
                      </View>
                    );
                  })
                )}

                {/* File-issue form */}
                <View style={s.form}>
                  <Text style={s.label}>Title</Text>
                  <TextInput
                    testID="tester-issue-title"
                    style={s.input}
                    placeholder="Short summary"
                    placeholderTextColor={T.textMuted}
                    value={issueTitle}
                    onChangeText={setIssueTitle}
                  />
                  <Text style={s.label}>Description (optional)</Text>
                  <TextInput
                    testID="tester-issue-desc"
                    style={[s.input, s.inputMulti]}
                    placeholder="Steps to reproduce, expected vs actual…"
                    placeholderTextColor={T.textMuted}
                    value={issueDesc}
                    onChangeText={setIssueDesc}
                    multiline
                  />
                  <Text style={s.label}>Severity</Text>
                  <View style={s.sevRow}>
                    {(['low', 'medium', 'high', 'critical'] as const).map((sev) => {
                      const active = issueSev === sev;
                      const c = SEVERITY_COLOR[sev];
                      return (
                        <TouchableOpacity
                          key={sev}
                          testID={`tester-issue-sev-${sev}`}
                          style={[s.sevPill, active && { backgroundColor: c, borderColor: c }]}
                          onPress={() => setIssueSev(sev)}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.sevText, active && { color: '#fff' }]}>{sev}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity
                    testID="tester-issue-submit"
                    style={[s.fileBtn, (busy || !issueTitle.trim()) && s.fileBtnDisabled]}
                    onPress={fileIssue}
                    disabled={busy || !issueTitle.trim()}
                    activeOpacity={0.85}
                  >
                    {busy ? <ActivityIndicator color={T.primaryInk} /> : (
                      <Text style={s.fileBtnText}>File issue</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </Section>

              {error ? <Text style={s.error}>{error}</Text> : null}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: T.sm },
  backText: { color: T.textMuted, fontSize: T.small, fontWeight: '600' },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
    marginTop: T.xs, marginBottom: T.lg,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: T.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  loadingBox: { alignItems: 'center', gap: T.sm, padding: T.lg },
  muted: { color: T.textMuted, fontSize: T.small },
  section: { marginBottom: T.lg },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2, marginBottom: T.sm },
  card: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, borderWidth: 1, borderColor: T.border,
  },
  workTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  workDesc: { color: T.textSecondary, fontSize: T.small, marginTop: T.xs, lineHeight: 19 },
  metaRow: { flexDirection: 'row', gap: T.sm, marginTop: T.md },
  metaLabel: { color: T.textMuted, fontSize: T.tiny, letterSpacing: 1, textTransform: 'uppercase' },
  metaValue: { color: T.text, fontSize: T.small, marginTop: 2, textTransform: 'capitalize' },
  link: { color: T.primary, fontSize: T.small, textDecorationLine: 'underline', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: T.sm },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: T.radiusSm,
  },
  actionText: { color: '#fff', fontWeight: '800', fontSize: T.body },
  issueRow: { flexDirection: 'row', gap: T.sm, paddingVertical: T.sm, borderBottomWidth: 1, borderBottomColor: T.border },
  issueTitle: { color: T.text, fontSize: T.small, fontWeight: '700' },
  issueDesc: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, lineHeight: 16 },
  issueSev: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  form: { marginTop: T.md, gap: T.xs },
  label: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: T.xs },
  input: {
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
    paddingHorizontal: T.md, paddingVertical: 10,
    color: T.text, fontSize: T.body,
    borderWidth: 1, borderColor: T.border,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  sevRow: { flexDirection: 'row', gap: T.xs, marginTop: 2 },
  sevPill: {
    paddingHorizontal: T.md, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2,
  },
  sevText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '700', textTransform: 'uppercase' },
  fileBtn: {
    marginTop: T.sm, paddingVertical: 12, borderRadius: T.radiusSm,
    backgroundColor: T.primary, alignItems: 'center',
  },
  fileBtnDisabled: { opacity: 0.5 },
  fileBtnText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },
  error: { color: T.danger, fontSize: T.small, textAlign: 'center', marginTop: T.sm },
});
