import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useLearning } from '../learning/react';
import { useAppearance } from '../appearance/react';
import { ThemeModeToggle } from '../appearance/ThemeModeToggle';
import { useWorkbench } from '../workbench/react';
import { useAchievements } from '../achievements/react';
import { useReviews } from '../review-scheduler/react';

const navigation = [
  { to: '/', label: '学习首页', icon: 'home' },
  { to: '/courses', label: 'C 语言课程', icon: 'book' },
  { to: '/advanced', label: '进阶课程', icon: 'book' },
  { to: '/cases', label: '算法与演示', icon: 'chart' },
  { to: '/custom-code', label: 'C 代码工作台', icon: 'code' },
  { to: '/compilation', label: '编译流程', icon: 'code' },
  { to: '/notebook', label: '错题与陌生点', icon: 'book' },
  { to: '/study-notes', label: '学习笔记', icon: 'book' },
  { to: '/reviews', label: '今日复习', icon: 'book' },
  { to: '/achievements', label: '学习成就', icon: 'book' },
  { to: '/settings', label: '本地设置', icon: 'settings' },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { state: learning } = useLearning();
  const appearance = useAppearance();
  const workbench = useWorkbench();
  const achievementState = useAchievements().state;
  const reviewState = useReviews().state;
  const [menu, setMenu] = useState({ path: '', open: false });
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const menuOpen = narrow && menu.path === location.pathname && menu.open;
  const navToggle = useRef<HTMLButtonElement>(null);
  const closeMenu = (restoreFocus = true) => {
    setMenu({ path: location.pathname, open: false });
    if (restoreFocus) requestAnimationFrame(() => navToggle.current?.focus());
  };
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)');
    const changed = () => {
      setNarrow(media.matches);
      if (!media.matches) setMenu((current) => ({ ...current, open: false }));
    };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (menuOpen) document.querySelector<HTMLButtonElement>('.sidebar-close')?.focus();
  }, [menuOpen]);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    // Keep native initial-page tab order. Focus the new heading only after
    // navigation within this document, including browser back/forward.
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    const main = document.getElementById('main-content');
    const retainedReview =
      location.pathname.endsWith('/review') &&
      main?.querySelector(
        '[data-mode="exercise-review"] [data-testid="trace-view"][data-cursor]:not([data-cursor=""])',
      );
    // The accepted trace positions its first review frame during layout.
    // Do not overwrite that position with the ordinary route-to-top reset.
    if (!retainedReview) window.scrollTo({ top: 0, behavior: 'instant' });
    const focusHeading = () => {
      const heading = main?.querySelector<HTMLElement>('h1');
      if (!heading) return false;
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;
    main?.focus({ preventScroll: true });
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.pathname]);
  const courseRoute =
    /^\/(lessons|practice)\//.test(location.pathname) || location.pathname.startsWith('/bugs');
  const caseRoute =
    location.pathname.startsWith('/visualize/') ||
    location.pathname.startsWith('/algorithms/') ||
    location.pathname.startsWith('/structures/') ||
    location.pathname.startsWith('/nodes/') ||
    location.pathname.startsWith('/classics/') ||
    location.pathname === '/memory' ||
    location.pathname === '/compare';
  const toolRoute =
    location.pathname === '/custom-code' ||
    caseRoute ||
    location.pathname.startsWith('/practice/') ||
    location.pathname.startsWith('/advanced/examples/') ||
    location.pathname.startsWith('/advanced/algorithms/');
  const focused = toolRoute && workbench.layout.workbenchMode === 'focus';
  const collapsed = focused || workbench.layout.sidebar === 'collapsed';
  return (
    <div
      className="app-shell p05-app"
      data-nav-open={menuOpen}
      data-sidebar={collapsed ? 'collapsed' : 'expanded'}
      data-workbench-mode={focused ? 'focus' : 'standard'}
      data-learning-storage-status={learning.status}
      data-review-storage-status={reviewState.status}
      data-achievement-storage-status={achievementState.status}
      data-learning-reading-status={learning.readingStatus ?? 'unavailable'}
      data-learning-practice-status={learning.practiceStatus ?? 'unavailable'}
      data-learning-reward-status={learning.rewardStatus ?? 'unavailable'}
      data-learning-goal-status={learning.goalStatus ?? 'unavailable'}
      data-learning-profile-status={learning.profileStatus ?? 'unavailable'}
      onKeyDown={(event) => {
        if (menuOpen && event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
        }
      }}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        跳到主要内容
      </a>
      {menuOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="关闭导航遮罩"
          tabIndex={-1}
          onClick={() => closeMenu()}
        />
      )}
      <aside className="sidebar">
        <button
          type="button"
          className="button sidebar-collapse"
          disabled={workbench.disabled}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-controls="primary-navigation"
          aria-expanded={!collapsed}
          onClick={() =>
            void workbench.change(
              focused
                ? { sidebar: 'expanded', workbenchMode: 'standard' }
                : { sidebar: collapsed ? 'expanded' : 'collapsed' },
            )
          }
        >
          <Icon name="sidebar" />
          <span>{collapsed ? '展开' : '收起侧栏'}</span>
        </button>
        <button
          type="button"
          className="button button-secondary sidebar-close"
          aria-label="收起导航"
          onClick={() => closeMenu()}
        >
          收起导航
        </button>
        <Link className="brand" to="/" aria-label="编程可视化教学平台 · 学习首页">
          <span className="brand-mark">{'{ }'}</span>
          <span className="brand-text">
            一步一懂<small>编程可视化教学平台</small>
          </span>
        </Link>
        <p className="sidebar-note">从代码，到理解。</p>
        <nav id="primary-navigation" aria-label="主导航">
          {navigation.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              title={item.label}
              onClick={() => {
                if (menuOpen) closeMenu(item.to === location.pathname);
              }}
              className={`nav-link${location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(`${item.to}/`)) || (item.to === '/courses' && courseRoute) || (item.to === '/cases' && caseRoute) ? ' active' : ''}`}
              aria-current={
                location.pathname === item.to ||
                (item.to !== '/' && location.pathname.startsWith(`${item.to}/`)) ||
                (item.to === '/courses' && courseRoute) ||
                (item.to === '/cases' && caseRoute)
                  ? 'page'
                  : undefined
              }
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Icon name="leaf" />
          <strong>按自己的节奏学习</strong>
          <p>学习记录将保存在当前浏览器，不跨设备同步。</p>
          <Link to="/settings?panel=data">
            了解本地数据 <Icon name="arrow" />
          </Link>
        </div>
      </aside>
      <div className="app-content" inert={menuOpen ? true : undefined}>
        <header className="topbar">
          <button
            ref={navToggle}
            className="button nav-toggle"
            type="button"
            aria-label="展开或收起导航"
            aria-controls="primary-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenu({ path: location.pathname, open: !menuOpen })}
          >
            <Icon name="menu" />
          </button>
          <span className="topbar-title">
            {location.pathname.startsWith('/bugs/memory/')
              ? '受限 C++ · Bug 闯关'
              : 'C 语言 · 从零开始'}
          </span>
          <div className="local-note">
            {toolRoute && (
              <button
                type="button"
                className="button workbench-focus-toggle"
                disabled={workbench.disabled}
                aria-pressed={focused}
                aria-label={focused ? '退出专注模式' : '进入专注模式'}
                title={focused ? '退出专注模式' : '进入专注模式'}
                onClick={() =>
                  void workbench.change({ workbenchMode: focused ? 'standard' : 'focus' })
                }
              >
                <Icon name={focused ? 'restore' : 'expand'} />
                <span>{focused ? '退出专注' : '专注'}</span>
              </button>
            )}
            <span className="preview-badge">本地学习</span>
            <Link to="/settings?panel=data">
              <Icon name="settings" />
              <span>本地数据</span>
            </Link>
            <ThemeModeToggle />
          </div>
        </header>
        {workbench.failed && (
          <div className="notice layout-save-notice" role="alert" data-testid="layout-save-status">
            <span>当前布局仅临时生效，尚未保存。</span>
            <button
              type="button"
              className="text-link"
              disabled={workbench.saving}
              onClick={() => void workbench.retry()}
            >
              重试保存布局
            </button>
            <button
              type="button"
              className="text-link"
              disabled={workbench.saving}
              onClick={workbench.discard}
            >
              采用已保存布局
            </button>
          </div>
        )}
        {appearance.draft && (
          <div className="appearance-preview-note" role="status">
            <span>外观预览尚未保存</span>
            <Link to="/settings?panel=appearance">前往设置保存</Link>
            <button type="button" className="text-link" onClick={appearance.discard}>
              采用已保存外观
            </button>
          </div>
        )}
        <main id="main-content" tabIndex={-1} className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
