type Tile = {
  href?: string;
  title: string;
  body: string;
  tag: string;
  later?: boolean;
};

const TILES: Tile[] = [
  {
    href: '#rentals',
    tag: 'Live',
    title: 'Rentals',
    body: 'Date-aware catalog, availability calendar, and cart holds.',
  },
  {
    href: '#stock',
    tag: 'Live',
    title: 'Inventory',
    body: 'Add SKUs and serials. Same stock the catalog and calendar read.',
  },
  {
    tag: 'Later',
    title: 'Photos',
    body: 'Replace gear shots without a rebuild.',
    later: true,
  },
  {
    tag: 'Later',
    title: 'Customers',
    body: 'Renter records tied to bookings and agreements.',
    later: true,
  },
  {
    tag: 'Later',
    title: 'Rental reports',
    body: 'What went out, what is due back, and what sat idle.',
    later: true,
  },
  {
    tag: 'Later',
    title: 'Marketing',
    body: 'Email, Facebook, and ads. Not this month.',
    later: true,
  },
];

type Props = { email: string };

export default function HubHome({ email }: Props) {
  return (
    <section className="hub-home">
      <p className="eyebrow">Staff hub</p>
      <h1>Where you work after sign-in.</h1>
      <p className="muted hub-lead">
        Signed in as {email}. Rentals and inventory are live. The rest of these
        desks land here as we build them — not a second login, and not the
        public site.
      </p>
      <div className="hub-grid">
        {TILES.map((tile) =>
          tile.later || !tile.href ? (
            <div key={tile.title} className="hub-tile later">
              <span className="tag">{tile.tag}</span>
              <h2>{tile.title}</h2>
              <p>{tile.body}</p>
            </div>
          ) : (
            <a key={tile.title} className="hub-tile" href={tile.href}>
              <span className="tag">{tile.tag}</span>
              <h2>{tile.title}</h2>
              <p>{tile.body}</p>
            </a>
          )
        )}
      </div>
    </section>
  );
}
