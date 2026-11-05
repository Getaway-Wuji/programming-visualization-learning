import { Link } from 'react-router';

/** Course navigation does not load the executable bug workspaces. */
export function BugCatalogLink() {
  return (
    <p className="bug-catalog-entry">
      <Link className="button" to="/bugs">
        Bug 修复闯关
      </Link>{' '}
      从语法、逻辑、指针与循环错误稿开始，修复后用真实测试验证。
    </p>
  );
}
