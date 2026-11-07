import { Component, lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import {
  createHashRouter,
  RouterProvider,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router';
import { Layout } from './components/Layout';
import { MissingPage, StatePanel } from './components/Ui';
const HomePage = lazy(() =>
  import('./c6-learning/CoursePages').then((module) => ({ default: module.C6HomePage })),
);
import { LearningProvider, useLearning } from './learning/react';
import { PracticeProvider } from './practice/react';
import { AppearanceProvider } from './appearance/react';
import { WorkbenchProvider } from './workbench/react';
import { KnowledgeMarksProvider } from './review-notebook/marks';
import { AchievementProvider } from './achievements/react';
const AchievementsPage = lazy(() => import('./achievements/AchievementsPage'));
import { ReviewProvider } from './review-scheduler/react';
import { AiProvider } from './ai-debug/react';
import { NotesProvider } from './study-notes/session';
const NotesPage = lazy(() => import('./c6-learning/NotesPage'));
const NotebookPage = lazy(() => import('./c6-learning/NotebookPage'));
const WeaknessPage = lazy(() => import('./weaknesses/WeaknessPage'));
const GeneratedPracticePage = lazy(() => import('./generated-practice/GeneratedPracticePage'));

const CoursePage = lazy(() =>
  import('./c6-learning/CoursePages').then((module) => ({ default: module.C6CoursePage })),
);
const CasesPage = lazy(() =>
  import('./pages/CatalogPages').then((module) => ({ default: module.CasesPage })),
);
const LessonPage = lazy(() =>
  import('./c6-learning/CoursePages').then((module) => ({ default: module.C6LessonPage })),
);
const PracticePage = lazy(() =>
  import('./c6-learning/Workbench').then((module) => ({ default: module.C6PracticePage })),
);
const PracticeCatalog = lazy(() =>
  import('./c6-learning/PracticeCatalog').then((m) => ({ default: m.C6PracticeCatalog })),
);
const VisualizePage = lazy(() =>
  import('./pages/Workspaces').then((module) => ({ default: module.VisualizePage })),
);
const C6ProgramPage = lazy(() =>
  import('./c6-learning/Workbench').then((module) => ({ default: module.C6ProgramPage })),
);
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CustomCodePage = lazy(() => import('./custom-code/CustomCodePage'));
const AdvancedCoursePage = lazy(() => import('./advanced-course/AdvancedCoursePage'));
const LanguageMigrationPage = lazy(() => import('./language-migration/LanguageMigrationPage'));
const ExamplePage = lazy(() => import('./examples/ExamplePage'));
const KmpPage = lazy(() => import('./advanced-algorithms/KmpPage'));
const AdvancedAlgorithmPage = lazy(() => import('./advanced-algorithms/AdvancedAlgorithmPage'));
const ExampleComparisonPage = lazy(() => import('./example-comparison/ExampleComparisonPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const ComparisonPage = lazy(() => import('./comparison/ComparisonPage'));
const AlgorithmPage = lazy(() => import('./algorithms/AlgorithmPage'));
const VisualLab = lazy(() => import('./visual-lab/VisualLab'));
const StructurePage = lazy(() => import('./structures/StructurePage'));
const NodeCasePage = lazy(() => import('./node-cases/NodeCasePage'));
const ClassicPage = lazy(() => import('./classics/ClassicPage'));
const CompilationPage = lazy(() => import('./compilation/CompilationPage'));
const BugPage = lazy(() => import('./bugs/BugPanel'));
const MemoryBugPage = lazy(() => import('./memory-bugs/MemoryBugPage'));
const IndependentPracticePage = lazy(() => import('./c6-learning/IndependentPracticePage'));
const PythonCoursePage = lazy(() => import('./python3/CoursePage'));
const PythonWorkbench = lazy(() => import('./python3/Workbench'));
const PythonReviewPage = lazy(() => import('./python3/ReviewPage'));
const JavaCoursePage = lazy(() => import('./java/CoursePage'));
const JavaWorkbench = lazy(() => import('./java/Workbench'));
const JavaReviewPage = lazy(() => import('./java/ReviewPage'));
const CppCoursePage = lazy(() => import('./cpp-course/CoursePage'));
const CppWorkbench = lazy(() => import('./cpp-course/Workbench'));
const CppReviewPage = lazy(() => import('./cpp-course/ReviewPage'));
import { bugQuestions } from './bugs/content';
import { useParams } from 'react-router';
function PracticeRoute({ review = false }: { review?: boolean }) {
  const { exerciseId } = useParams();
  return bugQuestions.some((q) => q.exerciseRef.id === exerciseId) ? (
    <IndependentPracticePage review={review} />
  ) : (
    <PracticePage />
  );
}

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
  if (state.c6 && !state.snapshot && state.status === 'loading')
    return (
      <Layout>
        <StatePanel
          kind="loading"
          title="正在准备本地学习环境"
          description="正在核对当前课程并读取本地档案，准备完成后即可开始。"
        />
      </Layout>
    );
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
            <Route path="/python" element={<PythonCoursePage />} />
            <Route path="/python/article/:order/:section?" element={<PythonCoursePage />} />
            <Route path="/python/workbench" element={<PythonWorkbench />} />
            <Route path="/python/example/:order/:section" element={<PythonWorkbench />} />
            <Route path="/python/practice/:exerciseId" element={<PythonWorkbench />} />
            <Route path="/python/review" element={<PythonReviewPage />} />
            <Route path="/java" element={<JavaCoursePage />} />
            <Route path="/java/article/:order/:section?" element={<JavaCoursePage />} />
            <Route path="/java/workbench" element={<JavaWorkbench />} />
            <Route path="/java/example/:order/:section" element={<JavaWorkbench />} />
            <Route path="/java/practice/:exerciseId" element={<JavaWorkbench />} />
            <Route path="/java/review" element={<JavaReviewPage />} />
            <Route path="/cpp" element={<CppCoursePage />} />
            <Route path="/cpp/lesson/:lessonId" element={<CppCoursePage />} />
            <Route path="/cpp/workbench" element={<CppWorkbench />} />
            <Route path="/cpp/example/:lessonId" element={<CppWorkbench />} />
            <Route path="/cpp/practice/:profileId" element={<CppWorkbench />} />
            <Route path="/cpp/review" element={<CppReviewPage />} />
            <Route path="/advanced" element={<AdvancedCoursePage />} />
            <Route path="/advanced/migration" element={<LanguageMigrationPage />} />
            <Route path="/advanced/examples" element={<ExamplePage />} />
            <Route path="/advanced/algorithms" element={<AdvancedAlgorithmPage />} />
            <Route path="/advanced/algorithms/case.cpp.kmp" element={<KmpPage />} />
            <Route path="/advanced/algorithms/:caseId" element={<AdvancedAlgorithmPage />} />
            <Route path="/advanced/examples/:exampleId" element={<ExamplePage />} />
            <Route
              path="/advanced/examples/:exampleId/compare"
              element={<ExampleComparisonPage />}
            />
            <Route path="/advanced/:lessonId" element={<AdvancedCoursePage />} />
            <Route path="/lessons/:lessonId" element={<LessonPage />} />
            <Route path="/practice/:exerciseId" element={<PracticeRoute />} />
            <Route path="/practice" element={<PracticeCatalog />} />
            <Route path="/practice/:exerciseId/review" element={<PracticeRoute review />} />
            <Route path="/c6/program/:programId" element={<C6ProgramPage />} />
            <Route path="/cases" element={<CasesPage />} />
            <Route path="/compare" element={<ComparisonPage />} />
            <Route path="/algorithms/:algorithmId" element={<AlgorithmPage />} />
            <Route path="/algorithms/lab/:slug" element={<VisualLab />} />
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
            <Route path="/study-notes" element={<NotesPage />} />
            <Route path="/weaknesses" element={<WeaknessPage />} />
            <Route path="/generated-practice" element={<GeneratedPracticePage />} />
            <Route path="/reviews" element={<Navigate to="/notebook" replace />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="*" element={<MissingPage />} />
          </Routes>
        </Suspense>
      </PageBoundary>
    </Layout>
  );
}

export function App() {
  const [router] = useState(() =>
    createHashRouter([
      {
        path: '*',
        element: (
          <AiProvider>
            <PracticeProvider>
              <NotesProvider>
                <AppRoutes />
              </NotesProvider>
            </PracticeProvider>
          </AiProvider>
        ),
      },
    ]),
  );
  return (
    <LearningProvider>
      <KnowledgeMarksProvider>
        <ReviewProvider>
          <AchievementProvider>
            <AppearanceProvider>
              <WorkbenchProvider>
                <RouterProvider router={router} />
              </WorkbenchProvider>
            </AppearanceProvider>
          </AchievementProvider>
        </ReviewProvider>
      </KnowledgeMarksProvider>
    </LearningProvider>
  );
}
