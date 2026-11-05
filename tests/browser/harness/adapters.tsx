import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../../web/src/App';
import { EngineConnection } from '../../../web/src/components/EngineConnection';
import { CatalogSample } from '../../../web/src/components/ContentSample';
import { LearningProvider } from '../../../web/src/learning/react';
import '../../../web/src/styles.css';
import '../../../web/src/appearance/themes.css';
import '../../../web/src/appearance/block-skins.css';
import '../../../web/src/workbench/workbench.css';

/** Actual retained diagnostic components alongside the current app. This is
 * emitted only into the internal QA build; student pages keep their normal UI. */
function Diagnostics() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const changed = () => setRoute(location.hash);
    addEventListener('hashchange', changed);
    return () => removeEventListener('hashchange', changed);
  }, []);
  return (
    <LearningProvider>
      <CatalogSample kind="case" />
      <EngineConnection key={route} />
    </LearningProvider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
createRoot(document.getElementById('adapter-checks')!).render(<Diagnostics />);
