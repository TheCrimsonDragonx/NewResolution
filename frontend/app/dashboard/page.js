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
  observer:  '#52525b',
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

function latLngToSvg(lat, lng) {
  const x = ((lng - MAP_LNG_MIN) / (MAP_LNG_MAX - MAP_LNG_MIN)) * SVG_W;
  const y = ((MAP_LAT_MAX - lat) / (MAP_LAT_MAX - MAP_LAT_MIN)) * SVG_H;
  return [x, y];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [activeNav, setActiveNav] = useState('operation');

  const [operator,    setOperator]    = useState(null);
  const [regions,     setRegions]     = useState([]);
  const [events,      setEvents]      = useState([]);
  const [mission,     setMission]     = useState(null);
  const [mesh,        setMesh]        = useState(null);
  const [drones,      setDrones]      = useState([]);
  const [simState,    setSimState]    = useState(null);
  const [optFlash,    setOptFlash]    = useState(false);   // optimizer-triggered flash
  const [backendOk,   setBackendOk]   = useState(null);    // null=loading, true=ok, false=error

  const prevBurningRef = useRef(0);

  // Restore operator from localStorage on mount
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

  async function fetchAll(op) {
    try {
      const [regRes, evtRes, msnRes, meshRes, droneRes] = await Promise.all([
        fetch(`${BACKEND}/regions/`),
        apiFetch('/events/?limit=8', op),
        apiFetch('/missions/', op),
        fetch(`${BACKEND}/mesh`),
        apiFetch('/drones/', op),
      ]);

      const [regs, evts, missions, meshData, dronesData] = await Promise.all([
        regRes.json(),
        evtRes.json(),
        msnRes.json(),
        meshRes.json(),
        droneRes.json(),
      ]);

      setRegions(regs);
      setEvents(evts);
      setMission(missions[0] ?? null);
      setMesh(meshData);
      setDrones(dronesData);
      setBackendOk(true);
    } catch {
      setBackendOk(false);
    }
  }

  // Poll main data every 5s
  useEffect(() => {
    if (!operator) return;
    fetchAll(operator);
    const interval = setInterval(() => fetchAll(operator), 5000);
    return () => clearInterval(interval);
  }, [operator]);

  // Poll fire simulation state every 2s; auto-trigger optimizer on significant fire growth
  useEffect(() => {
    if (!operator) return;
    async function fetchSim() {
      try {
        const res = await fetch(`${BACKEND}/fires/simulation/state`);
        if (!res.ok) return;
        const data = await res.json();
        setSimState(data);

        // Auto-trigger optimizer when burning cell count grows by 15+ cells
        const prev = prevBurningRef.current;
        if (data.burning_count - prev >= 15) {
          prevBurningRef.current = data.burning_count;
          fetch(`${BACKEND}/optimizer/run`, {
            method: 'POST',
            headers: { 'X-Operator-ID': operator.id, 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => {});
          setOptFlash(true);
          setTimeout(() => setOptFlash(false), 2000);
        } else if (prev === 0 && data.burning_count > 0) {
          prevBurningRef.current = data.burning_count;
        }
      } catch { /* backend not ready yet */ }
    }
    fetchSim();
    const interval = setInterval(fetchSim, 2000);
    return () => clearInterval(interval);
  }, [operator]);

  if (!operator) {
    return (
      <OperatorSelector
        onSelect={(op) => {
          setOperator(op);
          fetchAll(op);
        }}
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
    setSimState(null);
    setBackendOk(null);
  }

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden text-zinc-100" style={{ background: '#1a1a1a' }}>
      <StatusBar mission={mission} mesh={mesh} operator={operator} simState={simState} optFlash={optFlash} onSwitch={switchOperator} />
      <div className="flex-1 flex min-h-0">
        <NavRail active={activeNav} onChange={setActiveNav} />
        <OperationSetup mission={mission} operator={operator} />
        <MapView regions={regions} drones={drones} simState={simState} />
      </div>
      <ResolutionPanel regions={regions} events={events} mission={mission} drones={drones} operator={operator} simState={simState} optFlash={optFlash} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top status bar
// ---------------------------------------------------------------------------

function StatusBar({ mission, mesh, operator, simState, optFlash, onSwitch }) {
  const badgeColor = ROLE_BADGE_COLOR[operator.role] ?? '#52525b';
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b text-xs flex-shrink-0" style={{ borderColor: '#2a2a2a' }}>
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">Operation</span>
        <span className="font-medium">{mission.id} {mission.status}</span>
        <span className="text-zinc-500 font-mono">
          {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </span>
        <span
          className="px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
          style={{ background: badgeColor, color: '#fff' }}
        >
          {operator.role}
        </span>
        <span className="text-zinc-400">{operator.name}</span>
      </div>
      <div className="flex items-center gap-4">
        {simState && (
          <span className="font-mono text-[9px] text-zinc-500">
            SIM·T{simState.tick}
            <span className="ml-1" style={{ color: '#f97316' }}>{simState.burning_count}▲</span>
            <span className="ml-1 text-zinc-600">{simState.burnt_count}■</span>
          </span>
        )}
        {optFlash && (
          <span className="px-2 py-0.5 rounded text-[9px] font-medium animate-pulse"
            style={{ background: '#7c3aed', color: '#e9d5ff' }}>
            OPT TRIGGERED
          </span>
        )}
        <MeshDot label="radio"       status={mesh.radio} />
        <MeshDot label="pingStation" status={mesh.pingStation} />
        <MeshDot label="network"     status={mesh.network} />
        <button
          onClick={onSwitch}
          className="ml-2 px-2 py-0.5 rounded text-[9px] text-zinc-400 hover:text-zinc-100 transition"
          style={{ border: '1px solid #3a3a3a' }}
        >
          Switch
        </button>
      </div>
    </div>
  );
}

function MeshDot({ label, status }) {
  const color = {
    ok:       'bg-green-500',
    warning:  'bg-yellow-400',
    critical: 'bg-red-500',
    offline:  'bg-zinc-600',
  }[status] ?? 'bg-zinc-600';
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
    <div
      className="w-14 border-r py-3 flex flex-col gap-3.5 items-center text-[9px] text-zinc-500 flex-shrink-0"
      style={{ background: '#141414', borderColor: '#2a2a2a' }}
    >
      {PAMS_NAV.map((item) => (
        <NavItem key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}
      <div className="w-8 h-px my-1.5" style={{ background: '#ea580c' }} />
      {RESOLUTION_NAV.map((item) => (
        <NavItem
          key={item.id}
          item={item}
          active={active === item.id}
          onClick={() => onChange(item.id)}
          accent="orange"
        />
      ))}
    </div>
  );
}

function NavItem({ item, active, onClick, accent }) {
  const isOrange = accent === 'orange';
  const iconStyle = isOrange
    ? { background: '#2a1a0a', border: '1px solid #ea580c' }
    : { background: active ? '#3f3f46' : '#2a2a2a' };
  const labelClass = isOrange ? 'text-orange-500' : 'text-zinc-500';
  return (
    <button onClick={onClick} className={`text-center hover:opacity-80 transition ${labelClass}`}>
      <div className="w-6 h-6 mx-auto mb-0.5 rounded" style={iconStyle} />
      {item.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Operation Setup panel
// ---------------------------------------------------------------------------

function OperationSetup({ mission, operator }) {
  const isObserver = operator.role === 'observer';
  return (
    <div
      className="p-3 border-r text-[11px] flex-shrink-0"
      style={{ width: '210px', borderColor: '#2a2a2a' }}
    >
      <div className="text-zinc-400 text-[10px] mb-2">← Operation Setup</div>
      <div className="font-medium mb-3">LRZ</div>

      {mission.location ? (
        <Field label="Location" mono>
          {mission.location.lat.toFixed(4)}, {mission.location.lng.toFixed(4)}
        </Field>
      ) : (
        <Field label="Location">
          <span className="text-zinc-600">restricted</span>
        </Field>
      )}

      {!isObserver && mission.volume && (
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

          <FieldInline label="Min altitude">
            <Pill>{mission.volume.minAlt} ft</Pill>
          </FieldInline>
          <FieldInline label="Max altitude">
            <Pill>{mission.volume.maxAlt} ft</Pill>
          </FieldInline>
        </>
      )}

      {mission.startTime && (
        <>
          <div className="mt-3" />
          <FieldInline label="Start time">
            <Pill>{mission.startTime}</Pill>
          </FieldInline>
          <FieldInline label="Duration">
            <Pill>{mission.duration} min</Pill>
          </FieldInline>
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
  return (
    <span className="px-2 py-0.5 rounded text-[10px]" style={{ background: '#2a2a2a' }}>
      {children}
    </span>
  );
}

function Toggle({ checked }) {
  return (
    <span className={`w-7 h-3.5 ${checked ? 'bg-blue-600' : 'bg-zinc-700'} rounded-full relative inline-block`}>
      <span
        className="absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all"
        style={{ [checked ? 'right' : 'left']: '2px' }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Map view
// Salinas bbox: lat 36.500–36.530, lng -121.545–-121.515
// SVG viewBox: 0 0 360 320
// ---------------------------------------------------------------------------

function MapView({ drones, simState }) {
  const CELL_W = SVG_W / 30;
  const CELL_H = SVG_H / 30;

  // Derive drone SVG positions from live data (fall back to static if no position)
  const dronePositions = drones
    .filter(d => d.position && d.status !== 'grounded')
    .map(d => {
      const [x, y] = latLngToSvg(d.position.lat, d.position.lng);
      return { ...d, svgX: x, svgY: y };
    });

  // Wind arrow direction (blowing toward)
  const windArrow = simState
    ? { deg: simState.wind_deg, speed: simState.wind_speed }
    : { deg: 225, speed: 20 };
  const windRad = (windArrow.deg * Math.PI) / 180;
  const arrowLen = 10;
  const ax = 340 + arrowLen * Math.sin(windRad);
  const ay = 18  - arrowLen * Math.cos(windRad);

  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: '#243a1a' }}>
      <svg viewBox="0 0 360 320" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        <rect width="360" height="320" fill="#3a4a2a" />

        {/* Terrain contour lines */}
        <path d="M 0 80 Q 90 60 180 100 T 360 90"   stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />
        <path d="M 0 140 Q 100 130 200 150 T 360 160" stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />
        <path d="M 0 210 Q 80 200 180 220 T 360 230" stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />

        {/* Priority zones */}
        <PriorityZone x={200} y={40}  w={160} h={120} priority="critical" label="east · critical" />
        <PriorityZone x={60}  y={100} w={140} h={120} priority="high"     label="mid · high" />
        <PriorityZone x={0}   y={220} w={200} h={100} priority="normal"   label="west · normal" />

        {/* Fire CA grid overlay */}
        {simState && simState.cells.flatMap((row, r) =>
          row.map((cell, c) => {
            if (cell === 0) return null;
            const x = c * CELL_W;
            const y = r * CELL_H;
            const fill   = cell === 1 ? '#f97316' : '#57534e';
            const opacity = cell === 1 ? 0.75 : 0.45;
            return (
              <rect key={`${r}-${c}`} x={x} y={y} width={CELL_W} height={CELL_H}
                fill={fill} opacity={opacity} />
            );
          })
        )}

        {/* Mission boundary */}
        <rect x="80" y="60" width="200" height="200" fill="none" stroke="#e5e5e5" strokeWidth="1" strokeDasharray="3 3" />
        {[
          [76, 56], [176, 56], [276, 56],
          [76, 156], [276, 156],
          [76, 256], [176, 256], [276, 256],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="8" height="8" fill="white" />
        ))}

        {/* Live drone positions */}
        {dronePositions.length > 0
          ? dronePositions.map(d => (
              <g key={d.id}>
                <polygon
                  points={`${d.svgX},${d.svgY - 7} ${d.svgX + 5},${d.svgY + 4} ${d.svgX - 5},${d.svgY + 4}`}
                  fill="#3b82f6"
                />
                <text x={d.svgX} y={d.svgY + 14} fontSize="6" fill="#93c5fd" textAnchor="middle" fontFamily="monospace">
                  {d.id}
                </text>
              </g>
            ))
          : (
            // Static fallback if no live positions
            <>
              <polygon points="160,200 165,210 155,210" fill="#3b82f6" />
              <polygon points="200,120 205,130 195,130" fill="#3b82f6" />
              <polygon points="260,150 265,160 255,160" fill="#3b82f6" />
            </>
          )
        }

        {/* Wind indicator */}
        <g>
          <circle cx="340" cy="18" r="10" fill="#1a1a1a" stroke="#404040" strokeWidth="1" opacity="0.8" />
          <line x1="340" y1="18" x2={ax} y2={ay} stroke="#f97316" strokeWidth="1.5" />
          <text x="340" y="34" fontSize="6" fill="#a3a3a3" textAnchor="middle" fontFamily="monospace">
            {windArrow.speed}km/h
          </text>
        </g>

        {/* FIRMS source badge */}
        <text x="4" y="316" fontSize="6" fill="#52525b" fontFamily="monospace">
          NASA FIRMS VIIRS NRT
        </text>

        {/* Scale / zoom controls */}
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
  const fill     = { critical: '#dc2626', high: '#facc15', normal: '#22c55e' }[priority];
  const opacity  = { critical: 0.1,       high: 0.08,      normal: 0.06     }[priority];
  const textColor = { critical: '#fca5a5', high: '#fde68a', normal: '#86efac' }[priority];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />
      <text x={x + 8} y={y + 14} fontSize="9" fill={textColor} fontFamily="sans-serif">
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Resolution panel
// ---------------------------------------------------------------------------

function ResolutionPanel({ regions, events, mission, drones, operator, simState, optFlash }) {
  return (
    <div
      className="border-t px-4 py-3 grid grid-cols-2 gap-4 flex-shrink-0"
      style={{ background: '#2a1a0a', borderColor: '#ea580c' }}
    >
      <PriorityFlexBlock regions={regions} mission={mission} drones={drones} simState={simState} optFlash={optFlash} />
      <StatusFeedBlock events={events} simState={simState} />
    </div>
  );
}

function PriorityFlexBlock({ regions, mission, drones, simState, optFlash }) {
  const fleetSummary     = drones.find((d) => d.summary);
  const individualDrones = drones.filter((d) => !d.summary);

  return (
    <div>
      <SectionHeader>Priority &amp; flexibility</SectionHeader>

      <div className="flex gap-1.5 mb-2 text-[10px]">
        {regions.map((r) => (
          <PriorityChip key={r.id} region={r} />
        ))}
      </div>

      {mission.tightest && (
        <div className="text-[10px] text-zinc-400">
          Tightest mission · {mission.tightest.drone} · ±{mission.tightest.timeFlex} min · ±{mission.tightest.spatialFlex}m
        </div>
      )}

      {simState && (
        <div className="text-[10px] mt-1" style={{ color: optFlash ? '#c084fc' : '#a3a3a3' }}>
          Fire sim tick {simState.tick} ·{' '}
          <span style={{ color: '#f97316' }}>{simState.burning_count} burning</span>
          {' · '}
          <span className="text-zinc-500">{simState.burnt_count} burnt</span>
          {' · '}wind {simState.wind_deg}° @ {simState.wind_speed} km/h
          {optFlash && <span className="ml-2 font-medium" style={{ color: '#c084fc' }}>· optimizer triggered</span>}
        </div>
      )}

      <div className="mt-2">
        <div className="text-[9px] text-zinc-500 mb-1 uppercase tracking-wide">Fleet</div>
        {fleetSummary ? (
          <div className="text-[10px] text-zinc-300">
            {fleetSummary.total} total · {fleetSummary.active} active · {fleetSummary.returning} returning · {fleetSummary.grounded} grounded
          </div>
        ) : individualDrones.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {individualDrones.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-[10px]">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: { active: '#22c55e', returning: '#facc15', grounded: '#52525b', idle: '#3b82f6' }[d.status] ?? '#52525b' }}
                />
                <span className="text-zinc-300 font-mono">{d.name ?? d.id}</span>
                <span className="text-zinc-500">{d.status}</span>
                {d.battery != null && <span className="text-zinc-600">{d.battery}%</span>}
                {d.payload        && <span className="text-zinc-600">{d.payload}</span>}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusFeedBlock({ events }) {
  return (
    <div>
      <SectionHeader>Mission status</SectionHeader>
      <div className="text-[10px] leading-relaxed max-h-24 overflow-y-auto">
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
