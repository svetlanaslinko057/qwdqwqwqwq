/**
 * EstimateResultPage — visitor-mode estimate result + signup/pay CTA.
 *
 * Reads the estimate from router state (set by DescribeWidget or
 * DescribeFlow). Shows:
 *   - matched scope summary
 *   - module breakdown (highlighting operational_hardening_pass adds)
 *   - reality_multiplier + narrative_chips
 *   - final price + complexity + confidence
 *   - CTA: "Continue → create account & pay deposit"
 *
 * Continue navigates to /client/auth with the estimate snapshot in router
 * state so the existing auth flow can pre-create the project on signup.
 *
 * No backend calls in this page — purely renders what was already computed.
 * Refresh-safe: if state is missing, redirects to /describe.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Sparkles,
  Clock,
  DollarSign,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Layers,
  RefreshCw,
} from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

const HARDENING_SOURCE = 'operational_hardening_pass';

const EstimateResultPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const estimate = location.state?.estimate;
  const originalGoal = location.state?.originalGoal || '';

  useEffect(() => {
    if (!estimate) {
      navigate('/describe', { replace: true });
    }
  }, [estimate, navigate]);

  if (!estimate) return null;

  const est = estimate.estimate || {};
  const rl = estimate.reality_layer || {};
  const modules = estimate.modules_detailed || [];
  const techStack = estimate.tech_stack || [];
  const hardeningCount = modules.filter((m) => m._source === HARDENING_SOURCE).length;

  const fmtMoney = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="estimate-result-page">
      {/* Header */}
      <header className="sticky top-0 z-30 w-full backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center" data-testid="result-logo-back">
            <Logo />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-12 pb-24">
        {/* Title block */}
        <div className="mb-10 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border">
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--t-signal)' }} />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Estimate ready
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]" data-testid="result-title">
            Your product is{' '}
            <span style={{ color: 'var(--t-signal)' }}>{est.complexity || 'medium'}</span>{est.complexity && /complex/i.test(String(est.complexity)) ? '.' : ' complexity.'}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            {modules.length} modules · {est.estimated_hours || 0} hours estimated · {rl.axes_source === 'llm_inferred' ? 'axes inferred from your brief' : 'standard axes applied'}.
          </p>
        </div>

        {/* Headline price + multiplier */}
        <div className="grid md:grid-cols-3 gap-4 mb-12">
          <PriceCard
            label="Implementation price"
            value={fmtMoney(est.implementation_price)}
            sub={`${est.estimated_hours || 0} hours @ $${rl.base_hourly_rate || 65}/h`}
            icon={<Layers className="w-5 h-5" />}
            testId="result-impl-price"
          />
          <PriceCard
            label="Reality multiplier"
            value={`×${(est.reality_multiplier || 1).toFixed(2)}`}
            sub="based on entropy axes & live load"
            icon={<Cpu className="w-5 h-5" />}
            testId="result-multiplier"
            highlight
          />
          <PriceCard
            label="Final price"
            value={fmtMoney(est.final_price)}
            sub="contract-backed delivery"
            icon={<DollarSign className="w-5 h-5" />}
            testId="result-final-price"
            big
          />
        </div>

        {/* Narrative chips */}
        {rl.narrative_chips?.length > 0 && (
          <div className="mb-12" data-testid="result-narrative">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-3">
              Why this multiplier
            </h2>
            <div className="flex flex-wrap gap-2">
              {rl.narrative_chips.map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-full bg-card border border-border text-sm font-mono text-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Modules */}
        <div className="mb-12" data-testid="result-modules">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-4">
            Scope breakdown ({modules.length} modules{hardeningCount > 0 && (
              <> · {hardeningCount} added by <span style={{ color: 'var(--t-signal)' }}>operational review pass</span></>
            )})
          </h2>
          <div className="space-y-2">
            {modules.map((m, i) => {
              const isHardening = m._source === HARDENING_SOURCE;
              return (
                <div
                  key={i}
                  className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border hover:border-[var(--t-signal)]/50 transition-colors"
                  data-testid={`result-module-${i}`}
                >
                  <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${isHardening ? 'bg-[var(--t-signal)]/15' : 'bg-muted'}`}>
                    {isHardening ? (
                      <ShieldCheck className="w-5 h-5" style={{ color: 'var(--t-signal)' }} />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{m.title}</span>
                      {isHardening && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--t-signal)]/15 text-[10px] font-semibold uppercase tracking-wider"
                          style={{ color: 'var(--t-signal)' }}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {m._category === 'reliability' ? 'Reliability' : m._category === 'qa' ? 'QA' : 'Hardening'}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="text-sm text-muted-foreground mt-1">{m.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-mono font-semibold text-foreground">{m.hours || 0}h</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tech stack */}
        {techStack.length > 0 && (
          <div className="mb-12" data-testid="result-tech-stack">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-3">
              Proposed stack
            </h2>
            <div className="flex flex-wrap gap-2">
              {techStack.map((t, i) => (
                <span key={i} className="px-3 py-1.5 rounded-md bg-card border border-border text-sm font-mono">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* CTA — registration & deposit */}
        <div
          className="relative rounded-2xl p-8 sm:p-10 overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(11,143,94,0.15) 0%, rgba(47,230,166,0.05) 100%)',
            border: '1px solid var(--t-signal)',
          }}
          data-testid="result-cta-block"
        >
          <div className="grid md:grid-cols-3 gap-8 items-center">
            <div className="md:col-span-2 space-y-3">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Continue with this estimate?
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Create your account (10 seconds) and lock the price by paying a 10% deposit.
                Real developers are assigned within 24 hours. Full contract-backed delivery,
                full refund if scope can't be matched.
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />
                  Contract-backed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />
                  Devs assigned in 24h
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />
                  Refundable until kickoff
                </span>
              </div>
            </div>
            <div className="flex md:flex-col md:items-stretch gap-3">
              <button
                onClick={() => navigate('/client/auth', { state: { fromEstimate: true, estimate, originalGoal } })}
                className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-xl text-white transition-all hover:translate-y-[-1px]"
                style={{
                  background: 'var(--t-signal)',
                  boxShadow: '0 10px 26px rgba(11,143,94,0.28)',
                }}
                data-testid="result-cta-continue"
              >
                Continue & sign up
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={() => navigate('/describe', { state: { initialGoal: originalGoal } })}
                className="inline-flex items-center justify-center gap-2 font-medium px-5 py-3 rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-colors text-sm"
                data-testid="result-cta-refine"
              >
                Refine my idea
              </button>
            </div>
          </div>
        </div>

        {/* Low-confidence warning */}
        {(estimate.confidence != null && estimate.confidence < 0.5) && (
          <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/30" data-testid="result-low-confidence">
            <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">Lower confidence on this estimate</div>
              <p className="text-muted-foreground mt-1">
                The brief is short or unusual. Refine for a tighter price — or proceed; we'll re-estimate after a 30-minute scoping call before any commitment.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const PriceCard = ({ label, value, sub, icon, testId, highlight, big }) => (
  <div
    className={`p-6 rounded-xl bg-card border ${highlight ? 'border-[var(--t-signal)]' : 'border-border'}`}
    data-testid={testId}
  >
    <div className="flex items-center gap-2 mb-3 text-muted-foreground">
      {icon}
      <span className="text-xs font-semibold tracking-[0.12em] uppercase">{label}</span>
    </div>
    <div className={`font-semibold tracking-tight ${big ? 'text-4xl' : 'text-3xl'} ${big ? 'text-foreground' : highlight ? 'text-[var(--t-signal)]' : 'text-foreground'}`}>
      {value}
    </div>
    {sub && <div className="text-xs text-muted-foreground mt-2">{sub}</div>}
  </div>
);

export default EstimateResultPage;
