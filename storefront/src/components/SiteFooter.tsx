import { staffHubHref, staffLoginHref } from '../lib/kit';

type Props = {
  staff: boolean;
  consumer?: boolean;
};

/** Bottom-of-page disclaimers. Privacy / Terms pages are not built yet. */
export default function SiteFooter({ staff, consumer = false }: Props) {
  if (consumer) {
    return (
      <footer className="site-footer consumer-footer" id="contact">
        <img className="footer-logo" src="/iap-logo-lockup.png" alt="In A Pinch AV" />
        <p>Denver, Colorado</p>
        <p>Audio · Video · Lighting · Equipment rentals</p>
        {staff ? (
          <p>Staff session</p>
        ) : (
          <a href={staffLoginHref(staffHubHref())}>Staff sign in</a>
        )}
        <div className="site-footer-legal">
          <p>
            <span className="footer-later" title="Privacy page not built yet">
              Privacy
            </span>
            <span aria-hidden="true"> / </span>
            <span className="footer-later" title="Terms of Use page not built yet">
              Terms of Use
            </span>
            <span className="footer-later-note"> — pages later</span>
          </p>
          <p>Copyright © 2026 In a Pinch AV</p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="site-footer" id="contact">
      <div className="site-footer-inner">
        <div>
          <h2>About</h2>
          <img className="footer-logo hub-footer-logo" src="/iap-logo-badge.png" alt="In A Pinch AV" />
          <p>Denver, Colorado</p>
          <p>Audio · Video · Lighting · Equipment rentals</p>
        </div>
        <div>
          <h2>Rentals</h2>
          <a href="#rentals">Browse rentals</a>
        </div>
        <div>
          <h2>Account</h2>
          {staff ? (
            <p>Staff session</p>
          ) : (
            <a href={staffLoginHref()}>Staff sign in</a>
          )}
        </div>
        <div>
          <h2>Legal</h2>
          <span className="footer-later" title="Privacy page not built yet">
            Privacy
          </span>
          <span className="footer-later" title="Terms of Use page not built yet">
            Terms of Use
          </span>
        </div>
      </div>
      <div className="site-footer-legal">
        <p>
          <span className="footer-later">Privacy</span>
          <span aria-hidden="true"> / </span>
          <span className="footer-later">Terms of Use</span>
          <span className="footer-later-note"> — pages later</span>
        </p>
        <p>Copyright © 2026 In a Pinch AV</p>
      </div>
    </footer>
  );
}
