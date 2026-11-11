import { Link } from 'react-router';
import teaching from '../../../content/algorithms/cpp/teaching-1.0.0.json';
import examples from '../../../content/advanced/example-teaching-1.0.0.json';
import cCases from '../../../content/c/primer6-learning/case-teaching-1.0.0.json';
import { C6TeachingReading } from './C6TeachingReading';
import './case-walkthrough.css';

const guides = [...teaching.entries, ...examples.entries, ...cCases.entries];

export function CaseWalkthrough({
  caseId,
  returnTo = '/cases',
}: {
  readonly caseId: string;
  readonly returnTo?: '/cases' | '/advanced';
}) {
  const guide = guides.find((entry) => entry.caseId === caseId);
  if (!guide) return null;
  return (
    <section className="card case-walkthrough" aria-label={`${guide.title}示例推演`}>
      <h2>{guide.title}的默认输入推演</h2>
      <p>以下步骤采用文中列出的输入。工作区实际状态和输出随本次运行变化。</p>
      <C6TeachingReading text={guide.body.join('\n\n')} />
      <nav aria-label="案例阅读导航">
        <Link className="text-link" to={returnTo}>
          {returnTo === '/advanced' ? '返回进阶课程目录' : '返回案例目录'}
        </Link>
      </nav>
    </section>
  );
}
