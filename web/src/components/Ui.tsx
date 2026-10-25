import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';

export function PageHeading({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <p className="page-kicker">{kicker}</p>
      <h1 tabIndex={-1} className="page-title">
        {title}
      </h1>
      {description && <p className="page-description">{description}</p>}
      {children}
    </header>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="当前位置">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 && <Icon name="chevron" />}
            {item.to ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function StatePanel({
  kind = 'empty',
  title,
  description,
  children,
}: {
  kind?: 'empty' | 'loading' | 'error';
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`state-panel state-${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={kind === 'loading'}
    >
      <span className="state-icon">
        <Icon name={kind === 'error' ? 'alert' : kind === 'loading' ? 'refresh' : 'leaf'} />
      </span>
      <div className="state-copy">
        <h2 className="state-title">{title}</h2>
        <p className="state-description">{description}</p>
        {children && <div className="state-actions">{children}</div>}
      </div>
    </div>
  );
}

export function MissingPage({
  title = '找不到这个页面',
  backTo = '/',
  backLabel = '返回学习首页',
}: {
  title?: string;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <>
      <PageHeading kicker="页面暂不可用" title={title} />
      <StatePanel
        kind="error"
        title="请检查页面地址"
        description="该地址没有对应的页面或内容。你可以从目录重新选择。"
      >
        <Link className="button button-primary" to={backTo}>
          {backLabel}
          <Icon name="arrow" />
        </Link>
      </StatePanel>
    </>
  );
}
