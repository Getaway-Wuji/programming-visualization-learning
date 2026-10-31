import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { MissingPage, StatePanel } from './components/Ui';
import { HomePage } from './pages/HomePage';
import { LearningProvider, useLearning } from './learning/react';
import { PracticeProvider } from './practice/react';
import { AppearanceProvider } from './appearance/react';
import { WorkbenchProvider } from './workbench/react';
import { KnowledgeMarksProvider } from './review-notebook/marks';
import { AchievementProvider } from './achievements/react';
const AchievementsPage = lazy(() => import('./achievements/AchievementsPage'));
import { ReviewProvider } from './review-scheduler/react';
const ReviewsPage = lazy(() => import('./review-scheduler/ReviewsPage'));
const NotebookPage = lazy(() => import('./review-notebook/NotebookPage'));

const CoursePage = lazy(() =>
  import('./pages/CatalogPages').then((module) => ({ default: module.CoursePage })),
);
const CasesPage = lazy(() =>
  import('./pages/CatalogPages').then((module) => ({ default: module.CasesPage })),
);
const LessonPage = lazy(() => import('./pages/LessonPage'));
const PracticePage = lazy(() =>
  import('./pages/Workspaces').then((module) => ({ default: module.PracticePage })),
);
const VisualizePage = lazy(() =>
  import('./pages/Workspaces').then((module) => ({ default: module.VisualizePage })),
);
const ReviewPage = lazy(() =>
  import('./pages/Workspaces').then((module) => ({ default: module.ReviewPage })),
);
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CustomCodePage = lazy(() => import('./custom-code/CustomCodePage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const ComparisonPage = lazy(() => import('./comparison/ComparisonPage'));
const AlgorithmPage = lazy(() => import('./algorithms/AlgorithmPage'));
const StructurePage = lazy(() => import('./structures/StructurePage'));
const NodeCasePage = lazy(() => import('./node-cases/NodeCasePage'));
const ClassicPage = lazy(() => import('./classics/ClassicPage'));
const CompilationPage = lazy(() => import('./compilation/CompilationPage'));
const BugPage = lazy(() => import('./bugs/BugPanel'));
const MemoryBugPage = lazy(() => import('./memory-bugs/MemoryBugPage'));

class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <StatePanel
        kind="error"
        title="页面加载失败"
        description="页面资源暂时无法加载。检查连接后可重新加载当前页面。"
      >
        <button className="button button-primary" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </StatePanel>
    ) : (
      this.props.children
    );
  }
}

function AppRoutes() {
  const location = useLocation();
  const { state } = useLearning();
  return (
    <Layout>
      <PageBoundary key={`${location.pathname}:${state.sessionEpoch}`}>
        <Suspense
          fallback={
            <StatePanel
              kind="loading"
              title="正在准备页面"
              description="正在加载页面资源，请稍候。"
            />
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/courses" element={<CoursePage />} />
            <Route path="/courses/:chapterId" element={<CoursePage />} />
            <Route path="/lessons/:lessonId" element={<LessonPage />} />
            <Route path="/practice/:exerciseId" element={<PracticePage />} />
            <Route path="/practice/:exerciseId/review" element={<ReviewPage />} />
            <Route path="/cases" element={<CasesPage />} />
            <Route path="/compare" element={<ComparisonPage />} />
            <Route path="/algorithms/:algorithmId" element={<AlgorithmPage />} />
            <Route path="/structures/:structureId" element={<StructurePage />} />
            <Route path="/nodes/:nodeCaseId" element={<NodeCasePage />} />
            <Route path="/classics/:classicId" element={<ClassicPage />} />
            <Route path="/custom-code" element={<CustomCodePage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/compilation" element={<CompilationPage />} />
            <Route path="/bugs" element={<BugPage />} />
            <Route path="/bugs/memory/:exerciseId" element={<MemoryBugPage />} />
            <Route path="/visualize/:caseId" element={<VisualizePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notebook" element={<NotebookPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="*" element={<MissingPage />} />
          </Routes>
        </Suspense>
      </PageBoundary>
    </Layout>
  );
}

export function App() {
  return (
    <LearningProvider>
      <KnowledgeMarksProvider>
        <ReviewProvider>
          <AchievementProvider>
            <AppearanceProvider>
              <WorkbenchProvider>
                <HashRouter>
                  <PracticeProvider>
                    <AppRoutes />
                  </PracticeProvider>
                </HashRouter>
              </WorkbenchProvider>
            </AppearanceProvider>
          </AchievementProvider>
        </ReviewProvider>
      </KnowledgeMarksProvider>
    </LearningProvider>
  );
}
