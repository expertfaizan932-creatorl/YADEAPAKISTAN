import type { IconType } from 'react-icons';
import {
  FaBoltLightning,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaGaugeHigh,
  FaGear,
  FaGraduationCap,
  FaGrip,
  FaMagnifyingGlass,
  FaPlay,
  FaRobot,
  FaRocket,
  FaWandMagicSparkles,
  FaXmark,
  FaDiagramProject,
  FaBullhorn,
  FaGlobe,
  FaRegCalendar,
  FaRegCreditCard,
  FaRegFolderClosed,
  FaRegStar,
  FaAddressBook,
  FaComments,
  FaChartLine,
  FaFileInvoice,
  FaStore,
  FaHeadset,
} from 'react-icons/fa6';
import YadeaLogo from './YadeaLogo';
import { useAuth } from '../auth';
import UserMenu from './UserMenu';
import WorkspaceBox from './WorkspaceBox';

interface NavItem {
  label: string;
  icon: IconType;
  /** Permission category id required to see this item (Admin always sees it). */
  perm?: string;
}

const primaryNav: NavItem[] = [
  { label: 'Ask AI', icon: FaWandMagicSparkles, perm: 'ask_ai' },
  { label: 'Launchpad', icon: FaRocket, perm: 'launchpad' },
  { label: 'Dashboard', icon: FaGaugeHigh },
  { label: 'Conversations', icon: FaComments, perm: 'conversations' },
  { label: 'Calendars', icon: FaRegCalendar, perm: 'calendars' },
  { label: 'Contacts', icon: FaAddressBook, perm: 'contacts' },
  { label: 'Opportunities', icon: FaDiagramProject, perm: 'opportunities' },
  { label: 'Payments', icon: FaRegCreditCard, perm: 'payments' },
  { label: 'Invoices', icon: FaFileInvoice, perm: 'invoices' },
];

const secondaryNav: NavItem[] = [
  { label: 'AI Agents', icon: FaRobot, perm: 'ai_agents' },
  { label: 'Marketing', icon: FaBullhorn, perm: 'marketing' },
  { label: 'Automation', icon: FaPlay, perm: 'automation' },
  { label: 'Sites', icon: FaGlobe, perm: 'forms' },
  { label: 'Memberships', icon: FaGraduationCap, perm: 'memberships' },
  { label: 'Media Storage', icon: FaRegFolderClosed, perm: 'medias' },
  { label: 'Reputation', icon: FaRegStar, perm: 'reputations' },
  { label: 'Reporting', icon: FaChartLine, perm: 'dashboard' },
  { label: 'Dealership Page', icon: FaStore, perm: 'dealership' },
  { label: 'Customer Inquiries', icon: FaHeadset, perm: 'inquiries' },
  { label: 'App Marketplace', icon: FaGrip, perm: 'integrations' },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  activeNav: string;
  onNavigate: (label: string) => void;
  onToggleCollapse: () => void;
  onMobileClose: () => void;
  onLogout?: () => void;
}

function Sidebar({
  collapsed,
  mobileOpen,
  activeNav,
  onNavigate,
  onToggleCollapse,
  onMobileClose,
  onLogout,
}: SidebarProps) {
  const widthClass = collapsed ? 'w-16' : 'w-64';
  const { user, hasPermission } = useAuth();
  const canManageStaff = user?.user_type === 'Admin' || hasPermission('user_management');

  const visiblePrimary = primaryNav.filter((item) => !item.perm || hasPermission(item.perm));
  const visibleSecondary = secondaryNav.filter((item) => !item.perm || hasPermission(item.perm));
  const hasAnyNav = visiblePrimary.length > 0 || visibleSecondary.length > 0;

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeNav === item.label;
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => onNavigate(item.label)}
        className={`w-full text-left nav-item flex items-center px-3 py-1.5 rounded-md transition ${
          isActive
            ? 'text-xs font-semibold text-white bg-slate-800 shadow-sm border-l-2 border-blue-500'
            : 'text-xs font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-slate-100'
        }`}
      >
        <Icon
          className={`w-5 text-center mr-2 shrink-0 ${
            isActive ? 'text-blue-400' : 'text-slate-400'
          }`}
        />
        {!collapsed && item.label}
      </button>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-30 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`flex flex-col h-full bg-sidebar-bg border-r border-sidebar-border transition-all duration-300 flex-shrink-0 fixed md:relative z-40 -translate-x-full md:translate-x-0 top-0 bottom-0 left-0 shadow-2xl md:shadow-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${widthClass}`}
        aria-label="Sidebar navigation"
      >
        {/* Logo Section */}
        <div className="p-3 flex items-center justify-between border-b border-slate-700/50">
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center justify-center pl-1">
              {collapsed ? (
                <YadeaLogo wordmark={false} className="h-5 w-auto" />
              ) : (
                <YadeaLogo className="h-6 w-auto" />
              )}
            </div>
          </div>
          <button
            onClick={onMobileClose}
            className="md:hidden text-slate-400 hover:text-white p-1 text-sm"
            aria-label="Close sidebar"
          >
            <FaXmark />
          </button>
        </div>

        {/* Signed-in user workspace box */}
        {!collapsed && (
          <div className="px-3 pt-2 pb-0.5">
            <button className="w-full bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 rounded-lg p-2 flex items-center justify-between text-left group transition">
              <WorkspaceBox />
              <FaChevronDown className="text-slate-400 text-xs ml-1 flex-shrink-0" />
            </button>
          </div>
        )}

        {/* Search Box inside Sidebar */}
        {!collapsed && (
          <div className="px-3 py-1.5 flex items-center space-x-1.5">
            <div className="relative flex-1">
              <FaMagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input
                type="text"
                placeholder="Search"
                className="w-full bg-slate-800/60 border border-slate-700/60 rounded-md py-1.5 pl-8 pr-12 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-slate-500"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] bg-slate-700 text-slate-300 px-1 rounded border border-slate-600 font-mono">
                ctrlK
              </span>
            </div>
            <button
              className="w-7 h-7 rounded-md bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 flex items-center justify-center text-xs transition flex-shrink-0 border border-emerald-500/30"
              title="Quick action"
              aria-label="Quick action"
            >
              <FaBoltLightning />
            </button>
          </div>
        )}

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto sidebar-scroll px-2 py-1 space-y-0.5">
          {!hasAnyNav && (
            <div className="px-3 py-6 text-center text-[11px] text-slate-500">
              No permissions enabled yet.
              <br />
              Ask your admin to grant access.
            </div>
          )}
          {visiblePrimary.map(renderNavLink)}
          {visiblePrimary.length > 0 && visibleSecondary.length > 0 && (
            <div className="my-2 border-t border-slate-700/40" />
          )}
          {visibleSecondary.map(renderNavLink)}
        </div>

        {/* Footer Settings Button */}
        <div className="p-2 border-t border-slate-700/50 bg-slate-900/40 relative">
          {canManageStaff && (
            <button
              onClick={() => onNavigate('Settings')}
              className="w-full text-left nav-item flex items-center px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-slate-100 rounded-md mb-1"
            >
              <FaGear className="w-5 text-center mr-2 text-slate-400 shrink-0" />
              {!collapsed && 'Settings'}
            </button>
          )}

          {user && (
            <div className={`flex items-center gap-2.5 rounded-md ${collapsed ? 'justify-center px-1 py-1' : 'px-3 py-2'}`}>
              <UserMenu user={user} onLogout={onLogout} />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-sidebar-text truncate">{user.full_name}</div>
                  <div className="text-[10px] text-sidebar-text/60 truncate">
                    {user.user_type === 'Admin' ? 'Administrator' : user.user_type === 'Dealer' ? 'Dealer' : 'Follower'}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={onToggleCollapse}
            className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500 text-white items-center justify-center text-[10px] shadow-md border border-slate-700 hover:bg-emerald-600 transition"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <FaChevronRight /> : <FaChevronLeft />}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
