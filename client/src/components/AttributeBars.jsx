import { useState } from 'react';

const CATEGORY_SUBS = {
  pace: ['pace_acceleration', 'pace_sprint_speed', 'pace_agility'],
  shooting: ['shoot_finishing', 'shoot_power', 'shoot_long_shots'],
  passing: ['pass_short', 'pass_long', 'pass_vision'],
  dribbling: ['dribble_control', 'dribble_balance', 'dribble_composure'],
  defending: ['defend_tackling', 'defend_marking', 'defend_interceptions'],
  physical: ['phys_strength', 'phys_stamina', 'phys_aggression'],
  goalkeeping: ['gk_reflexes', 'gk_handling', 'gk_positioning'],
};
const LABELS = {
  pace: 'Pace', shooting: 'Shooting', passing: 'Passing', dribbling: 'Dribbling',
  defending: 'Defending', physical: 'Physical', goalkeeping: 'Goalkeeping',
  pace_acceleration: 'Acceleration', pace_sprint_speed: 'Sprint Speed', pace_agility: 'Agility',
  shoot_finishing: 'Finishing', shoot_power: 'Shot Power', shoot_long_shots: 'Long Shots',
  pass_short: 'Short Passing', pass_long: 'Long Passing', pass_vision: 'Vision',
  dribble_control: 'Ball Control', dribble_balance: 'Balance', dribble_composure: 'Composure',
  defend_tackling: 'Tackling', defend_marking: 'Marking', defend_interceptions: 'Interceptions',
  phys_strength: 'Strength', phys_stamina: 'Stamina', phys_aggression: 'Aggression',
  gk_reflexes: 'Reflexes', gk_handling: 'Handling', gk_positioning: 'Positioning',
};

function barColor(v) {
  if (v >= 85) return 'bg-gold';
  if (v >= 70) return 'bg-turf';
  if (v >= 50) return 'bg-sky';
  return 'bg-crimson';
}

function Bar({ label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-chalk-dim w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-ink-soft overflow-hidden">
        <div className={`h-full ${barColor(value)}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs font-mono-tab w-7 text-right text-chalk">{value}</span>
    </div>
  );
}

export default function AttributeBars({ player, isGoalkeeper }) {
  const [open, setOpen] = useState(null);
  const categories = isGoalkeeper
    ? ['goalkeeping', 'physical', 'passing', 'defending']
    : ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];

  return (
    <div className="space-y-1.5">
      {categories.map((cat) => (
        <div key={cat}>
          <button onClick={() => setOpen(open === cat ? null : cat)} className="w-full text-left">
            <Bar label={LABELS[cat]} value={player[cat] ?? 0} />
          </button>
          {open === cat && (
            <div className="pl-4 mt-1.5 mb-2 space-y-1.5 border-l-2 border-line ml-1 animate-slide-in">
              {CATEGORY_SUBS[cat].map((sub) => (
                <Bar key={sub} label={LABELS[sub]} value={player[sub] ?? 0} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
