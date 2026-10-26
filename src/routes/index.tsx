import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ ssr: true, component: Home });

function Home() {
  return (
    <div className="home-layout">
      <section className="intro">
        <p className="kicker">Good food starts with curiosity.</p>
        <h1>Bring a little local knowledge to the table.</h1>
        <p className="lead">
          Get to know a dish before you order. A little context for unfamiliar food, and room for
          discovery on your next trip.
        </p>
        <p className="launch-note">GoodTaste is taking shape. More to explore soon.</p>
      </section>
      <aside className="travel-note">
        <div className="bowl" aria-hidden="true">
          <span>✳</span>
        </div>
        <h2>A guide, with room for questions.</h2>
        <p>
          Every kitchen is different. Confirm ingredients and preparation with the people making
          your food.
        </p>
      </aside>
    </div>
  );
}
