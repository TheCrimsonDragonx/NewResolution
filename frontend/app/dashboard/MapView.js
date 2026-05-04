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

function LiveLayers({ drones, fireZones, simState, lastOptResult }) {
  const map        = useMap();
  const fireRef    = useRef(null);
  const opsRef     = useRef(null);
  const canvasRef  = useRef(null);
  const initRef    = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    canvasRef.current = L.canvas({ padding: 0.5 });
    fireRef.current   = L.layerGroup().addTo(map);
    opsRef.current    = L.layerGroup().addTo(map);
  }, [map]);

  // Fire CA grid — rebuilt every 2 s when simState updates
  useEffect(() => {
    if (!simState || !fireRef.current) return;
    fireRef.current.clearLayers();
    const renderer = canvasRef.current;
    simState.cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === 0) return;
        L.rectangle(cellBounds(r, c), {
          renderer,
          stroke:      false,
          fillColor:   cell === 1 ? '#f97316' : '#57534e',
          fillOpacity: cell === 1 ? 0.72 : 0.38,
        }).addTo(fireRef.current);
      });
    });
  }, [simState]);

  // Operational layer: regions, fire zones, drones, assignment lines, manned aircraft
  useEffect(() => {
    if (!opsRef.current) return;
    opsRef.current.clearLayers();

    const assignedSet = new Set((lastOptResult?.assignments ?? []).map(a => a.droneId));
    const fzPos = {};

    // Priority region overlays
    [
      { b: [[36.518, -121.530], [36.530, -121.515]], c: '#dc2626', t: 'east · critical' },
      { b: [[36.506, -121.545], [36.520, -121.528]], c: '#facc15', t: 'mid · high'      },
      { b: [[36.500, -121.545], [36.508, -121.520]], c: '#22c55e', t: 'west · normal'   },
    ].forEach(({ b, c, t }) => {
      L.rectangle(b, {
        color: c, weight: 1, fillColor: c, fillOpacity: 0.07, dashArray: '4 3',
      }).bindTooltip(t, { sticky: true, className: 'res-tip' })
        .addTo(opsRef.current);
    });

    // Fire zone rings + permanent ID labels
    fireZones.forEach(fz => {
      if (!fz.location) return;
      fzPos[fz.id] = [fz.location.lat, fz.location.lng];
      const c = fz.severity === 'critical' ? '#ef4444'
              : fz.severity === 'high'     ? '#f97316'
              :                              '#facc15';
      L.circle([fz.location.lat, fz.location.lng], {
        radius: fz.radiusM, color: c, weight: 1.5, fillOpacity: 0.05, dashArray: '5 4',
      }).addTo(opsRef.current);
      L.circleMarker([fz.location.lat, fz.location.lng], {
        radius: 3.5, fillColor: c, fillOpacity: 1, color: c, weight: 0,
      }).bindTooltip(fz.id, { permanent: true, direction: 'top', className: 'res-label' })
        .addTo(opsRef.current);
    });

    // Assignment lines — drone → target fire zone
    (lastOptResult?.assignments ?? []).forEach(a => {
      const d  = drones.find(x => x.id === a.droneId);
      const fp = fzPos[a.fireZoneId];
      if (!d?.position || !fp) return;
      L.polyline([[d.position.lat, d.position.lng], fp], {
        color: '#22d3ee', weight: 1.2, dashArray: '5 4', opacity: 0.65,
      }).addTo(opsRef.current);
    });

    // Drones
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
        .addTo(opsRef.current);
    });

    // Manned ops corridor
    L.rectangle([[36.512, -121.545], [36.520, -121.534]], {
      color: '#fbbf24', weight: 1, fillOpacity: 0.04, dashArray: '6 4',
    }).bindTooltip('MANNED OPS CORRIDOR', { className: 'res-tip' })
      .addTo(opsRef.current);

    // Air Tanker 77
    L.marker([36.516, -121.540], { icon: T77_ICON })
      .bindTooltip('<b style="color:#fbbf24">Air Tanker 77</b><br/>Manned · On approach', {
        direction: 'top', className: 'res-tip',
      })
      .addTo(opsRef.current);

  }, [drones, fireZones, lastOptResult]);

  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function MapView({ drones, fireZones, simState, lastOptResult }) {
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
        <div style={{ color: '#404040', borderTop: '1px solid #2a2a2a', paddingTop: 3 }}>
          NASA FIRMS VIIRS NRT
        </div>
      </div>
    </div>
  );
}
