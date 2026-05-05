'use client';

import { useState, useEffect, useRef, memo } from 'react';
import dynamic from 'next/dynamic';
import OperatorSelector from './OperatorSelector';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

const BACKEND = 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const PAMS_NAV = [
  { id: 'operation',     label: 'Operation' },
  { id: 'utm',           label: 'UTM' },
  { id: 'layers',        label: 'Layers' },
  { id: 'connections',   label: 'Connections' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'settings',      label: 'Settings' },
];

const RESOLUTION_NAV = [
  { id: 'priority', label: 'Priority' },
  { id: 'status',   label: 'Status' },
];

const ROLE_BADGE_COLOR = {
  commander: '#ea580c',
  pilot:     '#2563eb',
  atgs:      '#0f766e',
  dispatch:  '#7c3aed',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [activeNav,     setActiveNav]     = useState('operation');
  const [operator,      setOperator]      = useState(null);
  const [regions,       setRegions]       = useState([]);
  const [events,        setEvents]        = useState([]);
  const [mission,       setMission]       = useState(null);
  const [allMissions,   setAllMissions]   = useState([]);
  const [mesh,          setMesh]          = useState(null);
  const [drones,        setDrones]        = useState([]);
  const [fireZones,     setFireZones]     = useState([]);
  const [simState,      setSimState]      = useState(null);
  const [lastOptResult,    setLastOptResult]    = useState(null);
  const [optFlash,         setOptFlash]         = useState(false);
  const [replanDegraded,   setReplanDegraded]   = useState(false);
  const [backendOk,        setBackendOk]        = useState(null);
  const [missionRequests,  setMissionRequests]  = useState([]);

  const prevBurningRef        = useRef(0);
  const lastReplanEventIdRef  = useRef(null);
  const lastOptTriggerRef     = useRef(0);
  const pollCountRef          = useRef(0);

  useEffect(() => {
    const stored = localStorage.getItem('wildfire_operator');
    if (stored) setOperator(JSON.parse(stored));
  }, []);

  function apiFetch(path, op) {
    const activeOp = op ?? operator;
    return fetch(`${BACKEND}${path}`, {
      headers: activeOp ? { 'X-Operator-ID': activeOp.id } : {},
    });
  }

  // Single unified poll: fast data every 2s, slow data every 6s (every 3rd tick)
  useEffect(() => {
    if (!operator) return;

    async function poll() {
      const isSlowTick = pollCountRef.current % 3 === 0;
      pollCountRef.current += 1;

      try {
        const promises = [
          fetch(`${BACKEND}/fires/simulation/state`),
          apiFetch('/drones/', operator),
          apiFetch('/optimizer/last-result', operator),
        ];
        if (isSlowTick) {
          promises.push(
            fetch(`${BACKEND}/regions/`),
            apiFetch('/events/?limit=10', operator),
            apiFetch('/missions/', operator),
            fetch(`${BACKEND}/mesh`),
            apiFetch('/fires/', operator),
            apiFetch('/missions/requests/', operator),
          );
        }

        const [simRes, droneRes, optRes, ...slowRes] = await Promise.all(promises);

        if (simRes.ok) {
          const data = await simRes.json();
          setSimState(data);
          const prev = prevBurningRef.current;
          const now = Date.now();
          if (data.burning_count - prev >= 15 && now - lastOptTriggerRef.current > 30_000) {
            prevBurningRef.current = data.burning_count;
            lastOptTriggerRef.current = now;
            fetch(`${BACKEND}/optimizer/run`, {
              method: 'POST',
              headers: { 'X-Operator-ID': operator.id, 'Content-Type': 'application/json' },
              body: '{}',
            }).catch(() => {});
            setOptFlash(true);
            setTimeout(() => setOptFlash(false), 2500);
          } else if (prev === 0 && data.burning_count > 0) {
            prevBurningRef.current = data.burning_count;
          }
        }
        if (droneRes.ok) setDrones(await droneRes.json());
        if (optRes.ok) setLastOptResult(await optRes.json());

        if (isSlowTick && slowRes.length > 0) {
          setBackendOk(true);
          const [regRes, evtRes, msnRes, meshRes, fzRes, mreqRes] = slowRes;
          const [regs, evts, missions, meshData, fzData] = await Promise.all([
            regRes.json(), evtRes.json(), msnRes.json(), meshRes.json(), fzRes.json(),
          ]);
          setRegions(regs);
          setEvents(evts);
          setAllMissions(missions);
          setMission(missions[0] ?? null);
          setMesh(meshData);
          setFireZones(fzData.filter(fz => fz.active !== false));
          if (mreqRes?.ok) setMissionRequests(await mreqRes.json());

          const replanEvt = evts.find(e => e.type === 'optimizer_rerun' && e.message.includes('DEGRADED COMMS'));
          if (replanEvt && replanEvt.id !== lastReplanEventIdRef.current) {
            lastReplanEventIdRef.current = replanEvt.id;
            setReplanDegraded(true);
            setTimeout(() => setReplanDegraded(false), 10_000);
          }
        }
      } catch {
        if (isSlowTick) setBackendOk(false);
      }
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [operator]);

  if (!operator) {
    return (
      <OperatorSelector
        onSelect={(op) => setOperator(op)}
      />
    );
  }

  if (backendOk === false) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-sm text-red-400" style={{ background: '#1a1a1a' }}>
        Cannot reach backend at {BACKEND} — run{' '}
        <code className="mx-1 px-1.5 py-0.5 rounded font-mono" style={{ background: '#2a1a1a' }}>
          uvicorn main:app --port 8000
        </code>
        inside <code className="mx-1 px-1.5 py-0.5 rounded font-mono" style={{ background: '#2a1a1a' }}>backend/</code>
      </div>
    );
  }

  if (!mission || !mesh) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-xs text-zinc-500" style={{ background: '#1a1a1a' }}>
        Connecting to backend…
      </div>
    );
  }

  async function refreshRequests() {
    try {
      const res = await apiFetch('/missions/requests/', operator);
      if (res.ok) setMissionRequests(await res.json());
    } catch { /* ignore */ }
  }

  function switchOperator() {
    localStorage.removeItem('wildfire_operator');
    setOperator(null);
    setMission(null);
    setMesh(null);
    setDrones([]);
    setFireZones([]);
    setSimState(null);
    setLastOptResult(null);
    setBackendOk(null);
    setMissionRequests([]);
  }

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden text-zinc-100" style={{ background: '#1a1a1a' }}>
      <StatusBar mission={mission} mesh={mesh} operator={operator} simState={simState} optFlash={optFlash} replanDegraded={replanDegraded} onSwitch={switchOperator} />
      <div className="flex-1 flex min-h-0">
        <NavRail active={activeNav} onChange={setActiveNav} />
        <OperationSetup mission={mission} operator={operator} />
        <MapView drones={drones} fireZones={fireZones} simState={simState} lastOptResult={lastOptResult} />
      </div>
      <ResolutionPanel
        regions={regions} events={events} mission={mission}
        allMissions={allMissions}
        drones={drones} operator={operator}
        simState={simState} optFlash={optFlash}
        lastOptResult={lastOptResult}
        fireZones={fireZones}
        missionRequests={missionRequests}
        onRefreshRequests={refreshRequests}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top status bar
// ---------------------------------------------------------------------------

function StatusBar({ mission, mesh, operator, simState, optFlash, replanDegraded, onSwitch }) {
  const badgeColor = ROLE_BADGE_COLOR[operator.role] ?? '#52525b';

  const commsDown    = mesh.radio !== 'ok' || mesh.pingStation !== 'ok' || mesh.network !== 'ok';
  const commsOffline = mesh.radio === 'offline' || mesh.pingStation === 'offline' || mesh.network === 'offline';

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b text-xs flex-shrink-0" style={{ borderColor: '#2a2a2a' }}>
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">Operation</span>
        <span className="font-medium">{mission.id} {mission.status}</span>
        <span className="text-zinc-500 font-mono">
          {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </span>
        <span className="px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
          style={{ background: badgeColor, color: '#fff' }}>
          {operator.role}
        </span>
        <span className="text-zinc-400">{operator.name}</span>
      </div>
      <div className="flex items-center gap-3">
        {simState && (
          <span className="font-mono text-[9px] text-zinc-500">
            SIM·T{simState.tick}
            <span className="ml-1" style={{ color: '#f97316' }}>{simState.burning_count}▲</span>
            <span className="ml-1 text-zinc-600">{simState.burnt_count}■</span>
          </span>
        )}

        {/* Comms degradation alert — yellow for warning, red+pulse for offline */}
        {commsDown && (
          <span
            className={`px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${commsOffline ? 'animate-pulse' : ''}`}
            style={{
              background: commsOffline ? '#450a0a' : '#431407',
              color:      commsOffline ? '#fca5a5' : '#fed7aa',
              border:     `1px solid ${commsOffline ? '#ef4444' : '#f97316'}`,
            }}>
            DEGRADED COMMS
          </span>
        )}

        {/* Shown for 10 s after an optimizer rerun that was flagged as degraded */}
        {replanDegraded && (
          <span className="px-2 py-0.5 rounded text-[9px] font-medium"
            style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #6366f1' }}>
            REPLANNED UNDER DEGRADED COMMS
          </span>
        )}

        {optFlash && !replanDegraded && (
          <span className="px-2 py-0.5 rounded text-[9px] font-medium animate-pulse"
            style={{ background: '#7c3aed', color: '#e9d5ff' }}>
            OPT TRIGGERED
          </span>
        )}

        <MeshDot label="radio"       status={mesh.radio} />
        <MeshDot label="pingStation" status={mesh.pingStation} />
        <MeshDot label="network"     status={mesh.network} />
        <button onClick={onSwitch}
          className="ml-2 px-2 py-0.5 rounded text-[9px] text-zinc-400 hover:text-zinc-100 transition"
          style={{ border: '1px solid #3a3a3a' }}>
          Switch
        </button>
      </div>
    </div>
  );
}

function MeshDot({ label, status }) {
  const color = { ok: 'bg-green-500', warning: 'bg-yellow-400', critical: 'bg-red-500', offline: 'bg-zinc-600' }[status] ?? 'bg-zinc-600';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Left nav rail
// ---------------------------------------------------------------------------

function NavRail({ active, onChange }) {
  return (
    <div className="w-14 border-r py-3 flex flex-col gap-3.5 items-center text-[9px] text-zinc-500 flex-shrink-0"
      style={{ background: '#141414', borderColor: '#2a2a2a' }}>
      {PAMS_NAV.map((item) => (
        <NavItem key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}
      <div className="w-8 h-px my-1.5" style={{ background: '#ea580c' }} />
      {RESOLUTION_NAV.map((item) => (
        <NavItem key={item.id} item={item} active={active === item.id}
          onClick={() => onChange(item.id)} accent="orange" />
      ))}
    </div>
  );
}

function NavItem({ item, active, onClick, accent }) {
  const isOrange = accent === 'orange';
  const iconStyle = isOrange
    ? { background: '#2a1a0a', border: '1px solid #ea580c' }
    : { background: active ? '#3f3f46' : '#2a2a2a' };
  return (
    <button onClick={onClick} className={`text-center hover:opacity-80 transition ${isOrange ? 'text-orange-500' : 'text-zinc-500'}`}>
      <div className="w-6 h-6 mx-auto mb-0.5 rounded" style={iconStyle} />
      {item.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Operation Setup panel
// ---------------------------------------------------------------------------

function Field({ label, children, mono }) {
  return (
    <div className="mb-2.5">
      <div className="text-zinc-500 mb-1">{label}</div>
      <div className={mono ? 'font-mono text-[10px]' : ''}>{children}</div>
    </div>
  );
}

function FieldInline({ label, children }) {
  return (
    <div className="flex justify-between items-center text-[10px] mb-1">
      <span className="text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

function Pill({ children }) {
  return <span className="px-2 py-0.5 rounded text-[10px]" style={{ background: '#2a2a2a' }}>{children}</span>;
}

function Toggle({ checked }) {
  return (
    <span className={`w-7 h-3.5 ${checked ? 'bg-blue-600' : 'bg-zinc-700'} rounded-full relative inline-block`}>
      <span className="absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all"
        style={{ [checked ? 'right' : 'left']: '2px' }} />
    </span>
  );
}

// MapView is dynamically imported from ./MapView.js (see top of file).

// ---------------------------------------------------------------------------
// Resolution panel — 3-column: priority | optimizer | events
// ---------------------------------------------------------------------------

const ResolutionPanel = memo(function ResolutionPanel({ regions, events, mission, allMissions, drones, operator, simState, optFlash, lastOptResult, fireZones, missionRequests, onRefreshRequests }) {
  return (
    <div className="border-t px-4 py-3 grid grid-cols-3 gap-4 flex-shrink-0"
      style={{ background: '#2a1a0a', borderColor: '#ea580c' }}>
      <PriorityFlexBlock regions={regions} mission={mission} allMissions={allMissions} simState={simState} optFlash={optFlash} />
      <OptimizerBlock lastOptResult={lastOptResult} drones={drones} operator={operator} fireZones={fireZones} missionRequests={missionRequests} onRefreshRequests={onRefreshRequests} />
      <StatusFeedBlock events={events} drones={drones} />
    </div>
  );
});

const StatusFeedBlock = memo(function StatusFeedBlock({ events, drones }) {
  const summary = drones.find(d => d.summary);
  const active    = summary ? summary.active    : drones.filter(d => d.status === 'active').length;
  const returning = summary ? summary.returning : drones.filter(d => d.status === 'returning').length;
  const idle      = summary ? summary.idle      : drones.filter(d => d.status === 'idle').length;
  const grounded  = summary ? summary.grounded  : drones.filter(d => d.status === 'grounded').length;
  const total     = summary ? summary.total     : drones.filter(d => d.id).length;

  return (
    <div>
      <SectionHeader>Fleet · mission status</SectionHeader>
      <div className="flex gap-3 mb-2 text-[10px]">
        <span><span className="font-mono" style={{ color: '#22c55e' }}>{active}</span> active</span>
        <span><span className="font-mono" style={{ color: '#3b82f6' }}>{idle}</span> idle</span>
        <span><span className="font-mono" style={{ color: '#facc15' }}>{returning}</span> rtb</span>
        <span><span className="font-mono text-zinc-500">{grounded}</span> gnd</span>
        <span className="text-zinc-600">/ {total}</span>
      </div>
      <div className="text-[10px] leading-relaxed max-h-20 overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-zinc-600">No events for your access level</div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="flex gap-2"
              style={{ color: e.type === 'optimizer_rerun' ? '#c084fc' : undefined }}>
              <span className="text-zinc-500 font-mono flex-shrink-0">{e.ts}</span>
              <span className={e.type === 'optimizer_rerun' ? '' : 'text-zinc-200'}>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

const OperationSetup = memo(function OperationSetup({ mission, operator }) {
  return (
    <div className="p-3 border-r text-[11px] flex-shrink-0" style={{ width: '210px', borderColor: '#2a2a2a' }}>
      <div className="text-zinc-400 text-[10px] mb-2">← Operation Setup</div>
      <div className="font-medium mb-3">LRZ</div>

      {mission.location ? (
        <Field label="Location" mono>
          {mission.location.lat.toFixed(4)}, {mission.location.lng.toFixed(4)}
        </Field>
      ) : (
        <Field label="Location"><span className="text-zinc-600">restricted</span></Field>
      )}

      {mission.volume && (
        <>
          <div className="font-medium mt-3 mb-2">Volume shape</div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-zinc-400">Display handles</span>
            <Toggle checked />
          </div>
          <div className="flex gap-1.5 mb-2 text-[10px]">
            <Pill>{mission.volume.width} nmi</Pill>
            <Pill>{mission.volume.height} nmi</Pill>
          </div>
          <FieldInline label="Min altitude"><Pill>{mission.volume.minAlt} ft</Pill></FieldInline>
          <FieldInline label="Max altitude"><Pill>{mission.volume.maxAlt} ft</Pill></FieldInline>
        </>
      )}

      {mission.startTime && (
        <>
          <div className="mt-3" />
          <FieldInline label="Start time"><Pill>{mission.startTime}</Pill></FieldInline>
          <FieldInline label="Duration"><Pill>{mission.duration} min</Pill></FieldInline>
        </>
      )}
    </div>
  );
});

function PriorityFlexBlock({ regions, mission, allMissions, simState, optFlash }) {
  return (
    <div>
      <SectionHeader>Priority &amp; flexibility</SectionHeader>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {regions.map((r) => <PriorityChip key={r.id} region={r} />)}
      </div>
      {mission.tightest && (
        <div className="text-[10px] text-zinc-400">
          Tightest · {mission.tightest.drone} · ±{mission.tightest.timeFlex}min · ±{mission.tightest.spatialFlex}m
        </div>
      )}

      {/* Multi-incident list */}
      {allMissions.length > 1 && (
        <div className="mt-1.5">
          <div className="text-[9px] font-mono mb-0.5" style={{ color: '#52525b' }}>
            INCIDENTS ({allMissions.length})
          </div>
          {allMissions.map(m => (
            <div key={m.id} className="flex items-center gap-2 text-[9px] font-mono mb-0.5">
              <span style={{ color: m.status === 'active' ? '#4ade80' : '#a3a3a3' }}>■</span>
              <span className="text-zinc-300">{m.id}</span>
              <span className="text-zinc-500">{m.status}</span>
              {m.location && (
                <span className="text-zinc-600 text-[8px]">
                  {m.location.lat.toFixed(3)}, {m.location.lng.toFixed(3)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {simState && (
        <div className="text-[10px] mt-1.5" style={{ color: optFlash ? '#c084fc' : '#a3a3a3' }}>
          T{simState.tick} ·{' '}
          <span style={{ color: '#f97316' }}>{simState.burning_count} burning</span>
          {' · '}
          <span className="text-zinc-500">{simState.burnt_count} burnt</span>
          {' · '}wind {simState.wind_deg}° @ {simState.wind_speed} km/h
          {optFlash && <span className="ml-2 font-medium" style={{ color: '#c084fc' }}>· OPT triggered</span>}
        </div>
      )}
    </div>
  );
}

function OptimizerBlock({ lastOptResult, drones, operator, fireZones, missionRequests, onRefreshRequests }) {
  const [benchData,    setBenchData]    = useState(null);
  const [benchLoading, setBenchLoading] = useState(false);

  const isAtgs      = operator?.role === 'atgs';
  const isPilot     = operator?.role === 'pilot';
  const isCommander = operator?.role === 'commander';
  const droneIndex = Object.fromEntries(drones.filter(d => d.id).map(d => [d.id, d]));

  async function runBenchmark() {
    setBenchLoading(true);
    setBenchData(null);
    try {
      const res = await fetch(`${BACKEND}/optimizer/benchmark`, {
        headers: { 'X-Operator-ID': operator.id },
      });
      if (res.ok) setBenchData(await res.json());
    } catch { /* ignore */ }
    setBenchLoading(false);
  }

  if (isAtgs) {
    return <AircraftSeparationPanel drones={drones} lastOptResult={lastOptResult} />;
  }

  if (isPilot) {
    return <MissionRequestPanel operator={operator} fireZones={fireZones} missionRequests={missionRequests} onRefresh={onRefreshRequests} />;
  }

  const statusColor = lastOptResult?.status === 'qubo'   ? '#22d3ee'
                    : lastOptResult?.status === 'greedy' ? '#facc15'
                    :                                      '#a3a3a3';
  const coveragePct = Math.round((lastOptResult?.totalCoverage ?? 0) * 100);

  // Compute max cost across all rows for bar scaling
  const maxCost = benchData
    ? Math.max(...benchData.rows.filter(r => !r.error).flatMap(r => [r.greedy_cost, r.qubo_cost]), 1)
    : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <SectionHeader>Deconfliction</SectionHeader>
        {isCommander && !benchData && (
          <button
            onClick={runBenchmark}
            disabled={benchLoading}
            className="text-[9px] px-2 py-0.5 rounded font-mono transition"
            style={{
              background: benchLoading ? '#1a1a2a' : '#0f172a',
              color: benchLoading ? '#52525b' : '#22d3ee',
              border: '1px solid #22d3ee',
              opacity: benchLoading ? 0.6 : 1,
            }}
          >
            {benchLoading ? 'running…' : 'QUBO scale sweep'}
          </button>
        )}
        {benchData && (
          <button
            onClick={() => setBenchData(null)}
            className="text-[9px] text-zinc-600 hover:text-zinc-400 transition"
          >
            ✕ close
          </button>
        )}
      </div>

      {/* Capability note — always visible */}
      <div className="text-[9px] mb-2 leading-relaxed" style={{ color: '#52525b' }}>
        System maintains local optimization capability under degraded or absent connectivity · GPS-denied fallback: last-known position + velocity extrapolation
      </div>

      {/* Benchmark results table */}
      {benchData && (
        <div className="mb-2">
          <div className="text-[9px] text-zinc-500 mb-0.5 font-mono">
            QUBO vs greedy · {benchData.area_m}m area · {benchData.num_alternatives} alts · {benchData.solver}
          </div>
          <div className="text-[8px] text-zinc-600 mb-1">
            QUBO cost is higher because it shifts altitude/timing to resolve conflicts — greedy ignores conflicts.
          </div>
          <table className="w-full text-[9px] font-mono border-collapse">
            <thead>
              <tr className="text-zinc-600">
                <td className="pr-1">n</td>
                <td className="pr-1">conf</td>
                <td className="pr-2" style={{ color: '#facc15' }}>greedy asgn/cost</td>
                <td style={{ color: '#22d3ee' }}>QUBO asgn/cost</td>
                <td className="pl-1 text-right">time</td>
              </tr>
            </thead>
            <tbody>
              {benchData.rows.map(r => {
                if (r.error) return (
                  <tr key={r.n_drones} className="text-red-500">
                    <td>{r.n_drones}</td>
                    <td colSpan={4}>{r.error}</td>
                  </tr>
                );
                const gBar = Math.round((r.greedy_cost / maxCost) * 28);
                const qBar = Math.round((r.qubo_cost   / maxCost) * 28);
                const quboWins = r.qubo_assigned > r.greedy_assigned || r.qubo_conflicts < r.greedy_conflicts;
                return (
                  <tr key={r.n_drones} className="border-t" style={{ borderColor: '#2a2a2a' }}>
                    <td className="py-0.5 pr-1 text-zinc-300">{r.n_drones}</td>
                    <td className="pr-1 text-zinc-500">{r.initial_conflicts}</td>
                    <td className="pr-2">
                      <span style={{ color: '#facc15' }}>{r.greedy_assigned}/{r.n_drones}</span>
                      <span className="mx-0.5 text-zinc-600">·</span>
                      <span className="text-zinc-600">{r.greedy_cost}</span>
                      <span className="ml-1 inline-block h-1.5 align-middle rounded-sm"
                        style={{ width: `${gBar}px`, background: '#713f12' }} />
                    </td>
                    <td>
                      <span style={{ color: quboWins ? '#22d3ee' : '#67e8f9' }}>{r.qubo_assigned}/{r.n_drones}</span>
                      <span className="mx-0.5 text-zinc-600">·</span>
                      <span className="text-zinc-600">{r.qubo_cost}</span>
                      <span className="ml-1 inline-block h-1.5 align-middle rounded-sm"
                        style={{ width: `${qBar}px`, background: '#164e63' }} />
                    </td>
                    <td className="pl-1 text-right text-zinc-600">{r.qubo_time_s}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Live assignment result */}
      {!benchData && (
        <>
          {(!lastOptResult || lastOptResult.status === 'idle') ? (
            <div className="text-[10px] text-zinc-600">Awaiting first optimizer run…</div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-medium"
                  style={{ background: '#0f172a', color: statusColor, border: `1px solid ${statusColor}` }}>
                  {lastOptResult.status.toUpperCase()}
                </span>
                <span className="text-[10px] font-mono" style={{ color: statusColor }}>
                  {coveragePct}% coverage
                </span>
              </div>
              <div className="text-[9px] font-mono text-zinc-500 mb-1.5 leading-tight">
                {lastOptResult.message}
              </div>
              <div className="flex flex-col gap-0.5 max-h-12 overflow-y-auto">
                {(lastOptResult.assignments ?? []).length === 0 ? (
                  <div className="text-[9px] text-zinc-600">No assignments in current cycle</div>
                ) : (
                  (lastOptResult.assignments ?? []).map(a => {
                    const d = droneIndex[a.droneId];
                    return (
                      <div key={a.droneId} className="flex items-center gap-1.5 text-[9px]">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#22c55e' }} />
                        <span className="font-mono text-zinc-300">{a.droneId}</span>
                        <span className="text-zinc-600">→</span>
                        <span className="font-mono text-orange-400">{a.fireZoneId}</span>
                        <span className="text-zinc-600 ml-auto">{a.etaMinutes.toFixed(1)}min</span>
                        {d?.battery != null && <span className="text-zinc-600">{d.battery}%</span>}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Pending mission requests — visible to commander + dispatch */}
      {(isCommander || operator?.role === 'dispatch') && missionRequests?.length > 0 && (
        <PendingRequestsQueue requests={missionRequests} operator={operator} onRefresh={onRefreshRequests} />
      )}
    </div>
  );
}

function PendingRequestsQueue({ requests, operator, onRefresh }) {
  const [acting, setActing] = useState(null);

  const pending = requests.filter(r => r.status === 'pending');

  async function act(reqId, action) {
    setActing(reqId);
    try {
      await fetch(`${BACKEND}/missions/requests/${reqId}/${action}`, {
        method: 'POST',
        headers: { 'X-Operator-ID': operator.id, 'Content-Type': 'application/json' },
        body: '{}',
      });
      onRefresh();
    } catch { /* ignore */ }
    setActing(null);
  }

  if (pending.length === 0) return null;

  return (
    <div className="mt-2 pt-2" style={{ borderTop: '1px solid #3a2a0a' }}>
      <div className="text-[9px] font-mono mb-1" style={{ color: '#ea580c' }}>
        PENDING REQUESTS ({pending.length})
      </div>
      <div className="flex flex-col gap-1 max-h-20 overflow-y-auto">
        {pending.map(r => (
          <div key={r.id} className="flex items-center gap-1 text-[9px]">
            <span className="font-mono text-zinc-400 flex-shrink-0">{r.id}</span>
            <span className="text-zinc-600 truncate flex-1">{r.notes || `${r.duration}min`}</span>
            <button
              disabled={acting === r.id}
              onClick={() => act(r.id, 'approve')}
              className="px-1.5 py-0.5 rounded font-mono flex-shrink-0"
              style={{ background: '#052e16', color: '#4ade80', border: '1px solid #166534', opacity: acting === r.id ? 0.5 : 1 }}
            >✓</button>
            <button
              disabled={acting === r.id}
              onClick={() => act(r.id, 'reject')}
              className="px-1.5 py-0.5 rounded font-mono flex-shrink-0"
              style={{ background: '#450a0a', color: '#f87171', border: '1px solid #991b1b', opacity: acting === r.id ? 0.5 : 1 }}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissionRequestPanel({ operator, fireZones, missionRequests, onRefresh }) {
  const [selectedZone, setSelectedZone] = useState('');
  const [duration,     setDuration]     = useState('30');
  const [notes,        setNotes]        = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [flash,        setFlash]        = useState(null); // 'ok' | 'err:<msg>'

  async function submit() {
    if (!selectedZone) return;
    setSubmitting(true);
    setFlash(null);
    try {
      const fz = fireZones.find(z => z.id === selectedZone);
      const body = {
        location: { lat: fz.location.lat, lng: fz.location.lng },
        volume:   { width: 0.5, height: 0.5, minAlt: 300, maxAlt: 1000 },
        duration: parseInt(duration) || 30,
        notes:    notes || null,
      };
      const res = await fetch(`${BACKEND}/missions/requests/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-ID': operator.id },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSelectedZone('');
        setDuration('30');
        setNotes('');
        setFlash('ok');
        setTimeout(() => setFlash(null), 3000);
        onRefresh();
      } else {
        const err = await res.json();
        setFlash(`err:${err.detail ?? 'Submit failed'}`);
      }
    } catch {
      setFlash('err:Network error');
    }
    setSubmitting(false);
  }

  const myRequests = (missionRequests ?? []).slice().reverse();

  const inputStyle = {
    background: '#1a1a1a', border: '1px solid #3a3a3a', color: '#e4e4e7',
    borderRadius: 3, padding: '2px 6px', fontSize: 10, width: '100%',
  };

  return (
    <div>
      <SectionHeader>Mission Request</SectionHeader>

      {/* Submit form */}
      <div className="flex flex-col gap-1 mb-2">
        <select
          value={selectedZone}
          onChange={e => setSelectedZone(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">— select fire zone —</option>
          {(fireZones ?? []).map(fz => (
            <option key={fz.id} value={fz.id}>{fz.id} · {fz.severity}</option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            type="number" min="5" max="240" value={duration}
            onChange={e => setDuration(e.target.value)}
            placeholder="duration (min)"
            style={{ ...inputStyle, width: 90 }}
          />
          <input
            type="text" value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="notes (optional)"
            style={inputStyle}
          />
        </div>
        <button
          onClick={submit}
          disabled={!selectedZone || submitting}
          className="text-[9px] px-2 py-1 rounded font-mono font-medium transition"
          style={{
            background: (!selectedZone || submitting) ? '#1a1a1a' : '#1c1917',
            color:      (!selectedZone || submitting) ? '#52525b' : '#f97316',
            border:     '1px solid #f97316',
            opacity:    (!selectedZone || submitting) ? 0.5 : 1,
            cursor:     (!selectedZone || submitting) ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'submitting…' : 'Submit Request'}
        </button>
        {flash === 'ok' && (
          <div className="text-[9px]" style={{ color: '#4ade80' }}>Request submitted successfully</div>
        )}
        {flash?.startsWith('err:') && (
          <div className="text-[9px]" style={{ color: '#f87171' }}>{flash.slice(4)}</div>
        )}
      </div>

      {/* Own request history */}
      {myRequests.length > 0 && (
        <>
          <div className="text-[9px] font-mono mb-0.5" style={{ color: '#52525b' }}>YOUR REQUESTS</div>
          <div className="flex flex-col gap-0.5 max-h-16 overflow-y-auto">
            {myRequests.map(r => {
              const statusColor = r.status === 'approved' ? '#4ade80'
                                : r.status === 'rejected' ? '#f87171'
                                :                           '#facc15';
              return (
                <div key={r.id} className="flex items-center gap-1.5 text-[9px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                  <span className="text-zinc-400">{r.id}</span>
                  <span className="text-zinc-600">{r.duration}min</span>
                  <span className="ml-auto" style={{ color: statusColor }}>{r.status}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {myRequests.length === 0 && (
        <div className="text-[9px] text-zinc-600">No requests submitted yet</div>
      )}
    </div>
  );
}

function AircraftSeparationPanel({ drones, lastOptResult }) {
  const flying = drones.filter(d => d.position && d.status !== 'grounded');

  const byPayload = {};
  for (const d of flying) {
    const p = d.payload ?? 'unknown';
    if (!byPayload[p]) byPayload[p] = [];
    byPayload[p].push(d);
  }

  const pairs = [];
  for (let i = 0; i < flying.length; i++) {
    for (let j = i + 1; j < flying.length; j++) {
      const d1 = flying[i], d2 = flying[j];
      const latM = (d1.position.lat - d2.position.lat) * 111320;
      const lngM = (d1.position.lng - d2.position.lng) * 111320 * Math.cos(Math.PI * d1.position.lat / 180);
      const horizM = Math.round(Math.sqrt(latM * latM + lngM * lngM));
      const vertFt = Math.abs((d1.position.alt ?? 0) - (d2.position.alt ?? 0));
      pairs.push({ d1, d2, horizM, vertFt });
    }
  }
  pairs.sort((a, b) => a.horizM - b.horizM);
  const top4 = pairs.slice(0, 4);
  const minSep = top4.length > 0 ? top4[0].horizM : null;

  const PAYLOAD_LABELS = {
    thermal_camera:            'thermal',
    retardant_coverage_tracker: 'retardant',
    sensor_array:              'sensor',
  };

  return (
    <div>
      <SectionHeader>Aircraft Separation Status</SectionHeader>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {Object.entries(byPayload).map(([type, arr]) => (
          <span key={type} className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ background: '#0d1f1e', color: '#5eead4', border: '1px solid #0f766e' }}>
            {arr.length} {PAYLOAD_LABELS[type] ?? type}
          </span>
        ))}
        <span className="text-[9px] text-zinc-600 font-mono">{flying.length} airborne</span>
      </div>

      {minSep !== null && (
        <div className="mb-1.5 flex items-center gap-2 text-[9px]">
          <span className="text-zinc-500">min sep:</span>
          <span className="font-mono font-medium" style={{ color: minSep < 300 ? '#f87171' : '#4ade80' }}>
            {minSep} m
          </span>
          {minSep < 300 && (
            <span className="px-1 py-0.5 rounded text-[8px] animate-pulse"
              style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #ef4444' }}>
              CONFLICT
            </span>
          )}
        </div>
      )}

      {top4.length === 0 ? (
        <div className="text-[9px] text-zinc-600">No airborne aircraft</div>
      ) : (
        <div className="flex flex-col gap-0.5 mb-1.5">
          {top4.map(({ d1, d2, horizM, vertFt }) => (
            <div key={`${d1.id}-${d2.id}`} className="flex items-center gap-1 text-[9px] font-mono">
              <span className="text-zinc-400">{d1.id}</span>
              <span className="text-zinc-600">↔</span>
              <span className="text-zinc-400">{d2.id}</span>
              <span className="ml-auto" style={{ color: horizM < 300 ? '#f87171' : '#a3a3a3' }}>
                {horizM}m
              </span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-500">{vertFt}ft↕</span>
            </div>
          ))}
        </div>
      )}

      {lastOptResult?.assignments?.length > 0 && (
        <div className="text-[9px] text-zinc-600">
          {lastOptResult.assignments.length} active assignments · {Math.round((lastOptResult.totalCoverage ?? 0) * 100)}% coverage
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-orange-500 mb-2 font-medium">
      <span className="w-1.5 h-1.5 bg-orange-600 rounded-full" />
      {children}
    </div>
  );
}

function PriorityChip({ region }) {
  const styles = {
    critical: { background: '#4a1208', color: '#fca5a5' },
    high:     { background: '#3a2a08', color: '#fde68a' },
    normal:   { background: '#1a2a18', color: '#86efac' },
  }[region.priority];
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px]" style={styles}>
      {region.name} · {region.priority} · {region.weight}x
    </span>
  );
}
