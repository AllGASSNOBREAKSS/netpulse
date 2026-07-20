import { createRoot } from "react-dom/client";
import App from "./App";
import { AboutPage } from "./pages/About";
import "./index.css";
import "./styles.css";

/**
 * Static-host friendly routing: the main app is state-routed; /#/about renders
 * the standalone About page (opened in a new tab from nav/footer).
 */
function Root() {
  return window.location.hash.startsWith("#/about") ? <AboutPage /> : <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
