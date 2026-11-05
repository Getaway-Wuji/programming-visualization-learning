import { useEffect, useState } from 'react';
import { localDateAt } from '../storage/validation';

/** Calendar labels follow the archive's zone, including resumed tabs and midnight. */
export function useLocalLearningDate(timeZone: string | undefined) {
  const read = () => (timeZone ? localDateAt(new Date().toISOString(), timeZone) : null);
  const [observed, setObserved] = useState(read);
  useEffect(() => {
    const update = () => setObserved(read());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
    // The only external input to the calendar is the archive's zone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone]);
  return timeZone ? (observed ?? read()) : null;
}
