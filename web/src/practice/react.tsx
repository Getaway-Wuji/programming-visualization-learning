import {
  createContext,
  useContext,
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import { flushSync } from 'react-dom';
import { useLearning } from '../learning/react';
import { PracticeSession } from './session';
import { resolveBlockAccess } from '../blocks/permissions';
import { bugQuestions } from '../bugs/content';
const Context = createContext<PracticeSession | null>(null);
export function PracticeProvider({ children }: { children: ReactNode }) {
  const { service, state } = useLearning();
  const isC6 = !!state.c6;
  const [session] = useState(
    () =>
      new PracticeSession(
        undefined,
        undefined,
        (action) => flushSync(action),
        {
          context: () => ({
            catalog: service.getState().practiceCatalog ?? null,
            epoch: service.getState().sessionEpoch,
          }),
          save: (fact, epoch) => service.recordPracticePass(fact, epoch),
          saveAttempt: (fact, epoch) => service.recordPracticeAttempt(fact, epoch),
          access: (catalog) =>
            resolveBlockAccess(
              catalog.packageRef,
              catalog.subject.lessonRef,
              service.getState().snapshot,
            ),
        },
        undefined,
        {
          context: service.editorHistoryContext,
          read: service.readEditorHistory,
          save: service.saveEditorHistory,
        },
      ),
  );
  const location = useLocation();
  const lifecycle = useRef({ token: 0 });
  useLayoutEffect(() => {
    // Settings is a temporary utility visit, not another exercise. Keep the
    // current draft/accepted run while changing appearance, and pause playback
    // while its view is hidden. Storage generation/epoch invalidation still
    // closes the session through the existing subscription below.
    if (location.pathname === '/settings') {
      session.player.pause();
      return;
    }
    const match = /^\/practice\/([^/]+)(\/review)?$/.exec(location.pathname);
    const independent = !isC6 || bugQuestions.some((q) => q.exerciseRef.id === match?.[1]);
    session.enter(
      independent ? match?.[1] : undefined,
      Boolean(match?.[2]),
      new URLSearchParams(location.search).get('mode') === 'reconstruction'
        ? 'reconstruction'
        : undefined,
    );
  }, [session, location.pathname, location.search, state.sessionEpoch, isC6]);
  useEffect(() => {
    const lease = lifecycle.current;
    const token = ++lease.token;
    const unsubscribe = service.subscribeSessionInvalidation(() =>
      session.close('本地数据已变更，本次提交失效。'),
    );
    const visibility = () => {
      if (document.visibilityState === 'visible') session.checkDeadline();
      else session.player.pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      queueMicrotask(() => {
        if (lease.token === token) session.close();
      });
    };
  }, [session, service]);
  useEffect(
    () => session.player.setRate(state.snapshot?.settings.playbackRate ?? 1),
    [session, state.snapshot?.settings.playbackRate],
  );
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function usePractice() {
  const session = useContext(Context);
  if (!session) throw new Error('PracticeProvider required');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const player = useSyncExternalStore(session.player.subscribe, session.player.getSnapshot);
  return { session, state, player };
}
