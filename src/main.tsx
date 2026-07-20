import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { AstryxProvider } from "./theme/AstryxProvider";
// index.css owns the cascade layer order and imports styles.css into the
// np-legacy layer. Importing styles.css here too would re-add it UNLAYERED,
// where it would beat every Astryx layer.
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <AstryxProvider>
    <Root />
  </AstryxProvider>,
);
