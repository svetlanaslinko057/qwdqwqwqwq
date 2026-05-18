# ATLAS DevOS — Status snapshot (May 18 2026)

> Russian-speaking user. Этот PRD ведётся на русском по запросу.

## 0a. Сессия May 18 2026 (vNEXT-4) — Deposit Flow + Conversion Chain Re-validation

> Пользователь дал чёткий запрос: *«Прогнать testing_agent чтобы независимо подтвердить всю цепочку visitor estimate → register → auto-claim → admin sees converted → admin can PATCH. Когда добавите Stripe key → активировать Pay deposit. Опционально: показывать Estimate price в client/dashboard sidebar».*

### Что появилось

**1. Полная валидация цепочки конверсии (iter 8 → iter 9 testing_agent).**
- Backend 8/8 pass: `/api/estimate` → `/api/auth/register` → `/api/leads/{id}/claim` → `/api/admin/leads?status=converted` → `PATCH /api/admin/leads/{id}` → `GET /api/client/project/{id}/workspace` → `POST /api/client/projects/{id}/deposit/checkout` → `GET /api/client/attention`.
- Тест зафиксирован: `/app/backend/tests/test_conversion_deposit_flow.py` + `/app/test_reports/pytest/conversion_deposit_iter8.xml` и `iteration_8.json`/`iteration_9.json`.

**2. Workspace endpoint расширен `deposit`-блоком.** `client_workspace.py` теперь возвращает:
```json
"deposit": {
  "required": true,
  "paid": false,
  "amount": 169.5,
  "final_price": 1695.0,
  "project_status": "awaiting_deposit"
}
```
Аддитивно — старые проекты без `deposit_amount` получают `required:false`.

**3. Новый endpoint `POST /api/client/projects/{id}/deposit/checkout`** (server.py).
- Создаёт идемпотентный invoice (`deposit:true`) и вызывает `_provider_create_payment` (тот же boundary, что для module-invoices).
- Stripe LIVE когда `STRIPE_SECRET_KEY` установлен в admin/integrations; иначе mock-payment (рабочий stub URL для E2E).
- Защита: 404 если не владелец, 409 если статус не `awaiting_deposit`, `already_paid:true` если повторный вызов после оплаты.

**4. `/api/client/attention` теперь репортит `awaiting_deposit` + `awaiting_deposit_projects`.** До 5 свежих проектов с `name`, `deposit_amount`, `final_price` — для рендера сайдбара.

**5. Mobile UI:**
- `/client/projects/[id].tsx`: добавлена `deposit-card` (testID) в начало ScrollView — показывается когда `ws.deposit?.required && !ws.deposit?.paid`. Кнопка `pay-deposit-btn` зовёт `/deposit/checkout` и открывает `payment_url` через `Linking.openURL`.
- `/client/home.tsx`: блок `awaiting-deposit-sidebar` (testID) с rows `awaiting-deposit-{project_id}` — render когда `attention.awaiting_deposit_projects.length > 0`. Banner CTA "Review now" теперь направляет в первый awaiting-deposit проект, а не первый active.

### Stripe activation
Когда админ положит реальный Stripe key через `/admin/integrations`, payment provider автоматически переключится на `stripe-payments` → `pay-deposit-btn` начнёт открывать hosted Stripe checkout вместо mock stub. Frontend изменений не требуется — boundary прозрачен.

### Известные тонкости (iter 9)
- `auth-dev-code-banner` отключен в preview (`AUTH_OTP_DEV_MODE=false`). Для автоматизированного QA OTP-код доступен через коллекцию `auth_codes` в Mongo. Опционально: включить DEV_MODE для preview окружений.
- `project.status` на верхнем уровне `workspace` ответа отсутствует — статус доступен только через `deposit.project_status`. Не блокер.

---

## 0b. Сессия May 18 2026 (vNEXT-3) — Pricing Review Session (10 archetypes)

> Пост-stabilization сигн-офф пользователя: *«погонять 20 synthetic briefs… axis discipline… semantic inflation… where humans disagree with the engine».*

### Что появилось

**1. Расширенный sweep tool — `--corpus` flag.** `/app/scripts/pricing-stabilization-sweep.py` теперь имеет режим, прогоняющий 10 канонических архетипов из user-list (Slack clone / Linear clone / Stripe-for-X / B2B CRM / AI copilot / Infra observability / Marketplace / Realtime multiplayer / Banking dashboard / Enterprise ERP) на 3-х уровнях base implementation price ($1.5k / $5k / $8k) → elasticity таблица.

**2. Review отчёт — `/app/audit/PRICING_REVIEW_2026-05-18.md`** + сырые данные `/app/audit/pricing-review-corpus.json`.

### Главное findings

**ГЛАВНОЕ: bind constraint — не multipliers, а base implementation price.**

```
base $1,500   ░░░░░░░░░░    0% within market band   (synthetic — слишком мало)
base $5,000   ████████░░   80% within band         (LLM scope для типичных briefs)
base $8,000   █████████░   90% within band         (LLM scope для production briefs)
```

На base $5k (правдоподобный output `/api/estimate` через LLM hours × $65/h):
- ✅ 8/10 архетипов попадают в консультинговый band (Slack $48k, Linear $28k, AI copilot $62k, Marketplace $31k, Multiplayer $62k, Banking $64k, CRM $23k, Observability $83k)
- ⚠ 2/10 под band: Stripe-for-X ($53k vs $80–200k), ERP ($169k vs $200k–$2M) — это organizational-tier projects, легитимно требуют admin Re-price intervention

**Reality Layer multipliers (×4 — ×34) работают как должны.** Amplification — правильный порядок величины для entropy management.

### Disagreement zone (где human vs engine расходятся)

При base $8k AI copilot уходит в **over band**: $99k vs $30–80k market. Скорее всего одна из axes слишком aggressive:
- `realtime: critical` для streaming UX → возможно `collaborative` честнее (не trading-grade latency)
- `unknowns: high` для LLM behaviour → возможно `medium` ("discovery work") точнее

Это — judgment call для следующей сессии. **Не code change.**

### Что это меняет для Iteration 4

Iteration 4 теперь имеет конкретный first probe вместо «evidence extraction» в общем виде:

> **Question for Iteration 4:** What base implementation price does live `/api/estimate` produce when fed the 10 archetype briefs?
> - If LLM produces $5–8k → **engine is market-calibrated as-is. Ship.**
> - If LLM produces ≤$1.5k → fundamental upstream issue in LLM scope generation, multipliers are red herring.

Этот probe blocked на конфигурацию `EMERGENT_LLM_KEY` через `/admin/integrations` UI. До этого engine математически правильный, judgment-calibrated, и готов к real-world traffic.

### Status проверки

| Item | Status |
|------|:------:|
| Engine math invariants | ✅ (7/7) |
| Multiplier ranges psychologically defensible | ✅ |
| 10-archetype corpus within band @ realistic base | ✅ (8/10 @ $5k, 9/10 @ $8k) |
| `/api/estimate` LLM-scope probe on 10 archetypes | ⏳ blocked on EMERGENT_LLM_KEY |
| AI copilot axes review (over-priced @ $8k) | 📝 documented, next session |
| First real client engagement closes | ⏳ time-gated |

---

## 0a. Сессия May 18 2026 (vNEXT-2) — Stabilization Window (post-Iteration-3)

> По итогам code-review Iteration 3 пользователь чётко сформулировал:
> *«stabilization window … calibration of judgment, not calibration of code».*
> До Iteration 4 (evidence extraction) — погонять математику, проверить sanity.

### Сделано

**1. Stabilization sweep tooling.** Новый файл `/app/scripts/pricing-stabilization-sweep.py` (~310 строк) — read-only CLI инструмент, прогоняющий 7 инвариантов на pricing_engine. Никаких изменений в самом engine, никаких изменений в pricing_config, никаких записей в DB. Импортирует `apply_reality_layer` напрямую, считает в-процессе.

**Семь инвариантов:**

| #  | Инвариант | Объём | Результат |
|----|-----------|-------|:---------:|
| 1  | Determinism (same input → same output) | 50 random samples | ✅ |
| 2  | Monotonicity (higher axis level → higher price) | 5 axes × все levels | ✅ |
| 3  | Order invariance (dict key order не влияет) | 30 samples × shuffled | ✅ |
| 4  | No pathological prices (NaN/zero/negative) | Exhaustive 1024/1024 | ✅ |
| 5  | Chip-axis pairing (chips ⇔ non-baseline narratives) | 100 random samples | ✅ |
| 6  | Psychological sanity (5 iconic projects) | Eyeball + monotonicity assert | ✅ |
| 7  | Calibration probe (live API observation-only invariant) | 3 thresholds via HTTP | ✅ |

**Verdict:** *All invariants hold. Engine is judgment-calibrated.*

### Ключевые наблюдения (по психологической sanity-таблице, base=$1500)

```
$1,500   ×1.00   Solo MVP (to-do clone)                       → MVP · Isolated app
$4,036   ×2.69   Startup beta + modest realtime               → Beta · Connected · Discovery
$11,340  ×7.56   SMB SaaS prod + collaboration                → Production · Platform · Discovery · Collaboration · Long-term
$18,662  ×12.44  Realtime trading dashboard                   → Production · Platform · High unc. · Realtime · Long-term
$65,340  ×43.56  Infrastructure platform, research-grade, 5yr → Scaled · OS · Research · Realtime · Infrastructure
```

Полный спектр: спред ×43.6. Высокий конец (×43) скорее **недо-pricing'ом** относительно консультинговых $100k+ для OS-scope research-grade — повод вернуться когда появятся реальные completed projects (см. триггеры ниже).

### Отчёт
`/app/audit/PRICING_STABILIZATION_2026-05-18.md` — полный отчёт с воспроизводимой командой, инвариантной таблицей, psychological sanity-таблицей, и pre-Iteration-4 readiness checklist.

### Pre-Iteration-4 readiness (наблюдательные триггеры)

| Item | Status |
|------|:------:|
| Pricing math invariants hold | ✅ |
| Iconic projects price plausibly | ✅ |
| Calibration endpoint read-only by construction | ✅ |
| Engine survives 1024 combos w/o NaN | ✅ |
| Chips never leak multipliers | ✅ |
| Первый реальный completed project с logged hours | ⏳ (1 project analysed, нужно ≥5 для axis) |
| `legacy_estimate_hits.last_hit_at` старше 7 дней | ⏳ (1 hit зафиксирован в этой сессии) |

**Iteration 4 (evidence extraction: realtime/auth/payments/AI/infra detected) остаётся параркован до триггеров.**

### Что НЕ сделано — намеренно

- ❌ Никаких изменений в pricing_engine. Только observation.
- ❌ Никаких изменений в multipliers. Sweep — read-only.
- ❌ Никакого «AI pricing oracle». Per вашему ревью.
- ❌ Никакого pricing explanation graph пока — это уже Iteration 4 territory когда будем готовы.

---

## 0. Сессия May 18 2026 — Iteration 3 (Pricing Reality Layer governance + admin tooling)

> Пользователь дал sign-off на Iteration 2 и зафиксировал 5 hard-rules для Iteration 3, чтобы случайно НЕ сломать immutable snapshots / pricing truth. Iteration 3 закрыт целиком в одной сессии — все 4 пункта из roadmap (PRD §0 Iteration 2 TODO).

### Сделано в этой сессии

**1. Governance чартер.** Создан `/app/docs/pricing-reality-layer-iteration-3-charter.md` — формализует 5 hard-rules (calibration NEVER mutates, reprice preview-first, snapshot immutability sacred, narrative chips = economic layer, legacy $25 sunset). Это документ-референс по аналогии с `product-scope-freeze.md`.

**2. Web narrative chips parity — DONE.** Аудит web-поверхностей показал что `ClientEstimatePage.js` уже рендерил chips (Iteration 2). Других мест где `final_price` отображается БЕЗ chips не нашлось. Парити с Expo `/estimate-result` подтверждён.

**3. Admin Re-price UI — preview-first.** `/app/web/src/pages/AdminProjectReprice.js` (новый, ~290 строк) — добавлен 5-м табом в `/admin/finance`. Two-step UX:
- **Preview**: project dropdown → 5 axis dropdowns (каждый с multiplier + narrative annotation, e.g. `production · ×1.80 · "Production-grade"`) → "Preview new price" → диф панель показывает `current_final → new_final + delta`, current/new chip pills, multiplier transition, revision bump.
- **Commit**: отдельная кнопка "Commit re-price" + поле reason (240 chars, audit trail). Backend = `POST /api/admin/projects/{id}/reprice` (уже был реализован в Iteration 2, immutable revisions через `pricing_history`).
- Подтверждено E2E: preview-response `{previous, preview, delta}` корректно рендерится, commit возвращает `ok:true` и bumps revision 1→2.

**4. Admin Calibration UI — observation-only.** `/app/web/src/pages/AdminPricingCalibration.js` (новый, ~155 строк) — 6-м табом в `/admin/finance`. Wraps `GET /api/admin/pricing/calibration-suggestions` (тоже уже backend-готов с Iteration 2). Hard guarantees в UI:
- Большой info-banner: *"Observation only. It does **not** change pricing. ... pricing drift is impossible by construction."*
- Нет "Apply" кнопки. Только "Open in pricing config" — переключает на Pricing таб где админ редактирует multiplier руками.
- Подтверждено E2E: empty-state corren ("No axes have enough completed projects ..."), `Run analysis` кнопка работает, threshold input живой.

**5. Legacy $25 — sunset gate.** `/api/ai/estimate` теперь:
- Возвращает RFC 8594 deprecation headers: `Deprecation: true`, `Sunset: Tue, 01 Sep 2026 ...`, `Link: </api/estimate>; rel="successor-version"`, `Warning: 299 "..."`
- Инкрементит `db.legacy_estimate_hits` (insert per call, fire-and-forget).
- Новый diagnostic endpoint `GET /api/admin/legacy-estimate-hits` показывает `total_hits / hits_last_7d / last_hit_at / sunset_date / successor`.
- `ClientEstimatePage.js` обновлён: убран legacy `/ai/estimate` вызов из Promise.all (был 3-й, остались 2: production + template-match). Это первая first-party caller-зачистка → теперь любые будущие hits = только external/legacy.
- Подтверждено curl'ом: hit count `0 → 1` после теста, headers фигурируют в response.

### Backend changes (`/app/backend/server.py`)
- `POST /api/ai/estimate` — добавлен `response: Response = None` параметр + 4 deprecation headers + counter insert в `legacy_estimate_hits`. Сохранена обратная совместимость (200 + body).
- `GET /api/admin/legacy-estimate-hits` (новый, ~30 строк) — admin diagnostic.

### Frontend changes (web)
- `/app/web/src/pages/AdminV2Finance.js` — импорты + 2 новых таба (`reprice`, `calibration`).
- `/app/web/src/pages/AdminProjectReprice.js` — НОВЫЙ, preview-first reprice flow.
- `/app/web/src/pages/AdminPricingCalibration.js` — НОВЫЙ, observation-only suggestions.
- `/app/web/src/pages/ClientEstimatePage.js` — удалён legacy `/ai/estimate` caller.

### Governance docs
- `/app/docs/pricing-reality-layer-iteration-3-charter.md` — новый governance документ.

### E2E validated (Playwright + curl, эта сессия)
- ✅ Admin login (`admin@atlas.dev`) → `/admin/finance` → tabs `Summary / Withdrawals / Earnings / Pricing / Re-price / Calibration` все рендерятся.
- ✅ Re-price tab: проект-selector живой (3 demo projects), все 5 axis dropdowns с многоуровневыми labels (`mvp · ×1.00 · "MVP"`, ...), Preview button работает, preview-карта показывает Δ pricing + chip diff + multiplier+revision transition + reason field.
- ✅ Calibration tab: invariant banner виден, threshold input + Run button работают, empty-state корректный.
- ✅ Curl: `/api/admin/legacy-estimate-hits` 200, RFC 8594 headers на `/api/ai/estimate` фигурируют, `reprice-preview` + `reprice` (commit) возвращают ожидаемые shapes, revision bump 1→2 подтверждён, `pricing_history` push работает (через Iteration 2 backend, переиспользован как есть).

### Что НЕ сделано (по charter)
- ❌ Auto-apply suggestion shortcut. Намеренно — friction is the feature.
- ❌ Background calibration cron. На запросе админа only — Rule 1 spirit.
- ❌ Физическое удаление `/api/ai/estimate`. Только sunset signals, удалим после observation window когда `total_hits == 0` за >7 дней.
- ❌ Evidence-backed auto-detection axes (realtime detected, infra detected, …). Per charter — "next big step, not now".

---

## 0.0. Сессия May 17 2026 — vNEXT (Project Reality Layer)

> Закрывает «следующий момент» из user-request: «не просто rate, а вся pricing logic как продуктовый механизм».

**Контекст пользователя (запомнить дословно):** rate $65/h это не проблема. Проблема в том, что эстиматор считал **implementation effort**, а реальная стоимость довести продукт до production включает: entropy management (rewrites, unknowns, integration churn, coordination, longevity, realtime). Поэтому поднимать rate бессмысленно — нужно ввести multipliers по 5 осям entropy.

**Что реализовано в этой итерации (Iteration 1 — backend ядро + admin UI):**

### Формула
```
final_price = base × mode_multiplier × ∏(reality_axis_multiplier)
```
где Reality Layer = product × ∏(5 axes), каждая ось имеет 4 уровня.

### 5 осей Project Reality Layer (`pricing_engine.DEFAULT_REALITY_LAYER`)
| Axis | Levels (low→high) и multiplier по умолчанию | Narrative chip (видит клиент) |
|---|---|---|
| `product_maturity` | mvp ×1.00 / beta ×1.30 / production ×1.80 / scaled ×2.50 | MVP / Beta / Production-grade / Scaled production |
| `system_coupling` | isolated ×1.00 / connected ×1.20 / platform ×1.60 / operating_system ×2.20 | Isolated app / Connected system / Platform complexity / Operating-system scope |
| `unknowns` | low ×1.00 / medium ×1.25 / high ×1.60 / research ×2.20 | (none) / Discovery work / High uncertainty / Research-grade |
| `realtime_pressure` | none ×1.00 / async ×1.15 / collaborative ×1.40 / critical ×1.80 | (none) / (none) / Collaboration / Realtime |
| `longevity` | prototype ×1.00 / startup_mvp ×1.20 / long_term ×1.50 / infrastructure ×2.00 | (none) / (none) / Long-term product / Infrastructure |

Worst-case max product = 2.50 × 2.20 × 2.20 × 1.80 × 2.00 = **×43.56**. Для среднего production-marketplace проекта (production / platform / high / critical / long_term) — `×12.44`.

### Backend изменения
- `/app/backend/pricing_engine.py` — полностью переписан. Добавлены: `DEFAULT_REALITY_LAYER`, `apply_reality_layer()`, `infer_axes_via_llm()`, `default_axes_snapshot()`, `_normalize_axes()`. Конфиг с DB-override и 30s in-process кэшем сохранён.
- `/app/backend/server.py`:
  - `PricingConfigUpdate` Pydantic расширен полем `reality_layer: Dict[axis, {levels: {level: {multiplier, narrative}}}]`.
  - `PUT /api/admin/pricing-config` валидирует и merge'ит reality_layer patches (multiplier 0 < x ≤ 10.0, narrative ≤ 60 chars).
  - `POST /api/admin/pricing-config/reset` теперь сбрасывает и reality_layer.
  - `EstimateRequest` принимает `axes?: dict, infer_axes?: bool` для **hybrid model** (LLM proposes → admin overrides).
  - `/api/estimate` — после blended_price применяет `apply_reality_layer` и возвращает `estimate.implementation_price` (старая цифра) + `estimate.final_price` (production-aware) + `estimate.reality_multiplier` + `reality_layer.{axes, axes_source, breakdown, narrative_chips}`.
  - `axes_source` ∈ `admin_override | llm_inferred | default_fallback | default_baseline` — для аудита.
  - `DEFAULT_HOURLY_RATE = 25` помечен deprecated (только legacy `/api/ai/estimate`).

### Admin UI изменения
- `/app/web/src/pages/AdminPricingConfigPanel.js` — добавлена секция **«Project Reality Layer (entropy multipliers)»** с 5 axis-карточками × 4 level-инпута каждый = 20 multipliers. Каждая ось показывает default, narrative chip для уровня, и worked example блок: «small brief в hybrid mode, все axes на MAX уровне = $X × Y = $Z (production cost vs implementation cost)».
- `/app/web/src/pages/AdminV2Finance.js` — компонент подключён 4-м табом «Pricing» (был не подключён в роутер вообще — это и был один из «недоделанных моментов»). Доступ: `/admin/finance` → tab Pricing.

### Проверка математики (curl tests)
- baseline (`infer_axes:false`, no axes) → `implementation_price == final_price`, `reality_multiplier == 1.0` ✅ backwards compatible
- explicit `{production, platform, high, critical, long_term}` → $2,145 × 12.44 = **$26,687.24** ✅
- PUT `production: 1.8 → 2.4`, retest → $2,145 × 16.59 = **$35,582.97** ✅ admin override работает live
- Reset → defaults восстановлены ✅

### Принятые решения (зафиксированы по запросу пользователя)
1. Multipliers — добавлены с defaults, редактируются админом.
2. Axis detection — **hybrid** (LLM infers, admin может override через `axes` в payload).
3. Backward compat — старые projects = ×1.00 (default snapshot).
4. Client transparency — narrative chips без чисел (`narrative_chips: ["Production-grade", "Platform complexity", "Realtime"]`).
5. Storage — snapshot per-estimate (axes в response, нужно ещё сохранять в `projects.reality_layer` при создании — TODO Iteration 2).
6. Legacy $25 — помечен deprecated (комментарий в коде), не удалён чтобы не сломать `/api/ai/estimate`.

### Iteration 2 — Pricing Reality Loop ✅ **DONE** (May 17, 2026)
Закрывает "цена становится контрактной, объяснимой и управляемой":

- ✅ Snapshot axes в `projects.reality_layer` при создании проекта (immutable). `L0ProjectCreate` принимает `axes` + `axes_source`. `pricing_snapshot` теперь содержит `implementation_price` + `final_price` + `reality_multiplier`. Дефолт без axes → ×1.00 (backwards compat).
- ✅ Client-facing UI: `narrative_chips` рендерятся на `/app/frontend/app/estimate-result.tsx` (Expo) под `totalValue`. Subtle chip style (pill border, `T.textSecondary`). Без чисел. `axes` + `axes_source` теперь передаются обратно в `POST /api/projects`, так что цена которую клиент **увидел** = цена которую он **платит**.
- ✅ Admin reprice backend: `POST /api/admin/projects/{id}/reprice-preview` + `POST /api/admin/projects/{id}/reprice`. Immutable revisions: предыдущий snapshot пушится в `pricing_history`, новый получает `revision = prev + 1`. Audit row в `system_actions_log` с before/after diff.
- ✅ Legacy $25 изолирован: `/api/ai/estimate` помечен `deprecated=True` в OpenAPI + warning лог `LEGACY_ESTIMATE` при каждом вызове. Не удалён физически чтобы не сломать back-compat (Iteration 3).
- ✅ **CRITICAL FIX**: `/app/web/.env` с `REACT_APP_BACKEND_URL=` (пустое значение). Был баг `${process.env.REACT_APP_BACKEND_URL}/api/...` → литеральная строка `"undefined/api/..."` → 405. Теперь `/api/...` через same-origin FastAPI mount. **Подтверждено Playwright'ом: `undefined-api requests: 0`** после новой сборки.
- ✅ `/app/memory/test_credentials.md` исправлен (admin123 / dev123 / client123 / multi123 / tester123 — у каждого свой пароль, не universal).

### Iteration 2 — curl validation
- ✅ `POST /api/projects` без axes → `final == implementation`, `reality_mult: 1.0` (backwards compat)
- ✅ `POST /api/projects` с `{production, platform, high, critical, long_term}` → DB снапшот: `final $13,997`, `revision: 1`
- ✅ `POST /admin/projects/{id}/reprice-preview` с lower axes → `delta_final: -$10,969`, narrative chips обновляются (`['Beta', 'Connected system', 'Discovery work']`)
- ✅ `POST /admin/projects/{id}/reprice` (commit) → revision 1→2, prev snapshot в `pricing_history`, audit row written
- ✅ `/api/estimate` E2E: `implementation_price: $1,695 × reality_multiplier 12.44 = final_price $21,089` + chips `[Production-grade, Platform complexity, High uncertainty, Realtime, Long-term product]`

### TODO Iteration 3 (закрыть цикл управления ценой)
- [ ] Admin re-price UI в `/admin/finance/pricing` (или `/admin/projects/{id}`): 5 dropdown'ов axes, preview блок с delta, submit-кнопка → `POST /admin/projects/{id}/reprice`. Backend готов.
- [ ] Calibration job: фон, который анализирует завершённые projects, сравнивает `implementation_price` vs реально потраченные часы × rate, и предлагает админу скорректировать defaults multipliers.
- [ ] Web `/describe` (CRA) — клиентский narrative chips render, как в Expo.
- [ ] (Опционально) Удалить `DEFAULT_HOURLY_RATE=25` физически после observation window — сейчас deprecated, но активен.

---

## 0. Сессия May 17 2026 (deploy + intelligence + funnel integrity) [исторический]

Зафиксировано в `/app/audit/DEPLOYMENT_AUDIT_2026-05-17.md`. Краткая выжимка:

1. **Полный deploy** из GitHub в `/app` (был чистый scaffold). Все 131 .py + 78 mobile routes + 78 components + 214 web files. Health-checks 200, login 200, сидинг прошёл.
2. **Web сборка** — `cd /app/web && yarn install && DISABLE_ESLINT_PLUGIN=true yarn build`. `/api/web-ui` отдаёт 200, admin-cockpit ожил. Запекли `502 KB JS + 20 KB CSS`. Это разблокировало `AdminInboxPage` с панелью `🔗 Analyze a site link`.
3. **Tiny telemetry** на `competitor_url_events` коллекцию:
   - `analyze_url_call` — каждый hit `POST /api/estimate/analyze-url`
   - `cache_hit` / `cache_miss` — после успешного резолва
   - `analyze_url_error` с полем `error_kind` (стабильный bucket, не raw string)
   - `copy_click` / `insert_into_reply_click` — через новый `POST /api/estimate/analyze-url/telemetry`
   - Доп. поля: `url` (до 512 симв.), `surface` (visitor | admin | unknown), `occurred_at`.
   - Fire-and-forget, никогда не блокирует основной запрос.
4. **Graceful failure narratives** на `/api/estimate/analyze-url`. Вместо сырых `str(e)` теперь стабильные buckets с человеческим narrative:
   | kind                | HTTP | message (что случилось)                              | hint (что делать)                                          |
   |---------------------|------|------------------------------------------------------|------------------------------------------------------------|
   | `INVALID_URL`       | 400  | «That doesn't look like a website address.»          | «Try the homepage URL of the site you want to analyze.»   |
   | `SITE_BLOCKS_BOTS`  | 422  | «This site blocks automated reading.»                | «Try another page (`/about`, `/pricing`) or paste manually.» |
   | `SITE_UNREACHABLE`  | 422  | «We couldn't reach that site.»                        | «Double-check the address, or try again in a minute.»     |
   | `NOT_HTML`          | 422  | «That link doesn't look like a regular web page.»    | «Paste the URL of the homepage (not a PDF/image).»        |
   | `EMPTY_ANALYSIS`    | 422  | «We reached the site but couldn't summarize it.»     | «Try a page with more visible text (landing/pricing).»    |
   | `LLM_NOT_CONFIGURED`| 503  | «Site analysis is not configured yet.»                | «An admin must enable an LLM provider in /admin/integrations.» |
   | `INTERNAL`          | 502  | «Something went wrong while analyzing this link.»    | «Try again in a moment, or try a different page.»         |
5. **Canonical error envelope** в `middleware/error_shape.py` теперь распаковывает структурированный `detail={kind,message,hint,detail}` dict — лифтит `message` и `hint` в envelope, сохраняет весь dict в `details`. Это не ломает существующие handlers со строковым `detail` (backwards compatible).
6. **Frontend** обновлён:
   - `/app/frontend/app/describe.tsx` — посылает `surface:'visitor'`, рендерит `message + hint` из envelope (не сырое `detail`).
   - `/app/web/src/pages/AdminInboxPage.js` — посылает `surface:'admin'`, добавлен hint-рендер под error-line, copy/insert клики шлют telemetry fire-and-forget.
7. **Доп. находки этой сессии** (исправлены):
   - `beautifulsoup4` отсутствовал в `requirements.txt` (хотя `competitor_analyzer.py` его импортирует). Установлен + зафиксирован.
   - `package-lock.json` конфликтовал с `yarn.lock` → удалён, frontend пересобран.
   - Disk `/app` был забит на 100% (cache 3 GB). Освобождено очисткой `.metro-cache` + pip/yarn caches.

## 0.2. Observation prep (May 17 2026 — этот патч)

User feedback: «не строить, смотреть». Сейчас observation phase. Чтобы 72 часа наблюдений дали правду, добавили **три** маленькие правки без новых фич:

1. **`analyze_url_started`** — событие в `competitor_url_events`, шлётся ДО network call из обоих surface'ов:
   - `/describe` → `analyzeCompetitorUrl()` шлёт `analyze_url_started` immediately after spinner enables, до `api.post('/estimate/analyze-url')`.
   - `AdminInboxPage` → `runUrlAnalyze()` шлёт через axios → `/estimate/analyze-url/telemetry`.
   - **Это даёт:** различать **user intent** vs **network outcome**. Если `started > call`, значит click дошёл но запрос не долетел (offline, race, кэш).

2. **Latency tracking на completion events.** В backend `analyze_competitor_url`:
   - `started_at = time.perf_counter()` в начале;
   - На каждый exit-путь (cache_hit, cache_miss, любой error) записываем `duration_ms: int` + `success: bool` в event.
   - Entry-events (`analyze_url_started`, `analyze_url_call`, `copy_click`, `insert_into_reply_click`) НЕ имеют duration_ms by design — они старт-маркеры, не completion.
   - **Это даёт:** через 3-5 дней увидим p50/p95 latency by `event × surface × device × error_kind`. Решим, нужен ли prefetch / async / queue.

3. **Mobile/desktop slice.** Frontend шлёт `device: 'mobile' | 'desktop'` во ВСЕ payload'ы (analyze-url, analyze-url/telemetry, funnel/event):
   - Mobile native (Expo iOS/Android): всегда `'mobile'`.
   - Web: `window.innerWidth < 768 ? 'mobile' : 'desktop'`.
   - Backend пишет в `device` поле, **только если оно передано** — старые aggregations не сломаны.
   - **Это даёт:** behavior на mobile-viewport ≠ desktop-viewport (форма, latency, error patterns).

### Pydantic models, обновлённые:
- `AnalyzeUrlIn`: `+ device: Optional[str]`
- `AnalyzeUrlTelemetryIn`: `+ device: Optional[str]`, `event` теперь принимает `analyze_url_started | copy_click | insert_into_reply_click`
- `FunnelEventIn`: `+ device: Optional[str]`
- `competitor_analyzer.log_event(...)`: `+ device`, `+ duration_ms`, `+ success` (optional, stored conditionally)

### E2E validated (curl + mongosh aggregate):
Запись схемы:
```
{event: analyze_url_started,    surface: visitor, device: mobile}     n=1, avg_ms=null
{event: analyze_url_call,       surface: visitor, device: mobile}     n=1, avg_ms=null
{event: analyze_url_call,       surface: visitor, device: desktop}    n=1, avg_ms=null
{event: analyze_url_call,       surface: admin,   device: desktop}    n=1, avg_ms=null
{event: analyze_url_error, kind:LLM_NOT_CONFIGURED, visitor mobile}   n=1, avg_ms=1
{event: analyze_url_error, kind:LLM_NOT_CONFIGURED, admin   desktop}  n=1, avg_ms=1
{event: analyze_url_error, kind:INVALID_URL,        visitor desktop}  n=1, avg_ms=0
{event: copy_click,             surface: admin,   device: desktop}    n=1
{event: insert_into_reply_click, surface: admin,  device: desktop}    n=1
```

### Готовые observation-запросы для следующих 72h:

**1. Funnel integrity (top-of-funnel survives?):**
```js
db.competitor_url_events.aggregate([
  {$match:{event:{$in:["analyze_url_started","analyze_url_call","cache_hit","cache_miss","analyze_url_error"]}}},
  {$group:{_id:{event:"$event",surface:"$surface",device:"$device"},n:{$sum:1}}}
])
// click_drop = 1 - call/started
// success_rate = (cache_hit + cache_miss) / call
```

**2. Cache effectiveness:**
```js
db.competitor_url_events.aggregate([
  {$match:{event:{$in:["cache_hit","cache_miss"]}}},
  {$group:{_id:"$event",n:{$sum:1},avg_ms:{$avg:"$duration_ms"}}}
])
// hit_ratio = cache_hit / (cache_hit + cache_miss)
```

**3. Error distribution by surface:**
```js
db.competitor_url_events.aggregate([
  {$match:{event:"analyze_url_error"}},
  {$group:{_id:{kind:"$error_kind",surface:"$surface"},n:{$sum:1}}}
])
```

**4. Admin reuse signal:**
```js
db.competitor_url_events.aggregate([
  {$match:{event:{$in:["copy_click","insert_into_reply_click","cache_hit"]},surface:"admin"}},
  {$group:{_id:"$event",n:{$sum:1}}}
])
// reuse = (copy + insert) / cache_hit  → measures admin actually using cached intelligence
```

**5. Mobile vs desktop split:**
```js
db.competitor_url_events.aggregate([
  {$group:{_id:{device:"$device",event:"$event"},n:{$sum:1}}}
])
```

### What we deliberately did NOT do (по руководству user'а):
- Никакого `embeddings`, `vector search`, `semantic clustering`, `AI memory`, `multi-page crawling`, `autonomous research`, `AI strategist`.
- Никакого `structured analysis object` (business_model/target_market/complexity/features). Сначала смотрим что реально просят.
- Никакого `Amplitude/Segment/Kafka/dashboards`. Mongo aggregate достаточен для текущего масштаба.
- **Никакого нового UI**. Только инструментация.

### Что измеряем:
**Capability** + **friction** + **reuse**. По итогам 72 часов — решение что строить, а не что предполагать.

---

## 0.1. Funnel integrity (May 17 2026 — этот патч)

**Что починили:** `/describe` для гостя зависал на ~15s splash (top-of-funnel break). Root cause не auth, а **блокирующая загрузка Google Fonts**: гейт был `if (authLoading || (token && meLoading) || !fontsLoaded)`. Google Fonts на web грузятся медленно/могут таймаутиться → splash deadlock → пользователь не доходит до intelligence layer.

**Минимальный фикс (без auth refactor'а):**

| Слой | Изменение |
|------|-----------|
| Gate | `blockOnAuth = !!token && (authLoading\|\|meLoading) && !authGraceExpired`. Гость → НЕ блокируется. Auth-юзер блокируется max 1.5s (graceExpired timeout), потом UI рендерится, redirect-effect срабатывает по факту. **Google Fonts больше НЕ в гейте** — system-font fallback рендерится сразу, custom faces подмешиваются по ходу. |
| useMe | Уже работал правильно: `useState<boolean>(!!token)` → guest стартует с `loading: false` и не делает /me запрос. Не трогали — semantics уже верные. |
| Telemetry | Новый endpoint `POST /api/funnel/event` (auth-free, fire-and-forget) → `funnel_events` коллекция: `{event, surface, props, occurred_at}`. Размер пропсов ограничен 2 KB. Логика в `/app/backend/funnel_events.py` (~110 LOC), подключена через `fastapi_app.include_router`. |
| Frontend | `describe.tsx` шлёт 3 события через `_logFunnelEvent`: `describe_opened` (на mount, один раз), `describe_completed` (после goal validation, перед /api/estimate), `estimate_generated` (после успешного ответа, с `clarity` props). |

**E2E validated** этой сессии:
- `/describe` рендерится за <3s для гостя (был 15+s).
- Brand-логотип EVA-X виден, форма доступна.
- `describe_opened` посылается автоматически (Playwright проверка → `funnel_events` row создан).
- 3 события (`describe_opened/completed`, `estimate_generated`) → 200, схема корректна.
- Empty event → 400 с graceful narrative (`INVALID_EVENT` kind).
- Unknown event → 200 (записывается as-is + WARNING в лог), чтобы typo было видно.

**Что измеряет funnel:** `drop_off = 1 - (next_event / previous_event)`. Например:
```
db.funnel_events.aggregate([
  {$match:{event:{$in:["describe_opened","describe_completed","estimate_generated"]}}},
  {$group:{_id:"$event",n:{$sum:1}}}
])
```

**Что осталось OPEN** (не блокирует funnel):
- Brand-image на 390×844 первый раз не рендерится без задержки — но это просто `<Image>` грузит PNG, не deadlock.
- ngrok тоннель supervisor expo иногда падает — авторестартится сам.
- `/openapi.json` 500 (PRD §5).
- React Hooks-order warning в `/developer/*` (iter6).

---

### E2E-проверка telemetry (curl, эта сессия)

```bash
# 3 visitor errors + 3 admin clicks → флаш → measure
db.competitor_url_events.aggregate([{$group:{_id:{event:"$event",surface:"$surface",error_kind:"$error_kind"},n:{$sum:1}}}])
```

Результат:
```
{event: analyze_url_call,         surface: visitor, error_kind: null}                  n: 3
{event: copy_click,               surface: admin,   error_kind: null}                  n: 2
{event: analyze_url_error,        surface: visitor, error_kind: LLM_NOT_CONFIGURED}    n: 2
{event: analyze_url_error,        surface: visitor, error_kind: INVALID_URL}           n: 1
{event: insert_into_reply_click,  surface: admin,   error_kind: null}                  n: 1
```

Это даёт ровно те метрики, которые нужны для вопроса «реальный workflow или curiosity?»: `cache_hit/miss` (free repeat usage), `error_kind` распределение (какие URL ломаются), `copy_click/insert_into_reply_click` (admin реально использует?).

### Следующие открытые шаги (deferred)

- Подключить EMERGENT_LLM_KEY → текущие 503 LLM_NOT_CONFIGURED уйдут, увидим реальные SITE_BLOCKS_BOTS / NOT_HTML кейсы.
- Splash-hang на `/describe` (PRD §5) — гость зависает на бесконечном `useMe()`. Не блокирует welcome, но блокирует тест analyzer-flow в desktop preview.
- React Hooks-order warning в `/developer/*` (iter6).
- `/openapi.json` 500 (PRD §5).
- Reading dashboard для telemetry — пока через mongosh aggregate.

---

## 1. Что это

**ATLAS DevOS / EVA-X** — мультироль-платформа доставки продуктов. Клиент описывает идею (голосом или текстом), система рассчитывает план + цену, эскроу финансирует разработку, внутренние developer'ы выполняют модули, tester валидирует, admin контролирует через cockpit.

Поверхности:
- **Backend (FastAPI)** `/app/backend` → `:8001/api/*` (128 .py, 56 роутеров, 608 endpoint'ов, 112 Mongo-коллекций).
- **Mobile Expo** `/app/frontend` → `:3000` (роуты `admin/`, `client/`, `developer/`, `tester/`, `operator/`, `lead/`, плюс `describe`, `chat`, `welcome`).
- **Web (CRA)** `/app/web` → ожидается на `/api/web-ui` (не собран, 503).

## 2. Последний коммит (commit `271b479`) — Voice / STT слой

Закрыт целиком, проверен end-to-end. Реализовано:

| Слой         | Файл                                  | Что делает                                                                                            |
|--------------|---------------------------------------|-------------------------------------------------------------------------------------------------------|
| STT-обёртка  | `backend/stt_service.py`              | `transcribe_path()` через whisper-1; ключ берётся из `admin_llm_settings.get_active_llm_key`.        |
| Visitor STT  | `backend/file_parser.py`              | `POST /api/estimate/transcribe-voice` — гость на `/describe` может надиктовать бриф.                  |
| Chat auto-STT| `backend/server.py` (`_autotranscribe_voice_message`) | Голосовые сообщения клиента → фоновая транскрипция → `transcript` в `chat_messages` + preview в `message_threads`. |
| Admin LLM UI | `backend/admin_llm_settings.py` + `web/src/pages/AdminIntegrationsPage.js` | `GET/PUT/POST /api/admin/settings/llm[/test]`. Маскировка ключей, переключатель openai/emergent, live-тест. |
| Visitor UI   | `frontend/app/describe.tsx`           | `expo-audio`: запись с таймером, max 3 мин, cancel-кнопка, прогрессивный mic-permission. Транскрипт вставляется в textarea → пользователь правит перед отправкой. |
| Chat UI      | `frontend/app/chat.tsx`               | Telegram-style mic: long-press → запись, release → отправка, swipe-left → отмена.                     |
| Admin inbox  | `web/src/pages/AdminInboxPage.js`     | Для `attachment_kind=voice` отображает `transcript` (плейн-текст) вместо «[voice]».                   |

### Проверка end-to-end в этой сессии

```
curl /api/admin/settings/llm/test
→ {"ok":true, provider:"emergent", source:"env", model:"gpt-4o-mini", response:"OK"}

curl /api/estimate/transcribe-voice -F file=@test.wav
→ {"text":"you", "chars":3}

POST /api/chat/upload-attachment (kind=voice, data_url) →
POST /api/chat/message (attachment_url, attachment_kind=voice) →
sleep 8 →
db.chat_messages.findOne(...) →
  { transcript:"you", transcribed_at:"2026-05-17T17:11:24Z", attachment_kind:"voice" }
```

## 3. Активный LLM-провайдер

В `backend/.env` добавлен `EMERGENT_LLM_KEY=sk-emergent-…` как env-fallback **по умолчанию для тестирования**. Админ может переопределить через `/admin/integrations` (Web UI) — туда же положил OpenAI-ключ через тот же эндпоинт.

Резолюция ключа (`admin_llm_settings.get_active_llm_key`):
1. `preferred_provider` из БД (если ключ есть);
2. ключ другого провайдера из БД (soft-fallback);
3. env-ключ предпочитаемого провайдера;
4. любой env-ключ.

`active_provider="emergent"`, `active_source="env"` — подтверждено через `GET /api/admin/settings/llm`.

## 4. Учётные записи (seed)

См. `/app/memory/test_credentials.md`. Все 5 quick-access юзеров пересоздаются на старте бэкенда, текущий вход админом `admin@atlas.dev / admin123` → 200.

## 5. Известные второстепенные проблемы

- `GET /openapi.json` → 500 (FastAPI: `A response class is needed to generate OpenAPI`). На runtime не влияет.
- Mobile-вьюпорт (390×844) на `/describe` иногда зависает на splash из-за бесконечного `useMe()` для гостей — пересборка metro была активна во время теста; на десктоп-вьюпорте (1280×800) рендер прошёл штатно (см. первый скриншот EVA-X).
- React Hooks-order warning в `/developer/*` (из iter6 теста, не блокирует).

## 6. Анализ ссылки конкурента (May 17, 2026 — этот патч)

Зачастую клиент пишет «хочу как airbnb.com» вместо словесного брифа. Закрыто end-to-end:

| Слой              | Файл                                | Что делает                                                                                                                                                                                                                                                                                                                                                                                                              |
|-------------------|-------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Анализатор        | `backend/competitor_analyzer.py`    | Нормализует URL (https://, отсекает localhost/.local), fetch через httpx (UA Safari, 8s timeout, max 4 редиректа, 1.5MB cap, content-type ∈ html/xml). Парсит BS4: title, og:description, headings (h1/h2/h3 ×10), nav links, form/input count, third-party script hosts, visible text 6000 симв. Кормит компакт-снэпшот в `admin_llm_settings.build_chat` → секции `## Product / Core features / Complexity / Likely integrations / Notes for the estimator`. |
| Эндпоинт          | `backend/file_parser.py`            | `POST /api/estimate/analyze-url {url}` → `{url,title,text,chars,provider,model}`. Маппинг ошибок: `ValueError`→400, `FetchError`→422, `AnalyzerUnavailable`→503, прочее→502. Никакой авторизации (как и `/estimate`).                                                                                                                                                                                                                                |
| UI                | `frontend/app/describe.tsx`         | Третья кнопка `↗ ANALYZE A SITE LINK` в attach-row, того же institutional веса что `+ ATTACH BRIEF` и `● VOICE`. Раскрывает inline-панель: подсказка + моно input + CTA `ANALYZE`. Результат **аппендится** в goal-textarea (с переносом строки если там уже что-то набрано), пишется `attachment` бэдж `ATTACHED · <hostname/title>` с × для очистки. Длина обрезается до `MAX_GOAL`. Все ошибки 400/422/503 показываются inline в `ERR · …`. |

### Проверка E2E (этот session — Playwright/desktop)

1. `/describe` → клик `↗ ANALYZE A SITE LINK` → панель раскрылась.
2. В input — `https://www.airbnb.com` → клик `ANALYZE`.
3. Через ~3 сек: textarea содержит 1089 симв. брифа («## Product / The site is a vacation rental platform for travelers …»), бэдж `ATTACHED · AIRBNB: VACATION RENTALS, CABINS, BEACH HOUSES …`, индикатор `■ READY TO PLAN`.
4. Дальше CTA «See my product plan» вызывает обычный `/api/estimate` — не трогали ничего ниже по конвейеру.

curl-проверки негативных путей:
- `{"url":"not a real url"}` → 400 `URL doesn't look valid`.
- `{"url":"https://does-not-exist-xxx.example"}` → 422 `Couldn't reach the site: Name or service not known`.
- При снятии активного LLM-провайдера в `/admin/integrations` ответ становится 503 с явным текстом «An admin must enable one in /admin/integrations».

## 7. Кэш + бэдж + admin-инструмент (May 17, 2026 — этот патч)

| Слой   | Изменение                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|--------|---|
| Кэш    | `backend/competitor_analyzer.py` — `analyze_url(raw_url, *, db=…)` сначала смотрит в `competitor_url_cache._id=url`; если `created_at < 24h` → возвращает кеш с `cached:true`, **без** fetch и **без** LLM. После MISS пишет результат `replace_one(upsert=True)`. TTL-индекс `expireAfterSeconds=86400` создаётся на старте (`server.py` → `_competitor_cache_indexes`). Подтверждение: ` 'COMPETITOR CACHE: TTL index ensured (24h)'` в логе. |
| Кэш — измерение | 1-й вызов `analyze-url https://stripe.com` — 5.1 с (fetch + LLM). 2-й вызов — 0.03 с (~**170× быстрее**), нулевой LLM-billing. Логи: `cache MISS … chars=1354` → `cache HIT age=0s`. |
| Бэдж   | `frontend/app/describe.tsx` — добавлены `sourceUrl/sourceTitle` state. Заполняются в `analyzeCompetitorUrl`, чистятся при «×» на attachment. Прокидываются в `router.push({ pathname:'/estimate-result' \| '/estimate-improve', params:{ sourceUrl, sourceTitle } })`. |
| Бэдж — рендер | `frontend/app/estimate-result.tsx` — расширены `useLocalSearchParams`. Под заголовком `## Product` рендерится `competitorBadge` с иконкой `link`, лейблом `BASED ON COMPETITOR:` (mono, uppercase, letterSpacing 0.8) и хостом+title. Скрыт, если `sourceUrl===''`. Подтверждение Playwright: `🔗 BASED ON COMPETITOR: airbnb.com — Airbnb: Vacation Rentals, Cabins, Beach Houses, …` (скриншот в /tmp/badge_final.png). |
| Admin chat | `web/src/pages/AdminInboxPage.js` — над composer'ом collapsible-кнопка `🔗 Analyze a site link` (тогглится `ChevronDown/Up`). Раскрывает панель с url-input + `Analyze`-кнопкой. Результат рендерится в `<pre>` с metadata-строкой (title, url, `cached` badge если `cached:true`), плюс кнопки `Copy` (clipboard) и `Insert into reply` (аппендит "Quick read of …" + анализ в textarea). Использует тот же `/api/estimate/analyze-url`, поэтому 24h-кэш делит с client side. **Требует сборки `/app/web`** для появления в `/api/web-ui`. |

### Эндпоинт — без изменений

`POST /api/estimate/analyze-url` теперь дополнительно возвращает поле `cached: boolean`. Все 400/422/503/502 пути работают, в логах виден `cache HIT/MISS` маркер.

## 8. Что ещё можно сделать (опционально)
- Собрать web (`cd /app/web && yarn install && yarn build`) и поднять `/api/web-ui`.
- Подключить реальные ключи Stripe / Resend / Cloudinary.
- Очистить React Hooks-warning в developer-сабтри.
- Починить openapi.json — добавить дефолтный response_class у нестандартных endpoint'ов.

## 7. Открытые решения, оставленные на стороне ассистента

Решено самостоятельно (по запросу «4-й пункт сам решай»):
- В чате (mobile) **не** добавляем экран «расшифровка для редактирования перед отправкой» — длинный путь, противоречит Telegram-style UX (release → send). Вместо этого правильный путь — авто-расшифровка на бэкенде и доставка админу в виде plain-текста. Уже реализовано в `_autotranscribe_voice_message`.
- В `/describe` (visitor) расшифровка **остаётся** редактируемой — текст вставляется в textarea, и пользователь явно нажимает CTA «See my product plan».
