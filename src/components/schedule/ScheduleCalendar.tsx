/**
 * Schedule Calendar — visualizes program schedules in Day/Week/Month views.
 * Parses D2D trigger XML to extract schedule timing, displays programs
 * on a calendar grid with sunrise/sunset markers.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Sunset,
  Sunrise,
  Clock,
  Zap,
  Play,
} from 'lucide-react';
import { useProgramStore } from '@/stores/program-store.ts';
import type { D2DTrigger } from '@/api/types.ts';

// ─── Types ──────────────────────────────────────────────────────

type ViewMode = 'day' | 'week' | 'month';

interface ScheduleInfo {
  type: 'time' | 'sunset' | 'sunrise' | 'range' | 'event-only';
  time?: number;
  fromTime?: number;
  toTime?: number;
  sunsetOffset?: number;
  sunriseOffset?: number;
  daysOfWeek?: string[];
  label: string;
}

interface ScheduledProgram {
  programId: string;
  name: string;
  enabled: boolean;
  running: boolean;
  schedule: ScheduleInfo;
  ifSummary: string;
  trigger?: D2DTrigger;
}

// ─── Constants ──────────────────────────────────────────────────

/** Default sunrise/sunset in seconds from midnight */
const DEFAULT_SUNRISE = 6.5 * 3600; // 6:30 AM
const DEFAULT_SUNSET = 18 * 3600;   // 6:00 PM

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DOW_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Color palette for program blocks — hashed from name */
const PROGRAM_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300', border: 'border-emerald-300 dark:border-emerald-700' },
  { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-800 dark:text-violet-300', border: 'border-violet-300 dark:border-violet-700' },
  { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700' },
  { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300', border: 'border-rose-300 dark:border-rose-700' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/40', text: 'text-cyan-800 dark:text-cyan-300', border: 'border-cyan-300 dark:border-cyan-700' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-300', border: 'border-orange-300 dark:border-orange-700' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-800 dark:text-indigo-300', border: 'border-indigo-300 dark:border-indigo-700' },
  { bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-800 dark:text-teal-300', border: 'border-teal-300 dark:border-teal-700' },
  { bg: 'bg-pink-100 dark:bg-pink-900/40', text: 'text-pink-800 dark:text-pink-300', border: 'border-pink-300 dark:border-pink-700' },
];

const DISABLED_COLOR = {
  bg: 'bg-gray-100 dark:bg-gray-800/60',
  text: 'text-gray-500 dark:text-gray-400',
  border: 'border-gray-300 dark:border-gray-600',
};

// ─── Helpers ────────────────────────────────────────────────────

/** Simple string hash for consistent color assignment */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getColorForProgram(name: string, enabled: boolean) {
  if (!enabled) return DISABLED_COLOR;
  return PROGRAM_COLORS[hashString(name) % PROGRAM_COLORS.length]!;
}

/** Convert seconds from midnight to "h:mm AM/PM" */
function formatTime(seconds: number): string {
  const totalMins = Math.floor(seconds / 60);
  const hrs = Math.floor(totalMins / 60) % 24;
  const mins = totalMins % 60;
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  const h12 = hrs === 0 ? 12 : hrs > 12 ? hrs - 12 : hrs;
  return `${h12}:${mins.toString().padStart(2, '0')} ${ampm}`;
}

/** Convert seconds from midnight to hour fraction (e.g., 7.5 for 7:30 AM) */
function secondsToHourFraction(seconds: number): number {
  return seconds / 3600;
}

/** Check if a date is today */
function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

/** Get all days in a month as a grid (including leading/trailing days from adjacent months) */
function getMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const gridStart = new Date(year, month, 1 - startDow);

  const weeks: Date[][] = [];
  const current = new Date(gridStart);

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    // Stop if the next week is entirely in the next month
    if (current.getMonth() !== month && current.getDay() === 0) break;
  }

  return weeks;
}

/** Get week start (Sunday) for a given date */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get 7 days starting from a date */
function getWeekDays(start: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

// ─── Schedule Parsing ───────────────────────────────────────────

/**
 * Extract schedule information from D2D IF XML.
 * Returns an array because a single IF block can have multiple schedule conditions.
 */
function extractSchedules(ifXml: string | undefined): ScheduleInfo[] {
  if (!ifXml) return [];

  const schedules: ScheduleInfo[] = [];
  const scheduleBlocks = ifXml.match(/<schedule>([\s\S]*?)<\/schedule>/g);

  if (!scheduleBlocks || scheduleBlocks.length === 0) {
    return [{ type: 'event-only', label: 'Event-triggered' }];
  }

  for (const block of scheduleBlocks) {
    const inner = block.replace(/<\/?schedule>/g, '');

    // Parse days of week
    let daysOfWeek: string[] | undefined;
    const dowMatch = inner.match(/<daysofweek>([\s\S]*?)<\/daysofweek>/);
    if (dowMatch) {
      daysOfWeek = [];
      if (/<mon\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('mon');
      if (/<tue\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('tue');
      if (/<wed\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('wed');
      if (/<thu\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('thu');
      if (/<fri\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('fri');
      if (/<sat\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('sat');
      if (/<sun\s*\/?>/.test(dowMatch[1]!)) daysOfWeek.push('sun');
    }

    // Parse from/to (range)
    const fromMatch = inner.match(/<from>([\s\S]*?)<\/from>/);
    const toMatch = inner.match(/<to>([\s\S]*?)<\/to>/);
    const atMatch = inner.match(/<at>([\s\S]*?)<\/at>/);

    if (fromMatch && toMatch) {
      const fromInfo = parseTimeComponent(fromMatch[1]!);
      const toInfo = parseTimeComponent(toMatch[1]!);

      schedules.push({
        type: 'range',
        fromTime: fromInfo.seconds,
        toTime: toInfo.seconds,
        sunsetOffset: fromInfo.sunsetOffset ?? toInfo.sunsetOffset,
        sunriseOffset: fromInfo.sunriseOffset ?? toInfo.sunriseOffset,
        daysOfWeek,
        label: `${fromInfo.label} to ${toInfo.label}`,
      });
    } else if (atMatch) {
      const atInfo = parseTimeComponent(atMatch[1]!);

      if (atInfo.isSunset) {
        schedules.push({
          type: 'sunset',
          time: atInfo.seconds,
          sunsetOffset: atInfo.sunsetOffset ?? 0,
          daysOfWeek,
          label: atInfo.label,
        });
      } else if (atInfo.isSunrise) {
        schedules.push({
          type: 'sunrise',
          time: atInfo.seconds,
          sunriseOffset: atInfo.sunriseOffset ?? 0,
          daysOfWeek,
          label: atInfo.label,
        });
      } else {
        schedules.push({
          type: 'time',
          time: atInfo.seconds,
          daysOfWeek,
          label: atInfo.label,
        });
      }
    }
  }

  if (schedules.length === 0) {
    return [{ type: 'event-only', label: 'Event-triggered' }];
  }

  return schedules;
}

/** Parse a time component (inside <from>, <to>, or <at>) */
function parseTimeComponent(xml: string): {
  seconds: number;
  label: string;
  isSunset?: boolean;
  isSunrise?: boolean;
  sunsetOffset?: number;
  sunriseOffset?: number;
} {
  // Check for sunset
  const sunsetMatch = xml.match(/<sunset>(-?\d+)<\/sunset>/);
  if (sunsetMatch) {
    const offset = parseInt(sunsetMatch[1]!, 10);
    const seconds = DEFAULT_SUNSET + offset * 60;
    let label = 'Sunset';
    if (offset > 0) label = `Sunset +${offset}min`;
    else if (offset < 0) label = `Sunset ${offset}min`;
    return { seconds, label, isSunset: true, sunsetOffset: offset };
  }

  // Check for sunrise
  const sunriseMatch = xml.match(/<sunrise>(-?\d+)<\/sunrise>/);
  if (sunriseMatch) {
    const offset = parseInt(sunriseMatch[1]!, 10);
    const seconds = DEFAULT_SUNRISE + offset * 60;
    let label = 'Sunrise';
    if (offset > 0) label = `Sunrise +${offset}min`;
    else if (offset < 0) label = `Sunrise ${offset}min`;
    return { seconds, label, isSunrise: true, sunriseOffset: offset };
  }

  // Check for specific time
  const timeMatch = xml.match(/<time>(\d+)<\/time>/);
  if (timeMatch) {
    const seconds = parseInt(timeMatch[1]!, 10);
    return { seconds, label: formatTime(seconds) };
  }

  return { seconds: 0, label: '?' };
}

/** Build a short IF condition summary from D2D XML */
function buildIfSummary(ifXml: string | undefined): string {
  if (!ifXml) return 'No conditions';

  const parts: string[] = [];

  // Schedules
  const scheduleMatches = ifXml.match(/<schedule>[\s\S]*?<\/schedule>/g);
  if (scheduleMatches) {
    for (const sm of scheduleMatches) {
      const atTime = sm.match(/<time>(\d+)<\/time>/);
      const sunset = sm.match(/<sunset>(-?\d+)<\/sunset>/);
      const sunrise = sm.match(/<sunrise>(-?\d+)<\/sunrise>/);
      if (atTime) parts.push(`At ${formatTime(parseInt(atTime[1]!, 10))}`);
      else if (sunset) {
        const off = parseInt(sunset[1]!, 10);
        parts.push(off === 0 ? 'At Sunset' : `Sunset ${off > 0 ? '+' : ''}${off}min`);
      } else if (sunrise) {
        const off = parseInt(sunrise[1]!, 10);
        parts.push(off === 0 ? 'At Sunrise' : `Sunrise ${off > 0 ? '+' : ''}${off}min`);
      }
    }
  }

  // Control triggers
  const controlMatches = ifXml.match(/<control[^>]*\/>/g);
  if (controlMatches) {
    parts.push(`${controlMatches.length} device trigger${controlMatches.length > 1 ? 's' : ''}`);
  }

  // Status conditions
  const statusMatches = ifXml.match(/<status[^>]*>/g);
  if (statusMatches) {
    parts.push(`${statusMatches.length} status check${statusMatches.length > 1 ? 's' : ''}`);
  }

  return parts.length > 0 ? parts.join('; ') : 'Complex condition';
}

/** Check if a scheduled program should appear on a given day of week (0=Sun..6=Sat) */
function appliesToDayOfWeek(schedule: ScheduleInfo, dayOfWeek: number): boolean {
  if (!schedule.daysOfWeek || schedule.daysOfWeek.length === 0) return true;
  return schedule.daysOfWeek.some((d) => DOW_MAP[d] === dayOfWeek);
}

/** Get the display time (in seconds from midnight) for a scheduled program */
function getDisplayTime(schedule: ScheduleInfo): number {
  if (schedule.type === 'time' && schedule.time != null) return schedule.time;
  if (schedule.type === 'sunset') return schedule.time ?? DEFAULT_SUNSET;
  if (schedule.type === 'sunrise') return schedule.time ?? DEFAULT_SUNRISE;
  if (schedule.type === 'range' && schedule.fromTime != null) return schedule.fromTime;
  return 0;
}

/** Get the display end time for range schedules */
function getDisplayEndTime(schedule: ScheduleInfo): number | undefined {
  if (schedule.type === 'range' && schedule.toTime != null) return schedule.toTime;
  return undefined;
}

// ─── Overlap Layout Algorithm ───────────────────────────────────

/**
 * Compute side-by-side column positions for overlapping events.
 *
 * Uses a greedy column assignment + union-find to identify overlap groups,
 * so each event gets a column index and knows how many total columns its
 * group has. The caller uses these to set width = 1/totalColumns and
 * left = column/totalColumns.
 */
function computeOverlapLayout(
  programs: ScheduledProgram[],
): Map<number, { column: number; totalColumns: number }> {
  if (programs.length === 0) return new Map();

  // Build time ranges with original indices
  const ranges = programs.map((sp, i) => {
    const start = getDisplayTime(sp.schedule);
    const end = getDisplayEndTime(sp.schedule) ?? (start + 1800); // 30 min default
    return { idx: i, start, end: Math.max(end, start + 600) }; // min 10 min for overlap detection
  });

  // Sort by start time
  ranges.sort((a, b) => a.start - b.start);

  // Greedy column assignment: place each event in the first column that's free
  const colMap = new Map<number, number>(); // idx → column
  const colEndTimes: number[] = []; // earliest end time per column

  for (const r of ranges) {
    let col = -1;
    for (let c = 0; c < colEndTimes.length; c++) {
      if (colEndTimes[c]! <= r.start) { col = c; break; }
    }
    if (col === -1) { col = colEndTimes.length; colEndTimes.push(0); }
    colMap.set(r.idx, col);
    colEndTimes[col] = r.end;
  }

  // Union-find to group transitively overlapping events
  const parent = new Map<number, number>();
  for (const r of ranges) parent.set(r.idx, r.idx);

  function find(x: number): number {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: number, b: number) { parent.set(find(a), find(b)); }

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[j]!.start < ranges[i]!.end) {
        union(ranges[i]!.idx, ranges[j]!.idx);
      } else break; // sorted — no further overlaps possible
    }
  }

  // Max column per overlap group → totalColumns for each event
  const groupMaxCol = new Map<number, number>();
  for (const r of ranges) {
    const root = find(r.idx);
    const col = colMap.get(r.idx) ?? 0;
    groupMaxCol.set(root, Math.max(groupMaxCol.get(root) ?? 0, col));
  }

  const result = new Map<number, { column: number; totalColumns: number }>();
  for (const r of ranges) {
    result.set(r.idx, {
      column: colMap.get(r.idx) ?? 0,
      totalColumns: (groupMaxCol.get(find(r.idx)) ?? 0) + 1,
    });
  }

  return result;
}

/**
 * Compute visible hour range from event data.
 * Returns a start/end hour (clamped 0-24) that covers all events
 * with 1-hour padding, avoiding empty dead space.
 */
function computeVisibleHours(
  programs: ScheduledProgram[],
  dow?: number,
): { startHour: number; endHour: number } {
  const relevant = dow !== undefined
    ? programs.filter((sp) => appliesToDayOfWeek(sp.schedule, dow) && sp.schedule.type !== 'event-only')
    : programs.filter((sp) => sp.schedule.type !== 'event-only');

  if (relevant.length === 0) return { startHour: 6, endHour: 22 };

  let minSeconds = Infinity;
  let maxSeconds = -Infinity;

  for (const sp of relevant) {
    const start = getDisplayTime(sp.schedule);
    const end = getDisplayEndTime(sp.schedule) ?? (start + 1800);
    minSeconds = Math.min(minSeconds, start);
    maxSeconds = Math.max(maxSeconds, end);
  }

  // Convert to hours with 1-hour padding
  let startHour = Math.max(0, Math.floor(minSeconds / 3600) - 1);
  let endHour = Math.min(24, Math.ceil(maxSeconds / 3600) + 1);

  // Also include sunrise/sunset markers if they're near the range
  const sunriseHour = DEFAULT_SUNRISE / 3600;
  const sunsetHour = DEFAULT_SUNSET / 3600;
  if (sunriseHour >= startHour - 1 && sunriseHour <= endHour + 1) {
    startHour = Math.min(startHour, Math.floor(sunriseHour));
  }
  if (sunsetHour >= startHour - 1 && sunsetHour <= endHour + 1) {
    endHour = Math.max(endHour, Math.ceil(sunsetHour) + 1);
  }

  // Ensure minimum 6-hour range for visual clarity
  if (endHour - startHour < 6) {
    const mid = (startHour + endHour) / 2;
    startHour = Math.max(0, Math.floor(mid - 3));
    endHour = Math.min(24, Math.ceil(mid + 3));
  }

  return { startHour, endHour };
}

// ─── Hook: Build Scheduled Programs ─────────────────────────────

function useScheduledPrograms(): { scheduled: ScheduledProgram[]; eventOnly: ScheduledProgram[] } {
  const programs = useProgramStore((s) => s.programs);
  const triggers = useProgramStore((s) => s.triggers);

  return useMemo(() => {
    const scheduled: ScheduledProgram[] = [];
    const eventOnly: ScheduledProgram[] = [];

    // Build a lookup of triggers by decimal ID
    const triggerMap = new Map<number, D2DTrigger>();
    for (const t of triggers) triggerMap.set(t.id, t);

    for (const prog of programs) {
      // Skip folders
      if (prog['@_folder'] === 'true' || prog['@_folder'] === '1') continue;

      const decId = parseInt(prog['@_id'], 16);
      const trigger = triggerMap.get(decId);
      const ifXml = trigger?.if;
      const schedules = extractSchedules(ifXml);
      const enabled = prog['@_enabled'] === 'true' || prog['@_enabled'] === '1';
      const running = prog['@_running'] === 'running' || prog['@_running'] === 'then' || prog['@_running'] === 'else';
      const ifSummary = buildIfSummary(ifXml);

      for (const schedule of schedules) {
        const sp: ScheduledProgram = {
          programId: prog['@_id'],
          name: prog.name,
          enabled,
          running,
          schedule,
          ifSummary,
          trigger,
        };

        if (schedule.type === 'event-only') {
          eventOnly.push(sp);
        } else {
          scheduled.push(sp);
        }
      }
    }

    // Sort scheduled by time
    scheduled.sort((a, b) => getDisplayTime(a.schedule) - getDisplayTime(b.schedule));
    eventOnly.sort((a, b) => a.name.localeCompare(b.name));

    return { scheduled, eventOnly };
  }, [programs, triggers]);
}

// ─── Main Component ─────────────────────────────────────────────

export function ScheduleCalendar() {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const { scheduled, eventOnly } = useScheduledPrograms();
  const loading = useProgramStore((s) => s.loading);

  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  const goPrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (viewMode === 'month') next.setMonth(next.getMonth() - 1);
      else if (viewMode === 'week') next.setDate(next.getDate() - 7);
      else next.setDate(next.getDate() - 1);
      return next;
    });
  }, [viewMode]);

  const goNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (viewMode === 'month') next.setMonth(next.getMonth() + 1);
      else if (viewMode === 'week') next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  }, [viewMode]);

  const switchToDayView = useCallback((date: Date) => {
    setCurrentDate(date);
    setViewMode('day');
  }, []);

  // Navigation label
  const dateLabel = useMemo(() => {
    if (viewMode === 'month') {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    if (viewMode === 'week') {
      const start = getWeekStart(currentDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      if (start.getMonth() === end.getMonth()) {
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}\u2013${end.getDate()}, ${start.getFullYear()}`;
      }
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} \u2013 ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${DAY_NAMES_FULL[currentDate.getDay()]}, ${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
  }, [viewMode, currentDate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
          <CalendarIcon size={22} className="text-blue-500" />
          Schedule
        </h1>

        {/* View mode tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
          {([
            { id: 'day' as ViewMode, label: 'Day' },
            { id: 'week' as ViewMode, label: 'Week' },
            { id: 'month' as ViewMode, label: 'Month' },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setViewMode(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === t.id
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={goToday}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Today
        </button>
        <button
          onClick={goPrev}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Previous"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={goNext}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Next"
        >
          <ChevronRight size={18} />
        </button>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{dateLabel}</h2>
        {loading && (
          <span className="text-xs text-gray-400 dark:text-gray-500">Loading...</span>
        )}
      </div>

      {/* Calendar views */}
      {viewMode === 'month' && (
        <MonthView
          currentDate={currentDate}
          programs={scheduled}
          onDayClick={switchToDayView}
        />
      )}
      {viewMode === 'week' && (
        <WeekView
          currentDate={currentDate}
          programs={scheduled}
          onDayClick={switchToDayView}
        />
      )}
      {viewMode === 'day' && (
        <DayView
          currentDate={currentDate}
          programs={scheduled}
        />
      )}

      {/* Event-triggered programs */}
      {eventOnly.length > 0 && (
        <EventTriggeredSection programs={eventOnly} />
      )}
    </div>
  );
}

// ─── Month View ─────────────────────────────────────────────────

function MonthView({
  currentDate,
  programs,
  onDayClick,
}: {
  currentDate: Date;
  programs: ScheduledProgram[];
  onDayClick: (date: Date) => void;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const weeks = useMemo(() => getMonthGrid(year, month), [year, month]);

  const programsByDay = useMemo(() => {
    const map = new Map<string, ScheduledProgram[]>();
    for (const sp of programs) {
      // For each day of the week this program applies to,
      // add it to all matching dates in the month grid
      for (const week of weeks) {
        for (const day of week) {
          if (appliesToDayOfWeek(sp.schedule, day.getDay())) {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const arr = map.get(key) ?? [];
            // Deduplicate by programId + schedule label
            if (!arr.some((e) => e.programId === sp.programId && e.schedule.label === sp.schedule.label)) {
              arr.push(sp);
              map.set(key, arr);
            }
          }
        }
      }
    }
    return map;
  }, [programs, weeks]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div
          key={wi}
          className={`grid grid-cols-7 ${wi < weeks.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
        >
          {week.map((day, di) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayPrograms = programsByDay.get(key) ?? [];
            const isCurrentMonth = day.getMonth() === month;
            const today = isToday(day);

            return (
              <button
                key={di}
                onClick={() => onDayClick(day)}
                className={`group relative min-h-[5rem] border-r border-gray-200 p-1 text-left transition-colors last:border-r-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50 ${
                  !isCurrentMonth ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''
                } ${today ? 'ring-2 ring-inset ring-blue-400 dark:ring-blue-500' : ''}`}
              >
                {/* Day number */}
                <span
                  className={`mb-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    today
                      ? 'bg-blue-600 text-white'
                      : isCurrentMonth
                        ? 'text-gray-900 dark:text-gray-100'
                        : 'text-gray-400 dark:text-gray-600'
                  }`}
                >
                  {day.getDate()}
                </span>

                {/* Program pills */}
                <div className="space-y-0.5">
                  {dayPrograms.slice(0, 3).map((sp, i) => {
                    const color = getColorForProgram(sp.name, sp.enabled);
                    return (
                      <div
                        key={`${sp.programId}-${i}`}
                        className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${color.bg} ${color.text} ${
                          sp.running ? 'animate-pulse ring-1 ring-green-500' : ''
                        }`}
                        title={`${sp.name} — ${sp.schedule.label}`}
                      >
                        {sp.name}
                      </div>
                    );
                  })}
                  {dayPrograms.length > 3 && (
                    <div className="px-1 text-[10px] text-gray-400 dark:text-gray-500">
                      +{dayPrograms.length - 3} more
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Week View ──────────────────────────────────────────────────

const HOUR_HEIGHT = 2;      // rem per hour (compact)

function WeekView({
  currentDate,
  programs,
  onDayClick,
}: {
  currentDate: Date;
  programs: ScheduledProgram[];
  onDayClick: (date: Date) => void;
}) {
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const days = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const [hoveredProgram, setHoveredProgram] = useState<string | null>(null);

  // Compute visible hour range from events (auto-trim empty hours)
  const { startHour, endHour } = useMemo(() => computeVisibleHours(programs), [programs]);

  const hours = useMemo(() => {
    const h: number[] = [];
    for (let i = startHour; i < endHour; i++) h.push(i);
    return h;
  }, [startHour, endHour]);

  const totalHeight = (endHour - startHour) * HOUR_HEIGHT;

  // Sunrise and sunset position as rem from top
  const sunriseTop = (secondsToHourFraction(DEFAULT_SUNRISE) - startHour) * HOUR_HEIGHT;
  const sunsetTop = (secondsToHourFraction(DEFAULT_SUNSET) - startHour) * HOUR_HEIGHT;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Day headers */}
      <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <div />
        {days.map((day, i) => {
          const today = isToday(day);
          return (
            <button
              key={i}
              onClick={() => onDayClick(day)}
              className={`flex flex-col items-center gap-0.5 border-l border-gray-200 px-1 py-2 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 ${
                today ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
              }`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {DAY_NAMES[day.getDay()]}
              </span>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                  today
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="relative overflow-x-auto overflow-y-auto" style={{ maxHeight: '36rem' }}>
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]" style={{ height: `${totalHeight}rem` }}>
          {/* Time labels */}
          <div className="relative border-r border-gray-200 dark:border-gray-700">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400 dark:text-gray-500"
                style={{ top: `${(h - startHour) * HOUR_HEIGHT}rem` }}
              >
                {formatTime(h * 3600)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, di) => {
            const dow = day.getDay();
            const dayPrograms = programs.filter((sp) =>
              appliesToDayOfWeek(sp.schedule, dow) && sp.schedule.type !== 'event-only'
            );

            // Compute side-by-side layout for overlapping events
            const layout = computeOverlapLayout(dayPrograms);

            return (
              <div
                key={di}
                className="relative border-l border-gray-200 dark:border-gray-700"
              >
                {/* Hour grid lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
                    style={{ top: `${(h - startHour) * HOUR_HEIGHT}rem` }}
                  />
                ))}

                {/* Sunrise line */}
                {sunriseTop >= 0 && sunriseTop <= totalHeight && (
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-amber-400/60 dark:border-amber-500/40"
                    style={{ top: `${sunriseTop}rem` }}
                  >
                    {di === 0 && (
                      <span className="absolute -top-3 left-0.5 flex items-center gap-0.5 text-[9px] font-medium text-amber-500">
                        <Sunrise size={9} /> Sunrise
                      </span>
                    )}
                  </div>
                )}

                {/* Sunset line */}
                {sunsetTop >= 0 && sunsetTop <= totalHeight && (
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-orange-400/60 dark:border-orange-500/40"
                    style={{ top: `${sunsetTop}rem` }}
                  >
                    {di === 0 && (
                      <span className="absolute -top-3 left-0.5 flex items-center gap-0.5 text-[9px] font-medium text-orange-500">
                        <Sunset size={9} /> Sunset
                      </span>
                    )}
                  </div>
                )}

                {/* Program blocks — positioned side-by-side when overlapping */}
                {dayPrograms.map((sp, pi) => {
                  const time = getDisplayTime(sp.schedule);
                  const endTime = getDisplayEndTime(sp.schedule);
                  const hourFrac = secondsToHourFraction(time);
                  const top = (hourFrac - startHour) * HOUR_HEIGHT;
                  const color = getColorForProgram(sp.name, sp.enabled);
                  const slot = layout.get(pi);
                  const col = slot?.column ?? 0;
                  const totalCols = slot?.totalColumns ?? 1;

                  // Duration: use range if available, otherwise 30 min default
                  let heightRem = 0.5 * HOUR_HEIGHT; // 30 min default
                  if (endTime != null) {
                    let duration = endTime - time;
                    if (duration < 0) duration += 86400; // wraps past midnight
                    heightRem = Math.max(0.25 * HOUR_HEIGHT, (duration / 3600) * HOUR_HEIGHT);
                  }

                  // Clamp to visible area
                  if (top + heightRem < 0 || top > totalHeight) return null;

                  // Side-by-side positioning for overlapping events
                  const leftPct = (col / totalCols) * 100;
                  const widthPct = (1 / totalCols) * 100;

                  return (
                    <div
                      key={`${sp.programId}-${pi}`}
                      className={`absolute cursor-pointer overflow-hidden rounded border px-1 py-0.5 text-[10px] leading-tight transition-shadow hover:shadow-md ${color.bg} ${color.text} ${color.border} ${
                        sp.running ? 'animate-pulse ring-2 ring-green-500' : ''
                      } ${hoveredProgram === `${sp.programId}-${di}` ? 'z-20 shadow-lg' : 'z-10'} ${totalCols > 1 ? 'opacity-90' : ''}`}
                      style={{
                        top: `${Math.max(0, top)}rem`,
                        minHeight: '1.25rem',
                        height: `${heightRem}rem`,
                        left: `calc(${leftPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                      }}
                      title={`${sp.name}\n${sp.schedule.label}\n${sp.ifSummary}`}
                      onMouseEnter={() => setHoveredProgram(`${sp.programId}-${di}`)}
                      onMouseLeave={() => setHoveredProgram(null)}
                    >
                      <div className="truncate font-medium">{sp.name}</div>
                      {heightRem > 1.5 && (
                        <div className="truncate opacity-75">{sp.schedule.label}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Day View ───────────────────────────────────────────────────

const DAY_HOUR_HEIGHT = 2.5; // rem per hour (compact)

function DayView({
  currentDate,
  programs,
}: {
  currentDate: Date;
  programs: ScheduledProgram[];
}) {
  const dow = currentDate.getDay();
  const dayPrograms = useMemo(
    () => programs.filter((sp) => appliesToDayOfWeek(sp.schedule, dow) && sp.schedule.type !== 'event-only'),
    [programs, dow],
  );

  // Compute visible hour range from events (auto-trim empty hours)
  const { startHour, endHour } = useMemo(
    () => computeVisibleHours(programs, dow),
    [programs, dow],
  );

  const hours = useMemo(() => {
    const h: number[] = [];
    for (let i = startHour; i < endHour; i++) h.push(i);
    return h;
  }, [startHour, endHour]);

  // Compute overlap layout for side-by-side event positioning
  const layout = useMemo(() => computeOverlapLayout(dayPrograms), [dayPrograms]);

  const totalHeight = (endHour - startHour) * DAY_HOUR_HEIGHT;
  const sunriseTop = (secondsToHourFraction(DEFAULT_SUNRISE) - startHour) * DAY_HOUR_HEIGHT;
  const sunsetTop = (secondsToHourFraction(DEFAULT_SUNSET) - startHour) * DAY_HOUR_HEIGHT;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Day header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {DAY_NAMES_FULL[currentDate.getDay()]}, {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getDate()}
        </span>
        {isToday(currentDate) && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            Today
          </span>
        )}
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {dayPrograms.length} scheduled program{dayPrograms.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Timeline */}
      <div className="relative overflow-y-auto" style={{ maxHeight: '40rem' }}>
        <div className="grid grid-cols-[4rem_1fr]" style={{ height: `${totalHeight}rem` }}>
          {/* Time labels */}
          <div className="relative border-r border-gray-200 dark:border-gray-700">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-gray-400 dark:text-gray-500"
                style={{ top: `${(h - startHour) * DAY_HOUR_HEIGHT}rem` }}
              >
                {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {/* Timeline column */}
          <div className="relative">
            {/* Hour grid lines */}
            {hours.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
                style={{ top: `${(h - startHour) * DAY_HOUR_HEIGHT}rem` }}
              />
            ))}

            {/* Sunrise marker */}
            {sunriseTop >= 0 && sunriseTop <= totalHeight && (
              <div
                className="absolute left-0 right-0 z-10 border-t-2 border-dashed border-amber-400/70 dark:border-amber-500/50"
                style={{ top: `${sunriseTop}rem` }}
              >
                <span className="absolute -top-4 left-2 flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                  <Sunrise size={11} /> Sunrise {formatTime(DEFAULT_SUNRISE)}
                </span>
              </div>
            )}

            {/* Sunset marker */}
            {sunsetTop >= 0 && sunsetTop <= totalHeight && (
              <div
                className="absolute left-0 right-0 z-10 border-t-2 border-dashed border-orange-400/70 dark:border-orange-500/50"
                style={{ top: `${sunsetTop}rem` }}
              >
                <span className="absolute -top-4 left-2 flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                  <Sunset size={11} /> Sunset {formatTime(DEFAULT_SUNSET)}
                </span>
              </div>
            )}

            {/* "Now" marker */}
            {isToday(currentDate) && <NowMarker startHour={startHour} hourHeight={DAY_HOUR_HEIGHT} totalHeight={totalHeight} />}

            {/* Program blocks — positioned side-by-side when overlapping */}
            {dayPrograms.map((sp, pi) => {
              const time = getDisplayTime(sp.schedule);
              const endTime = getDisplayEndTime(sp.schedule);
              const hourFrac = secondsToHourFraction(time);
              const top = (hourFrac - startHour) * DAY_HOUR_HEIGHT;
              const color = getColorForProgram(sp.name, sp.enabled);
              const slot = layout.get(pi);
              const col = slot?.column ?? 0;
              const totalCols = slot?.totalColumns ?? 1;

              let heightRem = 0.75 * DAY_HOUR_HEIGHT; // 45 min default
              if (endTime != null) {
                let duration = endTime - time;
                if (duration < 0) duration += 86400;
                heightRem = Math.max(0.5 * DAY_HOUR_HEIGHT, (duration / 3600) * DAY_HOUR_HEIGHT);
              }

              // Clamp
              if (top + heightRem < 0 || top > totalHeight) return null;

              // Side-by-side positioning for overlapping events
              const leftPct = (col / totalCols) * 100;
              const widthPct = (1 / totalCols) * 100;
              const leftPx = col === 0 ? 8 : 2;
              const rightPx = col === totalCols - 1 ? 8 : 2;

              return (
                <div
                  key={`${sp.programId}-${pi}`}
                  className={`absolute z-10 cursor-pointer overflow-hidden rounded-lg border px-3 py-1.5 transition-shadow hover:shadow-lg ${color.bg} ${color.text} ${color.border} ${
                    sp.running ? 'ring-2 ring-green-500' : ''
                  } ${totalCols > 1 ? 'opacity-90' : ''}`}
                  style={{
                    top: `${Math.max(0, top)}rem`,
                    minHeight: '2rem',
                    height: `${heightRem}rem`,
                    left: `calc(${leftPct}% + ${leftPx}px)`,
                    width: `calc(${widthPct}% - ${leftPx + rightPx}px)`,
                  }}
                  title={`${sp.name}\n${sp.schedule.label}\n${sp.ifSummary}`}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm font-semibold">{sp.name}</span>
                    {sp.running && (
                      <span className="flex items-center gap-0.5 whitespace-nowrap rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <Play size={8} /> Running
                      </span>
                    )}
                    {!sp.enabled && (
                      <span className="whitespace-nowrap text-[10px] text-gray-400 dark:text-gray-500">Disabled</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs opacity-80">
                    <span className="flex items-center gap-0.5">
                      <Clock size={10} /> {sp.schedule.label}
                    </span>
                    {sp.schedule.type === 'sunset' && <Sunset size={10} />}
                    {sp.schedule.type === 'sunrise' && <Sunrise size={10} />}
                  </div>
                  {heightRem > 3 && (
                    <div className="mt-1 truncate text-[10px] opacity-60">
                      IF: {sp.ifSummary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Now Marker ─────────────────────────────────────────────────

function NowMarker({
  startHour,
  hourHeight,
  totalHeight,
}: {
  startHour: number;
  hourHeight: number;
  totalHeight: number;
}) {
  const now = new Date();
  const secondsFromMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const top = (secondsToHourFraction(secondsFromMidnight) - startHour) * hourHeight;

  if (top < 0 || top > totalHeight) return null;

  return (
    <div
      className="absolute left-0 right-0 z-30"
      style={{ top: `${top}rem` }}
    >
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
        <div className="h-px flex-1 bg-red-500" />
      </div>
    </div>
  );
}

// ─── Event-Triggered Section ────────────────────────────────────

function EventTriggeredSection({ programs }: { programs: ScheduledProgram[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <Zap size={16} className="text-amber-500" />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Event-Triggered Programs
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {programs.length}
        </span>
        <ChevronRight
          size={14}
          className={`ml-auto text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="grid gap-1 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((sp) => {
              const color = getColorForProgram(sp.name, sp.enabled);
              return (
                <div
                  key={sp.programId}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${color.bg} ${color.border} ${
                    sp.running ? 'ring-2 ring-green-500' : ''
                  }`}
                  title={sp.ifSummary}
                >
                  <Zap size={12} className={color.text} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-xs font-medium ${color.text}`}>
                      {sp.name}
                    </div>
                    <div className="truncate text-[10px] opacity-60">
                      {sp.ifSummary}
                    </div>
                  </div>
                  {sp.running && (
                    <Play size={10} className="flex-shrink-0 text-green-600 dark:text-green-400" />
                  )}
                  {!sp.enabled && (
                    <span className="flex-shrink-0 text-[10px] text-gray-400">Off</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
