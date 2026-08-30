import { useEffect, useState } from 'react';
import { subscribeTabPresence } from '../platform/tabGuard';

/** True once another Resonance tab has been detected; dismissable. */
export function useTabGuard() {
  const [otherTab, setOtherTab] = useState(false);
  useEffect(() => subscribeTabPresence(() => setOtherTab(true)), []);
  return { otherTab, dismiss: () => setOtherTab(false) };
}
