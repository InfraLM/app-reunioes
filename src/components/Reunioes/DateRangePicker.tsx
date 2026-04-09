import { useState } from 'react';

export type DateRange = { start: Date | null; end: Date | null };

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  onClose: () => void;
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function MonthGrid({
  year, month, rangeStart, rangeEnd, onSelect, onHover,
}: {
  year: number;
  month: number;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  onSelect: (d: Date) => void;
  onHover: (d: Date | null) => void;
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const prevDays = new Date(year, month, 0).getDate();

  const cells: { day: number; date: Date; outside: boolean }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevDays - i;
    cells.push({ day: d, date: toMidnight(new Date(year, month - 1, d)), outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: toMidnight(new Date(year, month, d)), outside: false });
  }
  for (let d = 1; cells.length < 42; d++) {
    cells.push({ day: d, date: toMidnight(new Date(year, month + 1, d)), outside: true });
  }

  return (
    <div style={{ width: 214 }}>
      <p className="text-white font-bold text-sm text-center mb-3">
        {MONTHS[month]} {year}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {WEEK_DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-zinc-600 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(({ day, date, outside }, i) => {
          const isStart = rangeStart ? isSameDay(date, rangeStart) : false;
          const isEnd = rangeEnd ? isSameDay(date, rangeEnd) : false;
          const inRange = rangeStart && rangeEnd
            ? date > rangeStart && date < rangeEnd
            : false;
          const showBand = (inRange || ((isStart || isEnd) && rangeStart && rangeEnd));

          return (
            <div
              key={i}
              className="relative h-8 flex items-center justify-center"
              onClick={() => !outside && onSelect(date)}
              onMouseEnter={() => !outside && onHover(date)}
              onMouseLeave={() => onHover(null)}
            >
              {/* Range band */}
              {showBand && (
                <div
                  className="absolute inset-y-[3px] bg-yellow-400/15 pointer-events-none"
                  style={{
                    left: isStart ? '50%' : 0,
                    right: isEnd ? '50%' : 0,
                  }}
                />
              )}
              {/* Day circle */}
              <span
                className={`relative z-10 w-7 h-7 flex items-center justify-center rounded-full text-xs select-none
                  ${outside ? 'pointer-events-none' : 'cursor-pointer'}
                  ${(isStart || isEnd)
                    ? 'bg-yellow-400 text-black font-bold'
                    : inRange
                      ? 'text-zinc-200 font-medium'
                      : outside
                        ? 'text-zinc-800'
                        : 'text-zinc-300 hover:bg-zinc-700 transition-colors'
                  }`}
              >
                {day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ value, onChange, onClose }: Props) {
  const now = new Date();

  const initLeft = (() => {
    const base = value.start ?? now;
    if (base.getMonth() === 0) return { m: 11, y: base.getFullYear() - 1 };
    return { m: base.getMonth() - 1, y: base.getFullYear() };
  })();

  const [leftYear, setLeftYear] = useState(initLeft.y);
  const [leftMonth, setLeftMonth] = useState(initLeft.m);
  const [tempStart, setTempStart] = useState<Date | null>(value.start);
  const [tempEnd, setTempEnd] = useState<Date | null>(value.end);
  const [hovered, setHovered] = useState<Date | null>(null);
  const [phase, setPhase] = useState<'start' | 'end'>(value.start && !value.end ? 'end' : 'start');

  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

  // Effective end for hover preview
  const effectiveEnd = tempEnd ?? (phase === 'end' ? hovered : null);
  const [rangeMin, rangeMax] = (() => {
    if (!tempStart || !effectiveEnd) return [tempStart, null] as [Date | null, null];
    return tempStart <= effectiveEnd
      ? [tempStart, effectiveEnd]
      : [effectiveEnd, tempStart];
  })();

  const handleSelect = (date: Date) => {
    if (phase === 'start') {
      setTempStart(date);
      setTempEnd(null);
      setPhase('end');
    } else {
      if (!tempStart) {
        setTempStart(date);
        setPhase('end');
      } else if (date < tempStart) {
        setTempEnd(tempStart);
        setTempStart(date);
        setPhase('start');
      } else {
        setTempEnd(date);
        setPhase('start');
      }
    }
  };

  const prevMonth = () => {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1); }
    else setLeftMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1); }
    else setLeftMonth(m => m + 1);
  };

  const fmt = (d: Date | null) => d ? d.toLocaleDateString('pt-BR') : '--/--/----';

  return (
    <div className="bg-[#111111] border border-zinc-800 rounded-2xl shadow-2xl p-5" style={{ width: 'max-content' }}>
      {/* Range display */}
      <div className="flex items-center justify-center gap-2.5 mb-5 px-5 py-2.5 bg-zinc-900/80 border border-zinc-800 rounded-xl">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="text-yellow-400 text-sm font-bold font-mono tabular-nums">
          {fmt(tempStart)} — {fmt(tempEnd)}
        </span>
      </div>

      {/* Calendars */}
      <div className="flex items-start gap-1">
        <button
          onClick={prevMonth}
          className="mt-6 p-1.5 text-zinc-600 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <MonthGrid
          year={leftYear} month={leftMonth}
          rangeStart={rangeMin} rangeEnd={rangeMax}
          onSelect={handleSelect} onHover={setHovered}
        />

        <div className="self-stretch w-px bg-zinc-800/60 mx-3 mt-6 flex-shrink-0" />

        <MonthGrid
          year={rightYear} month={rightMonth}
          rangeStart={rangeMin} rangeEnd={rangeMax}
          onSelect={handleSelect} onHover={setHovered}
        />

        <button
          onClick={nextMonth}
          className="mt-6 p-1.5 text-zinc-600 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center mt-5 pt-4 border-t border-zinc-800">
        <button
          onClick={() => { setTempStart(null); setTempEnd(null); setPhase('start'); }}
          className="text-zinc-500 text-sm font-medium hover:text-zinc-300 transition-colors"
        >
          Limpar
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-zinc-400 text-sm font-medium border border-zinc-800 rounded-xl hover:text-white hover:border-zinc-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => { onChange({ start: tempStart, end: tempEnd }); onClose(); }}
            className="px-5 py-2 bg-yellow-400 hover:bg-yellow-300 text-black text-sm font-bold rounded-xl transition-colors"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
