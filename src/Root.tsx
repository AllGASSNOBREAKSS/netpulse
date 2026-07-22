import { lazy, Suspense } from "react";
import App from "./App";
import { AboutPage } from "./pages/About";
import { AstryxProvider } from "./theme/AstryxProvider";

// Migration-only surface; lazy so it never lands in the main bundle.
const FoundationCheck = lazy(() =>
  import("./pages/FoundationCheck").then((m) => ({ default: m.FoundationCheck })),
);
const ValidationDashboard = lazy(() =>
  import("./pages/ValidationDashboard").then((m) => ({ default: m.ValidationDashboard })),
);

/**
 * Static-host friendly routing: the main app is state-routed; /#/about renders
 * the standalone About page (opened in a new tab from nav/footer), and
 * /#/foundation renders the temporary Astryx foundation smoke test.
 */
export function Root() {
  const hash = window.location.hash;

  if (hash.startsWith("#/about")) return <AboutPage />;

  if (import.meta.env.DEV && hash.startsWith("#/internal/validation")) {
    return (
      <Suspense fallback={null}>
        <ValidationDashboard />
      </Suspense>
    );
  }

  if (hash.startsWith("#/foundation")) {
    return (
      <AstryxProvider>
        <Suspense fallback={null}>
          <FoundationCheck />
        </Suspense>
      </AstryxProvider>
    );
  }

  return <App />;
}
