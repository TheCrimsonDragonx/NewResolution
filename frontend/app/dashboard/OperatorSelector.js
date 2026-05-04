'use client';

import { useState, useEffect } from 'react';

const BACKEND = 'http://localhost:8000';

const ROLE_STYLES = {
  commander: { badge: '#ea580c', bg: '#2a1a0a', border: '#ea580c' },
  pilot:     { badge: '#2563eb', bg: '#0a1a2a', border: '#2563eb' },
  atgs:      { badge: '#0f766e', bg: '#0d1f1e', border: '#0f766e' },
};

const ROLE_DESC = {
  commander: 'Full access — all drones, fire zones, events, and optimizer',
  pilot:     'Your assigned drone and region — partial fleet visibility',
  atgs:      'Airspace deconfliction — all aircraft separation and assignment status',
};

export default function OperatorSelector({ onSelect }) {
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BACKEND}/operators/`)
      .then((r) => r.json())
      .then((data) => { setOperators(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function select(op) {
    localStorage.setItem('wildfire_operator', JSON.stringify(op));
    onSelect(op);
  }

  return (
    <div
      className="h-screen w-screen flex flex-col items-center justify-center gap-6"
      style={{ background: '#1a1a1a' }}
    >
      <div className="text-center mb-2">
        <div className="text-[10px] text-orange-500 font-medium tracking-widest mb-1">RESOLUTION SYSTEM</div>
        <div className="text-lg font-medium text-zinc-100">Select Operator Identity</div>
        <div className="text-xs text-zinc-500 mt-1">Wildfire UAS Coordination · Salinas Test Site</div>
      </div>

      {loading ? (
        <div className="text-xs text-zinc-500">Connecting to backend…</div>
      ) : operators.length === 0 ? (
        <div className="text-xs text-red-400">Cannot reach backend at {BACKEND}</div>
      ) : (
        <div className="flex gap-4">
          {operators.map((op) => {
            const s = ROLE_STYLES[op.role] ?? ROLE_STYLES.atgs;
            return (
              <button
                key={op.id}
                onClick={() => select(op)}
                className="flex flex-col items-start gap-2 p-4 rounded-lg text-left transition hover:opacity-90"
                style={{ background: s.bg, border: `1px solid ${s.border}`, width: '200px' }}
              >
                <span
                  className="px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
                  style={{ background: s.badge, color: '#fff' }}
                >
                  {op.role}
                </span>
                <span className="text-sm font-medium text-zinc-100">{op.name}</span>
                <span className="text-[10px] text-zinc-400 leading-relaxed">{ROLE_DESC[op.role]}</span>
                <span className="text-[9px] text-zinc-600 font-mono mt-1">{op.id}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
