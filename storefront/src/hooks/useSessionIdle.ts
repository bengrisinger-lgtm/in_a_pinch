import { useEffect, useRef, useState } from 'react';
import { startSessionIdleMonitor } from '@securedbackend/sdk';
import { kit, redirectToLogin } from '../lib/kit';

export function useSessionIdle(active: boolean, consumer: boolean) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [busy, setBusy] = useState(false);
  const continueRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!active) {
      setWarningOpen(false);
      return;
    }

    const auth = kit().auth;
    void auth.touchSession();

    const monitor = startSessionIdleMonitor(
      {
        onWarning: (sec) => {
          setSecondsLeft(sec);
          setWarningOpen(true);
        },
        onWarningEnd: () => setWarningOpen(false),
        onExpired: () => {
          void (async () => {
            await auth.logout();
            if (consumer) {
              window.location.reload();
            } else {
              redirectToLogin();
            }
          })();
        },
      },
      {
        probeSession: async () => {
          const status = await auth.getSessionStatus();
          return { valid: status.valid, secondsRemaining: status.secondsRemaining };
        },
        touchSession: () => auth.touchSession(),
      }
    );
    continueRef.current = monitor.continueSession;

    return () => {
      monitor.dispose();
    };
  }, [active, consumer]);

  async function onContinue() {
    setBusy(true);
    try {
      await continueRef.current?.();
      setWarningOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return { warningOpen, secondsLeft, busy, onContinue };
}
