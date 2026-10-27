import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { messages } from "../shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/")({ ssr: true, component: Home });

function Home() {
  const { lang } = rootRoute.useSearch();
  const copy = messages[lang];

  return (
    <div className="home-layout">
      <section className="intro">
        <p className="kicker">{copy.kicker}</p>
        <h1>{copy.heading}</h1>
        <p className="lead">{copy.introduction}</p>
        <p className="launch-note">{copy.launchNote}</p>
      </section>
      <aside className="travel-note">
        <div className="bowl" aria-hidden="true">
          <span>✳</span>
        </div>
        <h2>{copy.noteHeading}</h2>
        <p>{copy.noteBody}</p>
      </aside>
    </div>
  );
}
