type Props = {
  busy: boolean;
  onContinue: () => void;
};

export default function StillShoppingModal({ busy, onContinue }: Props) {
  return (
    <div
      className="overlay open still-shopping-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="still-shopping-title"
    >
      <div className="drawer still-shopping">
        <h2 id="still-shopping-title">Are you still shopping?</h2>
        <p>
          Click Yes to continue. If you don&apos;t, we&apos;ll release this gear at the 15-minute mark so
          someone else can rent it.
        </p>
        <div className="actions">
          <span />
          <button type="button" disabled={busy} onClick={onContinue}>
            {busy ? 'Keeping hold…' : 'Yes, continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
