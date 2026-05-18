import { useCallback, useEffect, useState } from "react";
import { trpc } from "./trpc";

type SearchResult = Awaited<ReturnType<typeof trpc.search.query.query>>;
type EntityDetail = Awaited<ReturnType<typeof trpc.entity.get.query>>;
type Pivot = Awaited<ReturnType<typeof trpc.pivot.expand.query>>;
type Stats = Awaited<ReturnType<typeof trpc.stats.overview.query>>;
type AssetStats = Awaited<ReturnType<typeof trpc.stats.assets.query>>;
type AssetList = Awaited<ReturnType<typeof trpc.asset.list.query>>;
type Findings = Awaited<ReturnType<typeof trpc.finding.list.query>>;
type Dim = "deviceType" | "exposure" | "ownerDept" | "sourceCount";
type Filter = { dim: Dim; value: string | number; label: string };

const BAR_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];

function BarChart({
  title,
  data,
  color,
  dim,
  active,
  onSelect,
}: {
  title: string;
  data: { label: string; value: number }[];
  color: string;
  dim: Dim;
  active: Filter | null;
  onSelect: (f: Filter) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="panel chart-card">
      <div className="panel-head">
        {title}
        <span className="count">click a bar to filter</span>
      </div>
      <div className="panel-body bar-chart">
        {data.length === 0 && <div className="muted">No data.</div>}
        {data.map((d) => {
          const value: string | number =
            dim === "sourceCount" ? parseInt(d.label, 10) : d.label;
          const isActive =
            active?.dim === dim && String(active.value) === String(value);
          return (
            <button
              key={d.label}
              className={`bar-row clickable ${isActive ? "active" : ""}`}
              onClick={() => onSelect({ dim, value, label: d.label })}
              title={`Filter by ${d.label}`}
            >
              <span className="bar-label">{d.label}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${(d.value / max) * 100}%`,
                    background: isActive ? "#a5b4fc" : color,
                  }}
                />
              </span>
              <span className="bar-value">{d.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const DOMAIN_COLORS: Record<string, string> = {
  ASSET: "#3b82f6",
  USER: "#a855f7",
  VULN: "#ef4444",
  NETWORK: "#06b6d4",
  INCIDENT: "#f97316",
  RISK: "#84cc16",
};
const color = (t: string) => DOMAIN_COLORS[t] ?? "#64748b";
const Tag = ({ t }: { t: string }) => (
  <span className="tag" style={{ background: color(t) }}>
    {t}
  </span>
);

const humanize = (s: string) =>
  s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

const critColor = (n: number) =>
  n >= 80 ? "var(--crit)" : n >= 50 ? "var(--warn)" : "var(--ok)";

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

function AssetAnalytics({
  stats,
  onBack,
}: {
  stats: AssetStats | null;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AssetList | null>(null);

  const pick = useCallback((f: Filter) => {
    setPage(1);
    setFilter((cur) =>
      cur && cur.dim === f.dim && String(cur.value) === String(f.value)
        ? null // clicking the active bar again clears the filter
        : f,
    );
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    const input: any = { page, pageSize: 20 };
    if (filter) input[filter.dim] = filter.value;
    trpc.asset.list.query(input).then(setList).catch(() => setList(null));
  }, [filter, page]);

  return (
    <>
      <div className="page-head">
        <button className="back-btn" onClick={onBack}>
          ← Back to Console
        </button>
        <div>
          <h1>
            <Tag t="ASSET" /> Asset Analytics
          </h1>
          <p>Distribution and posture across the resolved asset inventory.</p>
        </div>
      </div>

      {!stats && <div className="muted">Loading asset analytics…</div>}
      {stats && (
        <>
          <div className="stat-row">
            <div className="stat-box">
              <span className="stat-num">{stats.total}</span>
              <span className="stat-cap">Golden Assets</span>
            </div>
            <div className="stat-box danger">
              <span className="stat-num">{stats.vulnerable}</span>
              <span className="stat-cap">With Vulnerabilities</span>
            </div>
            <div className="stat-box warn">
              <span className="stat-num">{stats.incidentImpacted}</span>
              <span className="stat-cap">Incident-Impacted</span>
            </div>
            <div className="stat-box ok">
              <span className="stat-num">{stats.clean}</span>
              <span className="stat-cap">No Known Findings</span>
            </div>
          </div>

          <div className="chart-grid">
            <BarChart title="Distribution by Asset Type" data={stats.charts.byType} color={BAR_COLORS[0]} dim="deviceType" active={filter} onSelect={pick} />
            <BarChart title="Distribution by Exposure Zone" data={stats.charts.byExposure} color={BAR_COLORS[1]} dim="exposure" active={filter} onSelect={pick} />
            <BarChart title="Top Owning Departments" data={stats.charts.byDept} color={BAR_COLORS[2]} dim="ownerDept" active={filter} onSelect={pick} />
            <BarChart title="Source Coverage (dedup quality)" data={stats.charts.bySourceCoverage} color={BAR_COLORS[3]} dim="sourceCount" active={filter} onSelect={pick} />
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              Raw Asset Records
              <span className="count">
                {list ? `${list.total.toLocaleString()} matching` : "loading…"}
              </span>
            </div>
            <div className="panel-body">
              <div className="filter-bar">
                {filter ? (
                  <span className="filter-chip">
                    {filter.dim} = <b>{filter.label}</b>
                    <button onClick={() => setFilter(null)} aria-label="clear filter">
                      ×
                    </button>
                  </span>
                ) : (
                  <span className="muted" style={{ padding: 0 }}>
                    Showing all assets — click any chart bar to filter.
                  </span>
                )}
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Hostname</th>
                      <th>IP</th>
                      <th>MAC</th>
                      <th>Type</th>
                      <th>Department</th>
                      <th>Exposure</th>
                      <th>Sources</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list?.rows.map((r) => (
                      <tr key={r.assetId}>
                        <td className="mono">{r.hostname}</td>
                        <td className="mono">{r.ip ?? "—"}</td>
                        <td className="mono">{r.mac ?? "—"}</td>
                        <td>{r.deviceType ?? "—"}</td>
                        <td>{r.ownerDept}</td>
                        <td>{r.exposure ?? "—"}</td>
                        <td>
                          <span className="src-badge">{r.sourceCount}</span>
                        </td>
                        <td>
                          {r.lastSeen
                            ? new Date(r.lastSeen).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                    {list && list.rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="muted">
                          No assets match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {list && list.pages > 1 && (
                <div className="pager">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    ← Prev
                  </button>
                  <span>
                    Page {list.page} of {list.pages}
                  </span>
                  <button
                    disabled={page >= list.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function App() {
  const [view, setView] = useState<"console" | "assets">("console");
  const [assetStats, setAssetStats] = useState<AssetStats | null>(null);
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [pivot, setPivot] = useState<Pivot | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async (term: string) => {
    const t = term.trim();
    if (!t) {
      // empty query: clear results, don't hit the API (avoids the
      // "string must contain at least 1 character" validation error)
      setResults(null);
      setSearched(false);
      setErr(null);
      return;
    }
    setErr(null);
    setLoading(true);
    setSearched(true);
    try {
      setResults(await trpc.search.query.query({ q: t }));
    } catch (e: any) {
      setErr(e?.message ?? "search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const openEntity = useCallback(async (nodeId: string) => {
    setSelected(nodeId);
    setActiveTab(0);
    setErr(null);
    try {
      const [d, p] = await Promise.all([
        trpc.entity.get.query({ nodeId }),
        trpc.pivot.expand.query({ nodeId, depth: 2 }),
      ]);
      setDetail(d);
      setPivot(p);
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    }
  }, []);

  const openAssets = useCallback(async () => {
    setView("assets");
    try {
      setAssetStats(await trpc.stats.assets.query());
    } catch (e: any) {
      setErr(e?.message ?? "failed to load asset analytics");
    }
  }, []);

  useEffect(() => {
    // Console starts empty — no auto-search. The KPI band and the
    // cross-domain detector findings load up front.
    trpc.stats.overview.query().then(setStats).catch(() => {});
    trpc.finding.list.query({}).then(setFindings).catch(() => {});
  }, []);

  const nodeName = (id: string) =>
    pivot?.nodes.find((n) => n.nodeId === id)?.displayName ?? id.slice(0, 8);
  const nodeType = (id: string) =>
    pivot?.nodes.find((n) => n.nodeId === id)?.entityType ?? "";

  const golden = (detail?.golden ?? {}) as Record<string, unknown>;
  const severity = String(golden.severity ?? "").toLowerCase();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🛡️</span>
          <div>
            CIP<small>Cyber Intelligence Platform</small>
          </div>
        </div>
        <div className="spacer" />
        <span className="env-badge">● LOCAL · MOCK AUTH</span>
        <div className="user">
          <span className="avatar">DA</span>
          <div>
            Security Analyst<br />
            <span style={{ color: "var(--text-faint)", fontSize: 11 }}>SOC · Tier 2</span>
          </div>
        </div>
      </header>

      <div className="content">
        {view === "assets" && (
          <AssetAnalytics stats={assetStats} onBack={() => setView("console")} />
        )}
        {view === "console" && (
        <>
        {stats && (
          <div className="kpi-band">
            <button
              className="kpi-card kpi-clickable"
              onClick={openAssets}
              title="View asset analytics"
            >
              <div className="kpi-top">
                <Tag t="ASSET" />
                <span className="kpi-label">Total Assets</span>
                <span className="kpi-go">Analytics →</span>
              </div>
              <div className="kpi-value">{stats.totals.ASSET ?? 0}</div>
              <div className="kpi-break">
                {stats.assetsByType.map((a) => (
                  <span key={a.type} className="kpi-pill">
                    {a.type} <b>{a.count}</b>
                  </span>
                ))}
              </div>
            </button>

            <div className="kpi-card">
              <div className="kpi-top">
                <Tag t="USER" />
                <span className="kpi-label">Total Identities</span>
              </div>
              <div className="kpi-value">{stats.totals.USER ?? 0}</div>
              <div className="kpi-break">
                <span className="kpi-pill ok">
                  MFA on <b>{stats.usersMfa.enabled}</b>
                </span>
                <span className="kpi-pill warn">
                  MFA off <b>{stats.usersMfa.disabled}</b>
                </span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <Tag t="VULN" />
                <span className="kpi-label">Total Vulnerabilities</span>
              </div>
              <div className="kpi-value">
                {stats.totals.VULN ?? 0}
                {stats.kevTotal > 0 && (
                  <span className="kpi-flag">{stats.kevTotal} KEV</span>
                )}
              </div>
              <div className="kpi-break">
                {stats.vulnsBySeverity.map((v) => (
                  <span
                    key={v.severity}
                    className={`kpi-pill sev-${v.severity.toLowerCase()}`}
                  >
                    {v.severity} <b>{v.count}</b>
                  </span>
                ))}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <Tag t="NETWORK" />
                <span className="kpi-label">Total Network Segments</span>
              </div>
              <div className="kpi-value">{stats.totals.NETWORK ?? 0}</div>
              <div className="kpi-break">
                <span className="kpi-pill">Segments / VLANs</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <Tag t="INCIDENT" />
                <span className="kpi-label">Total Incidents</span>
              </div>
              <div className="kpi-value">{stats.totals.INCIDENT ?? 0}</div>
              <div className="kpi-break">
                <span className="kpi-pill">Asset-linked</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <Tag t="RISK" />
                <span className="kpi-label">Total Risks</span>
              </div>
              <div className="kpi-value">{stats.totals.RISK ?? 0}</div>
              <div className="kpi-break">
                <span className="kpi-pill">Vuln-derived</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-top">
                <span className="tag" style={{ background: "#475569" }}>
                  GRAPH
                </span>
                <span className="kpi-label">Correlation Coverage</span>
              </div>
              <div className="kpi-value">{stats.edges}</div>
              <div className="kpi-break">
                <span className="kpi-pill">
                  Relationships <b>{stats.edges}</b>
                </span>
                <span className="kpi-pill">
                  Sources <b>{stats.sources}</b>
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="search-hero">
          <h1>Investigation Console</h1>
          <p>Search any entity across any domain, then drill through and pivot to triage.</p>
          <form
            className="searchbar"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(q);
            }}
          >
            <div className="search-input-wrap">
              <SearchIcon />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. jdoe · LAPTOP-JDOE-01 · CVE-2024-3094 · asmith"
              />
            </div>
            <button type="submit" disabled={loading || !q.trim()}>
              {loading ? "Searching…" : "Search"}
            </button>
          </form>
        </div>

        {err && <div className="error">⚠ {err}</div>}

        <div className="grid">
          {/* UC1 — federated results */}
          <section className="panel">
            <div className="panel-head">
              Results
              <span className="count">{results ? `${results.total} hits` : ""}</span>
            </div>
            <div className="panel-body">
              {searched && results?.domains.length === 0 && (
                <div className="muted">No matches found for “{q}”.</div>
              )}
              {results?.domains.map((d) => (
                <div key={d.entityType} className="domain">
                  <div className="domain-head">
                    <Tag t={d.entityType} />
                    <span className="num">{d.count} result{d.count !== 1 ? "s" : ""}</span>
                  </div>
                  {d.top.map((h) => (
                    <button
                      key={h.nodeId}
                      className={`hit ${selected === h.nodeId ? "active" : ""}`}
                      onClick={() => openEntity(h.nodeId)}
                    >
                      <span className="dot" style={{ background: color(d.entityType) }} />
                      <span className="name">{h.displayName}</span>
                      <span className="rank">{h.rank}</span>
                    </button>
                  ))}
                </div>
              ))}
              {!results && !searched && (
                <div className="muted">
                  Type a query above and press Search to explore entities
                  across all domains.
                </div>
              )}
            </div>
          </section>

          {/* Drill-through detail */}
          <section className="panel">
            <div className="panel-head">
              Entity Detail
              {detail && <span className="count">{detail.node.entityType}</span>}
            </div>
            <div className="panel-body">
              {!detail && <div className="muted">Select a result to drill through.</div>}
              {detail && (
                <>
                  <div className="detail-head">
                    <Tag t={detail.node.entityType} />
                    <strong>{detail.node.displayName}</strong>
                    {severity && (
                      <span className={`chip sev-${severity}`}>{severity.toUpperCase()}</span>
                    )}
                    {golden.kev === true && <span className="chip kev">KEV</span>}
                    <div className="crit-meter">
                      criticality
                      <div className="crit-bar">
                        <div
                          className="crit-fill"
                          style={{
                            width: `${detail.node.criticality}%`,
                            background: critColor(detail.node.criticality),
                          }}
                        />
                      </div>
                      <b style={{ color: critColor(detail.node.criticality) }}>
                        {detail.node.criticality}
                      </b>
                    </div>
                  </div>

                  {detail.golden && (
                    <>
                      <div className="section-label">Golden Record</div>
                      <table className="kv">
                        <tbody>
                          {Object.entries(detail.golden)
                            .filter(([, v]) => v !== null && v !== undefined && v !== "")
                            .map(([k, v]) => (
                              <tr key={k}>
                                <td>{humanize(k)}</td>
                                <td className={/id$/i.test(k) ? "mono" : ""}>{String(v)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {detail.sourceTabs.length > 0 && (
                    <>
                      <div className="section-label">
                        Source Records · {detail.sourceTabs.length} system
                        {detail.sourceTabs.length !== 1 ? "s" : ""}
                      </div>
                      <div className="tabrow">
                        {detail.sourceTabs.map((t, i) => (
                          <button
                            key={i}
                            className={i === activeTab ? "tab active" : "tab"}
                            onClick={() => setActiveTab(i)}
                          >
                            {t.tab}
                          </button>
                        ))}
                      </div>
                      <pre className="raw">
                        {JSON.stringify(detail.sourceTabs[activeTab]?.raw, null, 2)}
                      </pre>
                    </>
                  )}

                  <div className="section-label">Relationships</div>
                  <div className="rels">
                    <div className="row">
                      <b>out</b>
                      {detail.relationships.outgoing.length ? (
                        detail.relationships.outgoing.map((r) => (
                          <span key={r.edgeType} className="chip">
                            {r.edgeType} · {r.count}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "var(--text-faint)" }}>none</span>
                      )}
                    </div>
                    <div className="row">
                      <b>in</b>
                      {detail.relationships.incoming.length ? (
                        detail.relationships.incoming.map((r) => (
                          <span key={r.edgeType} className="chip">
                            {r.edgeType} · {r.count}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "var(--text-faint)" }}>none</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* UC2 — pivot subgraph */}
          <section className="panel">
            <div className="panel-head">
              Pivot Graph
              {pivot && <span className="count">depth {pivot.depth}</span>}
            </div>
            <div className="panel-body">
              {!pivot && <div className="muted">Select a result to expand its graph.</div>}
              {pivot && (
                <>
                  <div className="summary">
                    {Object.entries(pivot.summary.byType).map(([t, c]) => (
                      <span key={t} className="stat">
                        <Tag t={t} /> <b>{c}</b>
                      </span>
                    ))}
                    <span className="stat">
                      edges <b>{pivot.summary.edgeCount}</b>
                    </span>
                  </div>
                  <ul className="edges">
                    {pivot.edges.map((e) => (
                      <li key={e.edgeId} className="edge-row">
                        <button className="node" onClick={() => openEntity(e.srcNode)}>
                          <Tag t={nodeType(e.srcNode)} />
                          {nodeName(e.srcNode)}
                        </button>
                        <span className="edge-label">
                          {e.edgeType} <span className="arrow">→</span>
                        </span>
                        <button className="node" onClick={() => openEntity(e.dstNode)}>
                          <Tag t={nodeType(e.dstNode)} />
                          {nodeName(e.dstNode)}
                        </button>
                      </li>
                    ))}
                    {pivot.edges.length === 0 && (
                      <li className="muted">No connected entities.</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          </section>
        </div>

        {/* Cross-domain detector findings — exploitable conditions */}
        <section className="panel findings-panel">
          <div className="panel-head">
            Exploitable Conditions
            {findings && (
              <span className="findings-sev">
                {findings.bySeverity.CRITICAL > 0 && (
                  <span className="chip sev-critical">
                    {findings.bySeverity.CRITICAL} CRITICAL
                  </span>
                )}
                {findings.bySeverity.HIGH > 0 && (
                  <span className="chip sev-high">{findings.bySeverity.HIGH} HIGH</span>
                )}
                {findings.bySeverity.MEDIUM > 0 && (
                  <span className="chip sev-medium">{findings.bySeverity.MEDIUM} MEDIUM</span>
                )}
                <span className="count">{findings.total} total</span>
              </span>
            )}
          </div>
          <div className="panel-body">
            {!findings && <div className="muted">Loading detector findings…</div>}
            {findings && findings.items.length === 0 && (
              <div className="muted">
                No exploitable conditions detected. Re-run <code>npm run detect</code> in
                cip-database after a data refresh.
              </div>
            )}
            {findings && findings.items.length > 0 && (
              <ul className="findings-list">
                {findings.items.map((f) => {
                  const ev = f.evidence as {
                    owner?: { displayName?: string };
                    vulnerabilities?: { cve?: string | null; kev?: boolean }[];
                  };
                  const vulns = ev.vulnerabilities ?? [];
                  return (
                    <li key={f.findingId} className="finding-row">
                      <button
                        className="finding-main"
                        onClick={() => openEntity(f.primaryNode)}
                        title="Open in entity detail"
                      >
                        <span className={`chip sev-${f.severity.toLowerCase()}`}>
                          {f.severity}
                        </span>
                        <span className="finding-text">
                          <span className="finding-title">{f.title}</span>
                          <span className="finding-meta">
                            <Tag t={f.primaryType ?? "ASSET"} />
                            {f.primaryName ?? f.primaryNode.slice(0, 8)}
                            {ev.owner?.displayName && (
                              <> · owner <b>{ev.owner.displayName}</b> (no MFA)</>
                            )}
                            {vulns.length > 0 && (
                              <> · {vulns.length} exploitable vuln
                                {vulns.length !== 1 ? "s" : ""}</>
                            )}
                          </span>
                        </span>
                      </button>
                      <span className="finding-cves">
                        {vulns.slice(0, 4).map((v, i) => (
                          <span
                            key={(v.cve ?? "") + i}
                            className={`chip ${v.kev ? "kev" : ""}`}
                          >
                            {v.cve ?? "—"}
                            {v.kev ? " · KEV" : ""}
                          </span>
                        ))}
                        {vulns.length > 4 && (
                          <span className="muted">+{vulns.length - 4}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        </>
        )}
      </div>
    </div>
  );
}
