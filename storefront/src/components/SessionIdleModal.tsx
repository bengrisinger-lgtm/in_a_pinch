type Props = {
  secondsLeft: number;
  busy: boolean;
  onContinue: () => void;
};

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export default function SessionIdleModal({ secondsLeft, busy, onContinue }: Props) {
  return (
    <div
      className="overlay open still-shopping-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-idle-title"
    >
      <div className="drawer still-shopping">
        <h2 id="session-idle-title">Session timeout</h2>
        <p>To keep your session open, please hit continue.</p>
        <p className="session-idle-countdown">{formatCountdown(secondsLeft)}</p>
        <div className="actions">
          <span />
          <button type="button" disabled={busy} onClick={onContinue}>
            {busy ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
