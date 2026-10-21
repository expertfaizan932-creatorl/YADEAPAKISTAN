import { FaRegCalendarDays } from 'react-icons/fa6';
import {
  SUBMISSION_DATE_FILTERS,
  SUBMISSION_STATUS_FILTERS,
  type SubmissionDateFilter,
  type SubmissionStatusFilter,
} from '../data/submissionFilters';

interface Props {
  status: SubmissionStatusFilter;
  onStatusChange: (v: SubmissionStatusFilter) => void;
  date: SubmissionDateFilter;
  onDateChange: (v: SubmissionDateFilter) => void;
  customFrom: string;
  customTo: string;
  onCustomChange: (from: string, to: string) => void;
  statusCounts?: Partial<Record<SubmissionStatusFilter, number>>;
  dateCounts?: Partial<Record<SubmissionDateFilter, number>>;
}

const pillCls =
  'px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1';
const pillOn = 'bg-slate-800 text-white';
const pillOff = 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300';

export default function SubmissionFilterBar({
  status,
  onStatusChange,
  date,
  onDateChange,
  customFrom,
  customTo,
  onCustomChange,
  statusCounts,
  dateCounts,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Status bucket */}
      <div className="flex items-center gap-1.5">
        {SUBMISSION_STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onStatusChange(f.key)}
            className={`${pillCls} ${status === f.key ? pillOn : pillOff}`}
          >
            {f.label}
            {statusCounts?.[f.key] !== undefined && (
              <span
                className={`text-[9px] font-extrabold ${
                  status === f.key ? 'text-slate-300' : 'text-slate-400'
                }`}
              >
                {statusCounts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Date bucket */}
      <div className="flex items-center gap-1.5">
        {SUBMISSION_DATE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onDateChange(f.key)}
            className={`${pillCls} ${date === f.key ? pillOn : pillOff}`}
          >
            {f.key === 'custom' && <FaRegCalendarDays className="text-[10px]" />}
            {f.label}
            {dateCounts?.[f.key] !== undefined && f.key !== 'custom' && (
              <span
                className={`text-[9px] font-extrabold ${
                  date === f.key ? 'text-slate-300' : 'text-slate-400'
                }`}
              >
                {dateCounts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Specific date pickers */}
      {date === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => onCustomChange(e.target.value, customTo)}
            className="px-2 py-1.5 text-[11px] bg-white border border-slate-300 rounded-lg outline-none focus:border-yadea-orange"
          />
          <span className="text-[11px] text-slate-400">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => onCustomChange(customFrom, e.target.value)}
            className="px-2 py-1.5 text-[11px] bg-white border border-slate-300 rounded-lg outline-none focus:border-yadea-orange"
          />
          {(customFrom || customTo) && (
            <button
              type="button"
              onClick={() => onCustomChange('', '')}
              className="text-[11px] font-bold text-slate-400 hover:text-yadea-orange transition"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
