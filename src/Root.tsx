import App from "./App";
import { AboutPage } from "./pages/About";

/**
 * Static-host friendly routing: the main app is state-routed; /#/about renders
 * the standalone About page (opened in a new tab from nav/footer).
 */
export function Root() {
  return window.location.hash.startsWith("#/about") ? <AboutPage /> : <App />;
}
