import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useLearning } from '../learning/react';
import { AiSession } from './session';
const Context = createContext<AiSession | null>(null);
export function AiProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new AiSession());
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
  const session = useContext(Context);
  if (!session) throw new Error('AiProvider required');
  return { session, state: useSyncExternalStore(session.subscribe, session.getSnapshot) };
}
