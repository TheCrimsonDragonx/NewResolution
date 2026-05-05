'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import L from 'leaflet';

// Grid constants — must match backend fire_sim.py
const LAT_MIN = 36.500, LAT_MAX = 36.530;
const LNG_MIN = -121.545, LNG_MAX = -121.515;
const ROWS = 30, COLS = 30;
const CELL_LAT = (LAT_MAX - LAT_MIN) / ROWS;
const CELL_LNG = (LNG_MAX - LNG_MIN) / COLS;
const MAP_CENTER = [(LAT_MIN + LAT_MAX) / 2, (LNG_MIN + LNG_MAX) / 2];

function cellBounds(r, c) {
  return [
    [LAT_MAX - (r + 1) * CELL_LAT, LNG_MIN + c * CELL_LNG],
    [LAT_MAX - r * CELL_LAT,       LNG_MIN + (c + 1) * CELL_LNG],
  ];
}

function makeDroneIcon(color, isAssigned) {
  const ring = isAssigned
    ? `<circle cx="9" cy="9" r="12" fill="none" stroke="${color}" stroke-width="1" opacity="0.45"/>`
    : '';
  return L.divIcon({
    html: `<svg width="18" height="18" viewBox="0 0 18 18">${ring}<polygon points="9,1 17,17 1,17" fill="${color}"/></svg>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    className: '',
  });
}

const T77_ICON = L.divIcon({
  html: `<svg width="22" height="16" viewBox="0 0 22 16"><polygon points="11,0 22,8 11,16 0,8" fill="#fbbf24"/></svg>`,
  iconSize: [22, 16],
  iconAnchor: [11, 8],
  className: '',
});

// ─── Live layer updater — must be a child of MapContainer ───────────────────

function LiveLayers({ drones, fireZones, simState, lastOptResult, missions, operator }) {
  const map           = useMap();
  const fireRef       = useRef(null);
  const volumeRef     = useRef(null);   // 4D operational volumes (above fire, below static)
  const staticRef     = useRef(null);   // slow-changing: regions, fire zones, corridor
  const dynamicRef    = useRef(null);   // fast-changing: drone markers + assignment lines
  const canvasRef     = useRef(null);
  const initRef       = useRef(false);
  const prevTickRef   = useRef(-1);
  const prevCellsRef  = useRef(null);
  const cellLayersRef = useRef(new Map());

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    canvasRef.current  = L.canvas({ padding: 0.5 });
    fireRef.current    = L.layerGroup().addTo(map);
    volumeRef.current  = L.layerGroup().addTo(map);
    staticRef.current  = L.layerGroup().addTo(map);
    dynamicRef.current = L.layerGroup().addTo(map);
  }, [map]);

  // Fire CA grid — only touch cells whose state changed since last tick
  useEffect(() => {
    if (!simState || !fireRef.current) return;
    if (simState.tick === prevTickRef.current) return;
    prevTickRef.current = simState.tick;

    const renderer  = canvasRef.current;
    const newCells  = simState.cells;
    const prevCells = prevCellsRef.current;
    const layerMap  = cellLayersRef.current;

    newCells.forEach((row, r) => {
      row.forEach((newCell, c) => {
        const prevCell = prevCells ? prevCells[r][c] : -1;
        if (newCell === prevCell) return;

        const key = `${r},${c}`;
        if (newCell === 0) {
          const layer = layerMap.get(key);
          if (layer) { fireRef.current.removeLayer(layer); layerMap.delete(key); }
        } else {
          const fillColor   = newCell === 1 ? '#f97316' : '#57534e';
          const fillOpacity = newCell === 1 ? 0.72      : 0.38;
          const existing = layerMap.get(key);
          if (existing) {
            existing.setStyle({ fillColor, fillOpacity });
          } else {
            layerMap.set(key, L.rectangle(cellBounds(r, c), {
              renderer, stroke: false, fillColor, fillOpacity,
            }).addTo(fireRef.current));
          }
        }
      });
    });

    prevCellsRef.current = newCells;
  }, [simState]);

  // 4D operational volume rectangles — rebuilds when missions list changes (~6s)
  useEffect(() => {
    if (!volumeRef.current) return;
    volumeRef.current.clearLayers();
    if (!missions || missions.length === 0) return;

    const ownDroneId = operator?.assigned_drone_id ?? null;

    missions.forEach(m => {
      if (!m.location || !m.volume) return;
      const status = (m.status || '').toLowerCase();
      if (status === 'closed') return;

      const { lat, lng } = m.location;
      const widthM  = (m.volume.width  || 0.5) * 1852;
      const heightM = (m.volume.height || 0.5) * 1852;
      const halfLat = (heightM / 2) / 111320;
      const halfLng = (widthM  / 2) / (111320 * Math.cos(lat * Math.PI / 180));

      const bounds = [
        [lat - halfLat, lng - halfLng],
        [lat + halfLat, lng + halfLng],
      ];

      const isOwn = ownDroneId ? m.tightest?.drone === ownDroneId : false;

      let color, dashArray, fillOpacity;
      if (status === 'active') {
        color = '#7c3aed'; dashArray = null; fillOpacity = 0.07;
      } else if (status === 'non_conforming') {
        color = '#f97316'; dashArray = null; fillOpacity = 0.10;
      } else if (status === 'standby' || status === 'approved') {
        color = '#3b82f6'; dashArray = '6 4'; fillOpacity = 0;
      } else {
        color = '#d4d4d8'; dashArray = '6 4'; fillOpacity = 0;
      }

      L.rectangle(bounds, {
        color,
        weight: isOwn ? 2.5 : 1.5,
        fillColor: color,
        fillOpacity,
        dashArray: dashArray ?? undefined,
      })
        .bindTooltip(
          `<b style="color:${color}">${m.id}</b><br/>${status.replace('_', ' ')} · ${m.volume.minAlt ?? 0}–${m.volume.maxAlt ?? 0} ft`,
          { sticky: true, className: 'res-tip' }
        )
        .addTo(volumeRef.current);

      // Permanent callsign label at top-left corner of volume
      L.marker([lat + halfLat, lng - halfLng], {
        icon: L.divIcon({
          html: `<span style="color:${color};font-size:9px;font-family:monospace;font-weight:${isOwn ? 700 : 500};white-space:nowrap;text-shadow:0 0 4px #000,0 0 4px #000">${m.id}</span>`,
          iconSize: [70, 14],
          iconAnchor: [0, 14],
          className: '',
        }),
      }).addTo(volumeRef.current);
    });
  }, [missions, operator]);

  // Static layer: regions, fire zones, corridor, manned aircraft — only rebuilds when fireZones changes (~6s)
  useEffect(() => {
    if (!staticRef.current) return;
    staticRef.current.clearLayers();

    // Priority region overlays
    [
      { b: [[36.518, -121.530], [36.530, -121.515]], c: '#dc2626', t: 'east · critical' },
      { b: [[36.506, -121.545], [36.520, -121.528]], c: '#facc15', t: 'mid · high'      },
      { b: [[36.500, -121.545], [36.508, -121.520]], c: '#22c55e', t: 'west · normal'   },
    ].forEach(({ b, c, t }) => {
      L.rectangle(b, {
        color: c, weight: 1, fillColor: c, fillOpacity: 0.07, dashArray: '4 3',
      }).bindTooltip(t, { sticky: true, className: 'res-tip' })
        .addTo(staticRef.current);
    });

    // Fire zone rings + permanent ID labels
    fireZones.forEach(fz => {
      if (!fz.location) return;
      const c = fz.severity === 'critical' ? '#ef4444'
              : fz.severity === 'high'     ? '#f97316'
              :                              '#facc15';
      L.circle([fz.location.lat, fz.location.lng], {
        radius: fz.radiusM, color: c, weight: 1.5, fillOpacity: 0.05, dashArray: '5 4',
      }).addTo(staticRef.current);
      L.circleMarker([fz.location.lat, fz.location.lng], {
        radius: 3.5, fillColor: c, fillOpacity: 1, color: c, weight: 0,
      }).bindTooltip(fz.id, { permanent: true, direction: 'top', className: 'res-label' })
        .addTo(staticRef.current);
    });

    // Manned ops corridor
    L.rectangle([[36.512, -121.545], [36.520, -121.534]], {
      color: '#fbbf24', weight: 1, fillOpacity: 0.04, dashArray: '6 4',
    }).bindTooltip('MANNED OPS CORRIDOR', { className: 'res-tip' })
      .addTo(staticRef.current);

    // Air Tanker 77
    L.marker([36.516, -121.540], { icon: T77_ICON })
      .bindTooltip('<b style="color:#fbbf24">Air Tanker 77</b><br/>Manned · On approach', {
        direction: 'top', className: 'res-tip',
      })
      .addTo(staticRef.current);

  }, [fireZones]);

  // Dynamic layer: drone markers + assignment lines — rebuilds every 2s with drone positions
  useEffect(() => {
    if (!dynamicRef.current) return;
    dynamicRef.current.clearLayers();

    const assignedSet = new Set((lastOptResult?.assignments ?? []).map(a => a.droneId));

    // Build fzPos index from the assignments (fire zone positions needed for lines)
    const fzPos = {};
    fireZones.forEach(fz => {
      if (fz.location) fzPos[fz.id] = [fz.location.lat, fz.location.lng];
    });

    // Assignment lines — drone → target fire zone
    (lastOptResult?.assignments ?? []).forEach(a => {
      const d  = drones.find(x => x.id === a.droneId);
      const fp = fzPos[a.fireZoneId];
      if (!d?.position || !fp) return;
      L.polyline([[d.position.lat, d.position.lng], fp], {
        color: '#22d3ee', weight: 1.2, dashArray: '5 4', opacity: 0.65,
      }).addTo(dynamicRef.current);
    });

    // Drone markers
    drones.forEach(d => {
      if (!d.position || d.status === 'grounded') return;
      const assigned = assignedSet.has(d.id);
      const c = d.status === 'returning' ? '#facc15'
              : assigned                 ? '#22c55e'
              :                            '#3b82f6';
      L.marker([d.position.lat, d.position.lng], { icon: makeDroneIcon(c, assigned) })
        .bindTooltip(
          `<b style="color:${c}">${d.id}</b><br/>${d.battery}% · ${d.status}<br/>${(d.payload || '').replace(/_/g, ' ')}`,
          { direction: 'top', className: 'res-tip' },
        )
        .addTo(dynamicRef.current);
    });

  }, [drones, lastOptResult]);

  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function MapView({ drones, fireZones, simState, lastOptResult, missions, operator }) {
  const windDeg   = simState?.wind_deg   ?? 225;
  const windSpeed = simState?.wind_speed ?? 20;
  const windRad   = (windDeg * Math.PI) / 180;
  const wx = 20 + 13 * Math.sin(windRad);
  const wy = 20 - 13 * Math.cos(windRad);

  return (
    <div className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
      <MapContainer
        center={MAP_CENTER}
        zoom={14}
        minZoom={12}
        maxZoom={18}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
          className="esri-tiles"
        />
        <LiveLayers
          drones={drones}
          fireZones={fireZones}
          simState={simState}
          lastOptResult={lastOptResult}
          missions={missions}
          operator={operator}
        />
      </MapContainer>

      {/* Wind indicator — top-right corner overlay */}
      <div className="absolute top-3 right-3 z-[1000] pointer-events-none">
        <div className="flex flex-col items-center justify-center rounded-full"
          style={{ width: 52, height: 52, background: 'rgba(0,0,0,0.65)', border: '1px solid #404040' }}>
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="1.5" fill="#f97316" />
            <line x1="20" y1="20" x2={wx} y2={wy}
              stroke="#f97316" strokeWidth="2" strokeLinecap="round" />
            <text x="20" y="36" fontSize="7" fill="#a3a3a3" textAnchor="middle" fontFamily="monospace">
              {windSpeed}km/h
            </text>
          </svg>
        </div>
      </div>

      {/* Legend — bottom-left overlay */}
      <div className="absolute bottom-6 left-2 z-[1000] pointer-events-none text-[9px] font-mono"
        style={{ background: 'rgba(0,0,0,0.72)', padding: '5px 8px', borderRadius: 4, color: '#a3a3a3' }}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#22c55e' }} />
          assigned
        </div>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#3b82f6' }} />
          idle
        </div>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#facc15' }} />
          returning
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-block" style={{
            width: 8, height: 8, background: '#fbbf24',
            clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
          }} />
          manned A/C
        </div>
        <div style={{ color: '#404040', borderTop: '1px solid #2a2a2a', marginTop: 3, paddingTop: 3 }}>
          volumes
        </div>
        <div className="flex items-center gap-1.5 mb-0.5" style={{ color: '#7c3aed' }}>
          <span className="inline-block border" style={{ width: 8, height: 5, borderColor: '#7c3aed' }} />
          active
        </div>
        <div className="flex items-center gap-1.5 mb-0.5" style={{ color: '#3b82f6' }}>
          <span className="inline-block border border-dashed" style={{ width: 8, height: 5, borderColor: '#3b82f6' }} />
          standby
        </div>
        <div className="flex items-center gap-1.5 mb-1" style={{ color: '#f97316' }}>
          <span className="inline-block border" style={{ width: 8, height: 5, borderColor: '#f97316' }} />
          non-conforming
        </div>
        <div style={{ color: '#404040', borderTop: '1px solid #2a2a2a', paddingTop: 3 }}>
          NASA FIRMS VIIRS NRT
        </div>
      </div>
    </div>
  );
}
