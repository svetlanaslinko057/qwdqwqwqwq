/**
 * DescribeWidget — inline describe-your-product form for landing hero.
 *
 * Mirrors the Expo /describe flow (/app/frontend/app/describe.tsx) but
 * laptop-native: text/URL input + file upload, no voice. Smart URL
 * detection auto-routes to /api/estimate/analyze-url, file upload to
 * /api/estimate/parse-file, plain text to /api/estimate.
 *
 * Two surface modes:
 *   - "inline"  — compact widget for the hero CTA (default)
 *   - "full"    — expanded form for the dedicated /describe page
 *
 * Calls runtime.* directly (visitor mode — no auth required for analyze/parse).
 * On success, navigates to /estimate-result with the response in router state.
 *
 * The two-pass /api/estimate (Pass 1 generator + Pass 2 operational hardening
 * for reliability + qa) is invisible at this layer — it just returns the
 * combined module list with `_source` metadata which EstimateResultPage uses
 * to render hardening badges.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Loader2, ArrowRight, Link2, FileText, X } from 'lucide-react';
import { runtime } from '@/runtime';

const URL_REGEX = /\bhttps?:\/\/\S+/i;
const MAX_GOAL = 1200;
const MIN_GOAL = 40;
const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const MAX_FILE_MB = 10;

const DescribeWidget = ({ mode = 'inline' }) => {
  const navigate = useNavigate();
  const [goal, setGoal] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState('');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const isURL = URL_REGEX.test(goal.trim());
  const goalLen = goal.trim().length;
  const canSubmit = !busy && (file || isURL || goalLen >= MIN_GOAL);

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setFile(f);
    setError(null);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    try {
      let resolvedGoal = goal.trim();

      // Step A — if file present, parse it into goal text
      if (file) {
        setBusyStage('Reading your file…');
        const fd = new FormData();
        fd.append('file', file);
        try {
          const { data } = await runtime.post('/api/estimate/parse-file', fd, { timeoutMs: 60000 });
          if (data?.text) {
            resolvedGoal = `${resolvedGoal ? resolvedGoal + '\n\n' : ''}${data.text}`.trim().slice(0, MAX_GOAL);
          }
        } catch (e) {
          // Graceful: file parse failure shouldn't block — fallback to filename mention
          resolvedGoal = `${resolvedGoal ? resolvedGoal + '\n\n' : ''}[Attached file: ${file.name}]`.slice(0, MAX_GOAL);
        }
      }

      // Step B — if URL detected (in goal or after file resolution), analyze it
      const urlMatch = resolvedGoal.match(URL_REGEX);
      if (urlMatch && resolvedGoal.length < MIN_GOAL + 50) {
        // Looks like URL-only input — analyze competitor URL
        setBusyStage('Analyzing the link…');
        try {
          const { data } = await runtime.post('/api/estimate/analyze-url', {
            url: urlMatch[0],
          }, { timeoutMs: 45000 });
          if (data?.snapshot) {
            const s = data.snapshot;
            const synthesized = [
              s.product_summary || '',
              s.target_audience ? `Target: ${s.target_audience}` : '',
              s.key_features?.length ? `Features: ${s.key_features.join(', ')}` : '',
            ].filter(Boolean).join('. ');
            if (synthesized) {
              resolvedGoal = synthesized.slice(0, MAX_GOAL);
            }
          }
        } catch (e) {
          // Graceful: continue with raw URL as goal
        }
      }

      // Step C — call main /api/estimate (Pass 1 + Pass 2 hardening)
      if (resolvedGoal.length < MIN_GOAL) {
        setError(`Please describe your product a bit more — at least ${MIN_GOAL} characters or attach a file/link.`);
        setBusy(false);
        return;
      }

      setBusyStage('Calculating scope, modules & price…');
      const { data: estimate } = await runtime.post('/api/estimate', {
        goal: resolvedGoal,
        mode: 'hybrid',
        infer_axes: true,
      }, { timeoutMs: 90000 });

      if (estimate?.clarity === 'low') {
        navigate('/describe', { state: { initialGoal: resolvedGoal, clarityHints: estimate.clarity_hints } });
        return;
      }

      navigate('/estimate-result', { state: { estimate, originalGoal: resolvedGoal } });
    } catch (err) {
      console.error('describe widget error', err);
      setError(err?.message || 'Estimate failed. Please try again.');
    } finally {
      setBusy(false);
      setBusyStage('');
    }
  };

  const baseInputClass = mode === 'inline'
    ? 'w-full bg-card text-foreground border border-border rounded-xl px-5 py-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)] resize-none'
    : 'w-full bg-card text-foreground border border-border rounded-xl px-5 py-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)] resize-none';

  return (
    <div
      className={mode === 'inline' ? 'space-y-3 max-w-2xl' : 'space-y-4'}
      data-testid="describe-widget"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      {/* Text/URL input */}
      <div className="relative">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value.slice(0, MAX_GOAL))}
          placeholder={
            mode === 'inline'
              ? 'Paste a link to a similar product, or describe what you want to build…'
              : 'Describe your product in your own words. Paste a competitor link, or just write 2–3 sentences about what you want to build, who it\'s for, and what problem it solves.'
          }
          rows={mode === 'inline' ? 3 : 6}
          disabled={busy}
          className={baseInputClass}
          data-testid="describe-widget-input"
        />
        {isURL && (
          <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--t-signal)] text-white text-[10px] font-semibold uppercase tracking-wider">
            <Link2 className="w-3 h-3" />
            URL detected
          </div>
        )}
      </div>

      {/* File row */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleFilePick}
          disabled={busy}
          className="hidden"
          data-testid="describe-widget-file-input"
        />
        {!file ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-card border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
            data-testid="describe-widget-attach-button"
          >
            <Upload className="w-4 h-4" />
            Attach file (PDF, doc, image)
          </button>
        ) : (
          <div
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border text-sm"
            data-testid="describe-widget-file-chip"
          >
            <FileText className="w-4 h-4 text-[var(--t-signal)]" />
            <span className="text-foreground font-medium max-w-[200px] truncate">{file.name}</span>
            <span className="text-muted-foreground text-xs">({(file.size / 1024).toFixed(0)} KB)</span>
            <button
              type="button"
              onClick={clearFile}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Char counter */}
        {goal && (
          <span className="text-xs text-muted-foreground ml-auto" data-testid="describe-widget-counter">
            {goalLen} / {MAX_GOAL}
          </span>
        )}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:translate-y-[-1px]"
        style={{
          background: 'var(--t-signal)',
          boxShadow: canSubmit ? '0 10px 26px rgba(11,143,94,0.28)' : 'none',
        }}
        data-testid="describe-widget-submit"
      >
        {busy ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {busyStage || 'Working…'}
          </>
        ) : (
          <>
            Get my estimate
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </>
        )}
      </button>

      {/* Trust + error */}
      <p className="text-xs text-muted-foreground" data-testid="describe-widget-hint">
        Free · no signup required · ~15 seconds · scope, hours and price calculated on the spot
      </p>
      {error && (
        <div
          className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"
          data-testid="describe-widget-error"
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default DescribeWidget;
