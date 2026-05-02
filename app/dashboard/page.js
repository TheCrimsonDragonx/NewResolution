// Place this file at: app/dashboard/page.js
// Then run `npm run dev` and visit http://localhost:3000/dashboard
//
// What this is:
// - PAMS-style backdrop (top status bar, left nav rail, operation setup,
// SVG map with priority zones)
// - Resolution-unique bottom panel: priority/flexibility + mission status
// - All mock data lives at the top of the file under MOCK_*
// - Phase 3: replace MOCK_* with Supabase queries (see // TODO markers)

'use client';

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Mock data — Phase 3 replaces these with Supabase queries
// ---------------------------------------------------------------------------

const PAMS_NAV = [
  { id: 'operation', label: 'Operation' },
  { id: 'utm', label: 'UTM' },
  { id: 'layers', label: 'Layers' },
  { id: 'connections', label: 'Connections' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'settings', label: 'Settings' },
];

const RESOLUTION_NAV = [
  { id: 'priority', label: 'Priority' },
  { id: 'status', label: 'Status' },
];

// TODO: fetch from supabase table `regions(id, name, priority, weight)`
const MOCK_REGIONS = [
  { id: 'east', name: 'east', priority: 'critical', weight: 10 },
  { id: 'mid', name: 'mid', priority: 'high', weight: 3 },
  { id: 'west', name: 'west', priority: 'normal', weight: 1 },
];

// TODO: fetch from supabase table `events(ts, type, message)` ordered desc, limit 5
const MOCK_EVENTS = [
  { ts: '11:09', type: 'drone_refueling', message: 'UAS-07 refueling · backup assigned' },
  { ts: '11:08', type: 'mission_completed', message: 'H-12 mission completed' },
  { ts: '11:07', type: 'priority_changed', message: 'IC priority change · east → critical' },
  { ts: '11:05', type: 'drone_disconnected', message: 'UAS-09 disconnected · last seen tracked' },
];

// TODO: fetch from supabase table `operations` joined with `missions`
const MOCK_MISSION = {
  id: 'UR31',
  status: 'active',
  startTime: '11:10',
  duration: 30,
  location: { lat: 36.5124, lng: -121.5365 },
  volume: { width: 0.67, height: 0.87, minAlt: 0, maxAlt: 1145 },
  tightest: { drone: 'UAS-04', timeFlex: 5, spatialFlex: 100 },
};

const MOCK_MESH = { radio: 'warning', pingStation: 'ok', network: 'ok' };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [activeNav, setActiveNav] = useState('operation');

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden text-zinc-100" style={{ background: '#1a1a1a' }}>
      <StatusBar mission={MOCK_MISSION} mesh={MOCK_MESH} />
      <div className="flex-1 flex min-h-0">
        <NavRail active={activeNav} onChange={setActiveNav} />
        <OperationSetup mission={MOCK_MISSION} />
        <MapView regions={MOCK_REGIONS} />
      </div>
      <ResolutionPanel regions={MOCK_REGIONS} events={MOCK_EVENTS} mission={MOCK_MISSION} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top status bar
// ---------------------------------------------------------------------------

function StatusBar({ mission, mesh }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b text-xs flex-shrink-0" style={{ borderColor: '#2a2a2a' }}>
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">Operation</span>
        <span className="font-medium">{mission.id} {mission.status}</span>
        <span className="text-zinc-500 font-mono">11:09:49</span>
      </div>
      <div className="flex items-center gap-4">
        <MeshDot label="radio" status={mesh.radio} />
        <MeshDot label="pingStation" status={mesh.pingStation} />
        <MeshDot label="network" status={mesh.network} />
      </div>
    </div>
  );
}

function MeshDot({ label, status }) {
  const color = {
    ok: 'bg-green-500',
    warning: 'bg-yellow-400',
    critical: 'bg-red-500',
    offline: 'bg-zinc-600',
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
// Operation Setup panel — hardcoded to match NASA's UR31 demo values
// ---------------------------------------------------------------------------

function OperationSetup({ mission }) {
  return (
    <div
      className="p-3 border-r text-[11px] flex-shrink-0"
      style={{ width: '210px', borderColor: '#2a2a2a' }}
    >
      <div className="text-zinc-400 text-[10px] mb-2">← Operation Setup</div>
      <div className="font-medium mb-3">LRZ</div>

      <Field label="Location" mono>
        {mission.location.lat.toFixed(4)}, {mission.location.lng.toFixed(4)}
      </Field>

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

      <div className="mt-3" />

      <FieldInline label="Start time">
        <Pill>{mission.startTime}</Pill>
      </FieldInline>
      <FieldInline label="Duration">
        <Pill>{mission.duration} min</Pill>
      </FieldInline>
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
// Map view — SVG placeholder. Phase 2 swaps in MapLibre + Esri satellite tiles.
// Salinas test site center: 36.5124, -121.5365
// ---------------------------------------------------------------------------

function MapView({ regions }) {
  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: '#243a1a' }}>
      <svg viewBox="0 0 360 320" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        <rect width="360" height="320" fill="#3a4a2a" />

        {/* Topographic contour suggestion */}
        <path d="M 0 80 Q 90 60 180 100 T 360 90" stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />
        <path d="M 0 140 Q 100 130 200 150 T 360 160" stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />
        <path d="M 0 210 Q 80 200 180 220 T 360 230" stroke="#5a6a3a" strokeWidth="1" fill="none" opacity="0.5" />

        {/* Priority zones — these will be GeoJSON polygons in Phase 2 */}
        <PriorityZone x={200} y={40} w={160} h={120} priority="critical" label="east · critical" />
        <PriorityZone x={60} y={100} w={140} h={120} priority="high" label="mid · high" />
        <PriorityZone x={0} y={220} w={200} h={100} priority="normal" label="west · normal" />

        {/* Operational volume + corner handles (matches PAMS UR31 polygon) */}
        <rect x="80" y="60" width="200" height="200" fill="none" stroke="#e5e5e5" strokeWidth="1" strokeDasharray="3 3" />
        {[
          [76, 56], [176, 56], [276, 56],
          [76, 156], [276, 156],
          [76, 256], [176, 256], [276, 256],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="8" height="8" fill="white" />
        ))}

        {/* Aircraft markers — fires (red circles) and drones (blue triangles) */}
        <circle cx="240" cy="100" r="6" fill="#dc2626" />
        <circle cx="280" cy="130" r="6" fill="#dc2626" />
        <circle cx="140" cy="180" r="6" fill="#dc2626" />
        <polygon points="160,200 165,210 155,210" fill="#3b82f6" />
        <polygon points="200,120 205,130 195,130" fill="#3b82f6" />
        <polygon points="260,150 265,160 255,160" fill="#3b82f6" />

        {/* Scale + zoom controls (decorative) */}
        <text x="320" y="305" fontSize="8" fill="#a3a3a3" fontFamily="monospace">1 nm</text>
        <rect x="335" y="280" width="14" height="14" fill="#1a1a1a" stroke="#404040" />
        <text x="342" y="291" fontSize="11" fill="#e5e5e5" textAnchor="middle">+</text>
        <rect x="335" y="296" width="14" height="14" fill="#1a1a1a" stroke="#404040" />
        <text x="342" y="307" fontSize="11" fill="#e5e5e5" textAnchor="middle">−</text>
      </svg>
    </div>
  );
}

function PriorityZone({ x, y, w, h, priority, label }) {
  const fill = { critical: '#dc2626', high: '#facc15', normal: '#22c55e' }[priority];
  const opacity = { critical: 0.1, high: 0.08, normal: 0.06 }[priority];
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
// Resolution panel — priority+flex on the left, mission status on the right
// ---------------------------------------------------------------------------

function ResolutionPanel({ regions, events, mission }) {
  return (
    <div
      className="border-t px-4 py-3 grid grid-cols-2 gap-4 flex-shrink-0"
      style={{ background: '#2a1a0a', borderColor: '#ea580c' }}
    >
      <PriorityFlexBlock regions={regions} mission={mission} />
      <StatusFeedBlock events={events} />
    </div>
  );
}

function PriorityFlexBlock({ regions, mission }) {
  return (
    <div>
      <SectionHeader>Priority &amp; flexibility</SectionHeader>

      <div className="flex gap-1.5 mb-2 text-[10px]">
        {regions.map((r) => (
          <PriorityChip key={r.id} region={r} />
        ))}
      </div>

      <div className="text-[10px] text-zinc-400">
        Tightest mission · {mission.tightest.drone} · ±{mission.tightest.timeFlex} min · ±{mission.tightest.spatialFlex}m
      </div>
      <div className="text-[10px] text-zinc-400">
        Last rerun · priority shift · 2 reassignments
      </div>
    </div>
  );
}

function StatusFeedBlock({ events }) {
  return (
    <div>
      <SectionHeader>Mission status</SectionHeader>
      <div className="text-[10px] leading-relaxed">
        {events.map((e, i) => (
          <div key={i} className="flex gap-2 text-zinc-200">
            <span className="text-zinc-500 font-mono">{e.ts}</span>
            <span>{e.message}</span>
          </div>
        ))}
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
    high: { background: '#3a2a08', color: '#fde68a' },
    normal: { background: '#1a2a18', color: '#86efac' },
  }[region.priority];
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px]" style={styles}>
      {region.name} · {region.priority} · {region.weight}x
    </span>
  );
}
