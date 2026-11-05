import {
  createContext,
  use,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useLearning } from '../learning/react';
import type { AiSession } from './session';
function createLazySession() {
  let session: AiSession | null = null;
  let loading: Promise<AiSession> | null = null;
  return {
    load: () =>
      (loading ??= import('./session').then((module) => (session = new module.AiSession()))),
    clear: () => session?.clear(),
  };
}
const Context = createContext<ReturnType<typeof createLazySession> | null>(null);
export function AiProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createLazySession);
  const { service } = useLearning();
  useEffect(() => {
    const clear = () => session.clear();
    const unsubscribe = service.subscribeSessionInvalidation(clear);
    window.addEventListener('pagehide', clear);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', clear);
      session.clear();
    };
  }, [service, session]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useAi() {
  const lazySession = useContext(Context);
  if (!lazySession) throw new Error('AiProvider required');
  const session = use(lazySession.load());
  return { session, state: useSyncExternalStore(session.subscribe, session.getSnapshot) };
}
