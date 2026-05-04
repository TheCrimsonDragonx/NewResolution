'use client';

import { useState, useEffect, useRef } from 'react';
import OperatorSelector from './OperatorSelector';

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
// Map coordinate helpers
// SVG viewBox: 0 0 360 320
// Salinas test-site bbox: lat 36.500–36.530, lng -121.545–-121.515
// ---------------------------------------------------------------------------
const MAP_LAT_MAX = 36.530;
const MAP_LAT_MIN = 36.500;
const MAP_LNG_MIN = -121.545;
const MAP_LNG_MAX = -121.515;
const SVG_W = 360;
const SVG_H = 320;

// Meters per SVG pixel (flat-earth at grid center)
const M_PER_PX_X = ((MAP_LNG_MAX - MAP_LNG_MIN) * 111320 * Math.cos(Math.PI * (MAP_LAT_MAX + MAP_LAT_MIN) / 2 / 180)) / SVG_W;
const M_PER_PX_Y = ((MAP_LAT_MAX - MAP_LAT_MIN) * 111320) / SVG_H;

function latLngToSvg(lat, lng) {
  const x = ((lng - MAP_LNG_MIN) / (MAP_LNG_MAX - MAP_LNG_MIN)) * SVG_W;
  const y = ((MAP_LAT_MAX - lat) / (MAP_LAT_MAX - MAP_LAT_MIN)) * SVG_H;
  return [x, y];
}

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
  const [lastOptResult,   setLastOptResult]   = useState(null);
  const [optFlash,        setOptFlash]        = useState(false);
  const [replanDegraded,  setReplanDegraded]  = useState(false);
  const [backendOk,       setBackendOk]       = useState(null);

  const prevBurningRef        = useRef(0);
  const lastReplanEventIdRef  = useRef(null);   // prevents re-triggering on same event

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

  // Slow poll (5s): stable data — regions, events, missions, mesh, fire zones
  async function fetchAll(op) {
    try {
      const [regRes, evtRes, msnRes, meshRes, fzRes] = await Promise.all([
        fetch(`${BACKEND}/regions/`),
        apiFetch('/events/?limit=10', op),
        apiFetch('/missions/', op),
        fetch(`${BACKEND}/mesh`),
        apiFetch('/fires/', op),
      ]);
      const [regs, evts, missions, meshData, fzData] = await Promise.all([
        regRes.json(), evtRes.json(), msnRes.json(), meshRes.json(), fzRes.json(),
      ]);
      setRegions(regs);
      setEvents(evts);
      setAllMissions(missions);
      setMission(missions[0] ?? null);
      setMesh(meshData);
      setFireZones(fzData.filter(fz => fz.active !== false));
      setBackendOk(true);

      // Check if the most recent optimizer_rerun event was flagged as degraded comms
      const replanEvt = evts.find(e => e.type === 'optimizer_rerun' && e.message.includes('DEGRADED COMMS'));
      if (replanEvt && replanEvt.id !== lastReplanEventIdRef.current) {
        lastReplanEventIdRef.current = replanEvt.id;
        setReplanDegraded(true);
        setTimeout(() => setReplanDegraded(false), 10_000);
      }
    } catch {
      setBackendOk(false);
    }
  }

  useEffect(() => {
    if (!operator) return;
    fetchAll(operator);
    const id = setInterval(() => fetchAll(operator), 5000);
    return () => clearInterval(id);
  }, [operator]);

  // Fast poll (2s): drone positions + fire simulation state
  useEffect(() => {
    if (!operator) return;
    async function fetchFast() {
      try {
        const [simRes, droneRes] = await Promise.all([
          fetch(`${BACKEND}/fires/simulation/state`),
          apiFetch('/drones/', operator),
        ]);
        if (simRes.ok) {
          const data = await simRes.json();
          setSimState(data);
          const prev = prevBurningRef.current;
          if (data.burning_count - prev >= 15) {
            prevBurningRef.current = data.burning_count;
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
      } catch { /* backend not ready */ }
    }
    fetchFast();
    const id = setInterval(fetchFast, 2000);
    return () => clearInterval(id);
  }, [operator]);

  // Optimizer poll (3s): assignments + QUBO result — all four roles
  useEffect(() => {
    if (!operator) return;
    async function fetchOpt() {
      try {
        const res = await apiFetch('/optimizer/last-result', operator);
        if (res.ok) setLastOptResult(await res.json());
      } catch { /* ignore */ }
    }
    fetchOpt();
    const id = setInterval(fetchOpt, 3000);
    return () => clearInterval(id);
  }, [operator]);

  if (!operator) {
    return (
      <OperatorSelector
        onSelect={(op) => { setOperator(op); fetchAll(op); }}
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

function OperationSetup({ mission, operator }) {
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
}

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

// ---------------------------------------------------------------------------
// Map view
// Salinas bbox: lat 36.500–36.530, lng -121.545–-121.515
// SVG viewBox: 0 0 360 320
// ---------------------------------------------------------------------------

function MapView({ drones, fireZones, simState, lastOptResult }) {
  const CELL_W = SVG_W / 30;
  const CELL_H = SVG_H / 30;

  // Index drone SVG positions (non-grounded only)
  const droneMap = {};
  const dronePositions = [];
  for (const d of drones) {
    if (!d.position || d.status === 'grounded') continue;
    const [x, y] = latLngToSvg(d.position.lat, d.position.lng);
    const entry = { ...d, svgX: x, svgY: y };
    droneMap[d.id] = entry;
    dronePositions.push(entry);
  }

  // Build set of assigned drone IDs for coloring
  const assignedDrones = new Set((lastOptResult?.assignments ?? []).map(a => a.droneId));

  // Index fire zone SVG positions
  const fzMap = {};
  for (const fz of fireZones) {
    const [x, y] = latLngToSvg(fz.location.lat, fz.location.lng);
    fzMap[fz.id] = { ...fz, svgX: x, svgY: y };
  }

  // Wind arrow
  const windDeg   = simState?.wind_deg   ?? 225;
  const windSpeed = simState?.wind_speed ?? 20;
  const windRad   = (windDeg * Math.PI) / 180;
  const ax = 340 + 10 * Math.sin(windRad);
  const ay = 18  - 10 * Math.cos(windRad);

  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: '#243a1a' }}>
      <svg viewBox="0 0 360 320" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        <rect width="360" height="320" fill="#3a4a2a" />

        {/* Terrain contour lines */}
        <path d="M 0 80 Q 90 60 180 100 T 360 90"    stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />
        <path d="M 0 140 Q 100 130 200 150 T 360 160" stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />
        <path d="M 0 210 Q 80 200 180 220 T 360 230"  stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />

        {/* Priority region overlays */}
        <PriorityZone x={200} y={40}  w={160} h={120} priority="critical" label="east · critical" />
        <PriorityZone x={60}  y={100} w={140} h={120} priority="high"     label="mid · high" />
        <PriorityZone x={0}   y={220} w={200} h={100} priority="normal"   label="west · normal" />

        {/* Fire CA grid overlay */}
        {simState && simState.cells.flatMap((row, r) =>
          row.map((cell, c) => {
            if (cell === 0) return null;
            return (
              <rect key={`${r}-${c}`}
                x={c * CELL_W} y={r * CELL_H} width={CELL_W} height={CELL_H}
                fill={cell === 1 ? '#f97316' : '#57534e'}
                opacity={cell === 1 ? 0.75 : 0.45} />
            );
          })
        )}

        {/* Fire zone rings */}
        {Object.values(fzMap).map(fz => {
          const rx = fz.radiusM / M_PER_PX_X;
          const ry = fz.radiusM / M_PER_PX_Y;
          const stroke = fz.severity === 'critical' ? '#ef4444'
                       : fz.severity === 'high'     ? '#f97316'
                       :                              '#facc15';
          return (
            <g key={fz.id}>
              <ellipse cx={fz.svgX} cy={fz.svgY} rx={rx} ry={ry}
                fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.7"
                strokeDasharray="4 3" />
              <circle cx={fz.svgX} cy={fz.svgY} r="3" fill={stroke} opacity="0.9" />
              <text x={fz.svgX} y={fz.svgY - ry - 3}
                fontSize="6" fill={stroke} textAnchor="middle" fontFamily="monospace" opacity="0.85">
                {fz.id}
              </text>
            </g>
          );
        })}

        {/* Manned aircraft layer — Air Tanker 77 on western approach */}
        <g>
          <rect x={0} y={126} width={92} height={44}
            fill="none" stroke="#fbbf24" strokeWidth={0.8} strokeDasharray="5 4" opacity={0.5} />
          <text x={3} y={136} fontSize={5.5} fill="#fbbf24" fontFamily="monospace" opacity={0.65}>
            MANNED OPS CORRIDOR
          </text>
          {/* Wide diamond — fixed-wing silhouette, distinct from UAS triangles */}
          <polygon points="48,144 58,148 48,152 38,148" fill="#fbbf24" opacity={0.9} />
          <text x={48} y={161} fontSize={5} fill="#fbbf24" textAnchor="middle" fontFamily="monospace">
            AIR TANKER 77
          </text>
        </g>

        {/* Assignment lines: drone → target fire zone */}
        {(lastOptResult?.assignments ?? []).map(a => {
          const d  = droneMap[a.droneId];
          const fz = fzMap[a.fireZoneId];
          if (!d || !fz) return null;
          return (
            <line key={`assign-${a.droneId}`}
              x1={d.svgX}  y1={d.svgY}
              x2={fz.svgX} y2={fz.svgY}
              stroke="#22d3ee" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
          );
        })}

        {/* Mission boundary */}
        <rect x="80" y="60" width="200" height="200" fill="none" stroke="#e5e5e5" strokeWidth="1" strokeDasharray="3 3" />
        {[[76,56],[176,56],[276,56],[76,156],[276,156],[76,256],[176,256],[276,256]].map(([x,y],i) => (
          <rect key={i} x={x} y={y} width="8" height="8" fill="white" />
        ))}

        {/* Live drone icons — color by status/assignment */}
        {dronePositions.map(d => {
          const isAssigned = assignedDrones.has(d.id);
          const fill = d.status === 'returning' ? '#facc15'
                     : isAssigned               ? '#22c55e'
                     :                            '#3b82f6';
          return (
            <g key={d.id}>
              {/* Pulse ring for assigned+active drones */}
              {isAssigned && (
                <circle cx={d.svgX} cy={d.svgY} r="9" fill="none"
                  stroke="#22c55e" strokeWidth="0.8" opacity="0.4" />
              )}
              <polygon
                points={`${d.svgX},${d.svgY - 7} ${d.svgX + 5},${d.svgY + 4} ${d.svgX - 5},${d.svgY + 4}`}
                fill={fill} />
              <text x={d.svgX} y={d.svgY + 14} fontSize="5.5"
                fill={fill} textAnchor="middle" fontFamily="monospace" opacity="0.9">
                {d.id}
              </text>
            </g>
          );
        })}

        {/* Wind indicator */}
        <g>
          <circle cx="340" cy="18" r="10" fill="#1a1a1a" stroke="#404040" strokeWidth="1" opacity="0.8" />
          <line x1="340" y1="18" x2={ax} y2={ay} stroke="#f97316" strokeWidth="1.5" />
          <text x="340" y="34" fontSize="6" fill="#a3a3a3" textAnchor="middle" fontFamily="monospace">
            {windSpeed}km/h
          </text>
        </g>

        {/* Legend */}
        <g>
          <circle cx="8"  cy="308" r="3" fill="#22c55e" />
          <text x="14" y="311" fontSize="5.5" fill="#a3a3a3" fontFamily="monospace">assigned</text>
          <circle cx="50" cy="308" r="3" fill="#3b82f6" />
          <text x="56" y="311" fontSize="5.5" fill="#a3a3a3" fontFamily="monospace">idle</text>
          <circle cx="74" cy="308" r="3" fill="#facc15" />
          <text x="80" y="311" fontSize="5.5" fill="#a3a3a3" fontFamily="monospace">returning</text>
          <polygon points="120,305 126,308 120,311 114,308" fill="#fbbf24" />
          <text x="129" y="311" fontSize="5.5" fill="#a3a3a3" fontFamily="monospace">manned</text>
        </g>

        {/* FIRMS badge */}
        <text x="4" y="320" fontSize="5.5" fill="#52525b" fontFamily="monospace">NASA FIRMS VIIRS NRT</text>

        {/* Scale / zoom */}
        <text x="308" y="305" fontSize="8" fill="#a3a3a3" fontFamily="monospace">1 nm</text>
        <rect x="323" y="280" width="14" height="14" fill="#1a1a1a" stroke="#404040" />
        <text x="330" y="291" fontSize="11" fill="#e5e5e5" textAnchor="middle">+</text>
        <rect x="323" y="296" width="14" height="14" fill="#1a1a1a" stroke="#404040" />
        <text x="330" y="307" fontSize="11" fill="#e5e5e5" textAnchor="middle">−</text>
      </svg>
    </div>
  );
}

function PriorityZone({ x, y, w, h, priority, label }) {
  const fill      = { critical: '#dc2626', high: '#facc15', normal: '#22c55e' }[priority];
  const opacity   = { critical: 0.1,       high: 0.08,      normal: 0.06     }[priority];
  const textColor = { critical: '#fca5a5', high: '#fde68a', normal: '#86efac' }[priority];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />
      <text x={x + 8} y={y + 14} fontSize="9" fill={textColor} fontFamily="sans-serif">{label}</text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Resolution panel — 3-column: priority | optimizer | events
// ---------------------------------------------------------------------------

function ResolutionPanel({ regions, events, mission, allMissions, drones, operator, simState, optFlash, lastOptResult }) {
  return (
    <div className="border-t px-4 py-3 grid grid-cols-3 gap-4 flex-shrink-0"
      style={{ background: '#2a1a0a', borderColor: '#ea580c' }}>
      <PriorityFlexBlock regions={regions} mission={mission} allMissions={allMissions} simState={simState} optFlash={optFlash} />
      <OptimizerBlock lastOptResult={lastOptResult} drones={drones} operator={operator} />
      <StatusFeedBlock events={events} drones={drones} />
    </div>
  );
}

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

function OptimizerBlock({ lastOptResult, drones, operator }) {
  const [benchData,    setBenchData]    = useState(null);
  const [benchLoading, setBenchLoading] = useState(false);

  const isAtgs = operator?.role === 'atgs';
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
              <div className="flex flex-col gap-0.5 max-h-16 overflow-y-auto">
                {(lastOptResult.assignments ?? []).length === 0 ? (
                  <div className="text-[9px] text-zinc-600">
                    {operator.role === 'pilot'
                      ? 'Your drone is not assigned in the current cycle — another asset was prioritized'
                      : 'No assignments in current cycle'}
                  </div>
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

function StatusFeedBlock({ events, drones }) {
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
