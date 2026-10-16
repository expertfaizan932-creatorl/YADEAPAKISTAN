import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { FaBarsStaggered, FaChevronLeft, FaChevronRight, FaPlus, FaUserGear } from 'react-icons/fa6';
import type { SmartList } from './SmartListDrawer';

interface SmartListTabsProps {
  active: string;
  onSelect: (list: string) => void;
  customLists: SmartList[];
  onAdd: () => void;
  onRemove?: (id: string) => void;
  onRemoveBuiltIn?: (name: string) => void;
  hiddenBuiltIns?: string[];
}

const BUILT_INS = ['All'];
const SCROLL_STEP = 240;

function SmartListTabs({ active, onSelect, customLists, onAdd, hiddenBuiltIns }: SmartListTabsProps) {
  const visibleBuiltIns = BUILT_INS.filter((list) => !hiddenBuiltIns?.includes(list));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(el);
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      observer.disconnect();
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [customLists, hiddenBuiltIns, updateScrollButtons]);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) return;
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    const next = Math.min(maxScroll, Math.max(0, el.scrollLeft + delta));
    if (next !== el.scrollLeft) {
      e.preventDefault();
      el.scrollLeft = next;
    }
  }, []);

  const scrollByDirection = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' });
  };

  return (
    <div className="relative flex-shrink-0 border-b border-slate-200">
      {canScrollLeft && (
        <>
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-r from-white via-white/80 to-transparent" />
          <button
            type="button"
            onClick={() => scrollByDirection(-1)}
            aria-label="Scroll smart lists left"
            title="Scroll left"
            className="absolute left-1 top-1/2 -translate-y-1/2 z-20 h-6 w-6 flex items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 shadow-sm transition"
          >
            <FaChevronLeft className="text-[10px]" />
          </button>
        </>
      )}

      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="px-4 md:px-6 pt-1 pb-0 flex items-center space-x-4 text-xs font-medium text-slate-600 overflow-x-auto whitespace-nowrap no-scrollbar"
      >
        {visibleBuiltIns.map((list) => {
          const isActive = active === list;
          return (
            <button
              key={list}
              onClick={() => onSelect(list)}
              className={
                isActive
                  ? 'flex items-center space-x-1.5 py-2 flex-shrink-0 text-blue-600 font-semibold border-b-2 border-blue-600'
                  : 'flex items-center space-x-1.5 py-2 flex-shrink-0 hover:text-slate-800'
              }
            >
              <FaBarsStaggered />
              <span>{list}</span>
            </button>
          );
        })}

        {customLists.map((list) => {
          const isActive = active === list.name;
          return (
            <div
              key={list.id}
              onClick={() => onSelect(list.name)}
              className={
                isActive
                  ? 'flex items-center space-x-1.5 py-2 flex-shrink-0 text-blue-600 font-semibold border-b-2 border-blue-600 cursor-pointer'
                  : 'flex items-center space-x-1.5 py-2 flex-shrink-0 hover:text-slate-800 cursor-pointer'
              }
            >
              <FaBarsStaggered />
              <span>{list.name}</span>
              {list.dealerName && (
                <span
                  title={`Assigned to ${list.dealerName}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-semibold"
                >
                  <FaUserGear className="text-[8px]" />
                  {list.dealerName}
                </span>
              )}
            </div>
          );
        })}

        <button
          onClick={onAdd}
          className="my-1.5 h-6 flex items-center space-x-1 px-2.5 border border-slate-300 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex-shrink-0 transition"
        >
          <FaPlus className="text-[10px]" />
          <span>Add Smart List</span>
        </button>
      </div>

      {canScrollRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-l from-white via-white/80 to-transparent" />
          <button
            type="button"
            onClick={() => scrollByDirection(1)}
            aria-label="Scroll smart lists right"
            title="Scroll right"
            className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-6 w-6 flex items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 shadow-sm transition"
          >
            <FaChevronRight className="text-[10px]" />
          </button>
        </>
      )}
    </div>
  );
}

export default SmartListTabs;
