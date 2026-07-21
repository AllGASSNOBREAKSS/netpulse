import { lazy, Suspense } from "react";
import App from "./App";
import { AboutPage } from "./pages/About";

// Migration-only surface; lazy so it never lands in the main bundle.
const FoundationCheck = lazy(() =>
  import("./pages/FoundationCheck").then((m) => ({ default: m.FoundationCheck })),
);

/**
 * Static-host friendly routing: the main app is state-routed; /#/about renders
 * the standalone About page (opened in a new tab from nav/footer), and
 * /#/foundation renders the temporary Astryx foundation smoke test.
 */
export function Root() {
  const hash = window.location.hash;

  if (hash.startsWith("#/about")) return <AboutPage />;

  if (hash.startsWith("#/foundation")) {
    return (
      <Suspense fallback={null}>
        <FoundationCheck />
      </Suspense>
    );
  }

  return <App />;
}
