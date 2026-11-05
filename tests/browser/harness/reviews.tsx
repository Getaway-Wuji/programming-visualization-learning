import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { HashRouter, useLocation } from 'react-router';
import { LearningProvider, useLearning } from '../../../web/src/learning/react';
import { KnowledgeMarksProvider } from '../../../web/src/review-notebook/marks';
import { ReviewProvider, useReviews } from '../../../web/src/review-scheduler/react';
import ReviewsPage from '../../../web/src/review-scheduler/ReviewsPage';
import '../../../web/src/styles.css';
import '../../../web/src/review-scheduler/reviews.css';
import './reviews.css';

// The public /reviews route now leads to the notebook. Exercise the retained
// scheduler and its native storage UI independently, using the real providers.
function ReviewChecks() {
  const learning = useLearning().state;
  const review = useReviews().state;
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== '/reviews')
      window.location.replace(`/#${location.pathname}${location.search}${location.hash}`);
  }, [location.pathname, location.search, location.hash]);
  if (location.pathname !== '/reviews') return null;
  return (
    <div
      className="app-shell p05-app review-checks-shell"
      data-learning-storage-status={learning.status}
      data-review-storage-status={review.status}
    >
      <main>
        <ReviewsPage />
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <LearningProvider>
    <KnowledgeMarksProvider>
      <ReviewProvider>
        <HashRouter>
          <ReviewChecks />
        </HashRouter>
      </ReviewProvider>
    </KnowledgeMarksProvider>
  </LearningProvider>,
);
