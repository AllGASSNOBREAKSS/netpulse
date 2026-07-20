/**
 * Astryx foundation smoke test — TEMPORARY migration surface.
 *
 * A broken cascade-layer order fails silently and identically on every page,
 * so this route exists to catch it once, up front, instead of after N migrated
 * screens. Open `/#/foundation`.
 *
 * It verifies:
 *   - Astryx subpath imports resolve
 *   - core reset + astryx.css + theme CSS actually load (padding is non-zero)
 *   - the Theme provider is mounted and the netpulse theme is active
 *   - light and dark modes both resolve tokens
 *   - the type scale and spacing scale render
 *   - focus-visible rings and Tab order work
 *   - Tailwind utilities still win over Astryx (utilities layer is last)
 *   - the legacy np-legacy layer (gauges) is still intact
 *
 * DELETE THIS FILE once every production route is migrated and verified.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { NETPULSE_ACCENT } from "@/theme/netpulse";
import { setColorMode, useColorMode } from "@/theme/colorMode";

/** `skip` = could not be evaluated in this environment, which is not a pass. */
type CheckStatus = "pass" | "fail" | "skip";
type Check = { name: string; status: CheckStatus; detail: string };

/** Normalizes any CSS color to `r, g, b` via the browser. */
function toRgb(color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function runChecks(root: HTMLElement): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) =>
    checks.push({ name, status: ok ? "pass" : "fail", detail });
  const skip = (name: string, detail: string) => checks.push({ name, status: "skip", detail });

  // 1. Component styles load at all. This is THE layer-order canary: an
  //    unlayered app reset or a layer declared after astryx-base zeroes this.
  const button = root.querySelector<HTMLButtonElement>("[data-check-button] button");
  const padX = button ? getComputedStyle(button).paddingInline : "";
  add(
    "Astryx component CSS loaded",
    !!button && padX !== "0px" && padX !== "",
    button ? `Button padding-inline: ${padX || "(none)"}` : "Button did not render",
  );

  // 2. Button actually gets a filled background from the primary variant.
  const bg = button ? getComputedStyle(button).backgroundColor : "";
  add(
    "Primary variant is filled",
    bg !== "" && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent",
    `background-color: ${bg || "(none)"}`,
  );

  // 3. Card padding — spacing scale is wired.
  const card = root.querySelector<HTMLElement>("[data-check-card]");
  const cardPad = card ? getComputedStyle(card).padding : "";
  add(
    "Card padding from spacing scale",
    !!card && cardPad !== "0px" && cardPad !== "",
    `Card padding: ${cardPad || "(none)"}`,
  );

  // 4. Theme provider mounted and the NetPulse theme (not bare neutral) is on.
  const themed = root.closest("[data-astryx-theme]");
  const themeName = themed?.getAttribute("data-astryx-theme") ?? "";
  add(
    "NetPulse theme active",
    themeName.includes("netpulse"),
    `data-astryx-theme: ${themeName || "(absent)"}`,
  );

  // 5. The accent resolves to the NetPulse electric blue for the ACTIVE mode —
  //    proves defineTheme's tokens reached the DOM, not just neutral defaults.
  const mode: "light" | "dark" = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
  const accent = getComputedStyle(root).getPropertyValue("--color-accent").trim();
  add(
    `Accent token is NetPulse blue (${mode})`,
    accent !== "" && toRgb(accent) === toRgb(NETPULSE_ACCENT[mode]),
    `--color-accent → ${accent ? toRgb(accent) : "(unset)"}, expected ${toRgb(NETPULSE_ACCENT[mode])}`,
  );

  // 5b. Every accent token must be VALID CSS, not just present. Astryx's
  //     generator can emit a light-dark() nested inside color-mix(), which is
  //     invalid at computed-value time and silently resolves to transparent —
  //     that is what killed the TextInput focus ring. Rendering each token as
  //     an actual color is the only way to catch it.
  const accentTokens = [
    "--color-accent",
    "--color-accent-muted",
    "--color-on-accent",
    "--color-text-accent",
  ];
  const invalid = accentTokens.filter((name) => {
    const raw = getComputedStyle(root).getPropertyValue(name).trim();
    if (raw === "") return true;
    const rgb = toRgb(raw);
    // A transparent result means the declaration was dropped as invalid.
    return rgb === "rgba(0, 0, 0, 0)" || rgb === "";
  });
  add(
    "Accent tokens are valid colors",
    invalid.length === 0,
    invalid.length === 0
      ? `${accentTokens.length} accent tokens resolve to real colors`
      : `invalid / transparent: ${invalid.join(", ")}`,
  );

  // 6. Surface token follows the active mode (deep black in dark).
  const surface = getComputedStyle(root).getPropertyValue("--color-background-body").trim();
  add("Background token resolves", surface !== "", `--color-background-body: ${surface || "(unset)"}`);

  // 7. Tailwind utilities must still beat Astryx — the utilities layer is last.
  //    If this fails, migrated pages can't be laid out with Tailwind at all.
  const twProbe = root.querySelector<HTMLElement>("[data-check-tailwind]");
  const twPad = twProbe ? getComputedStyle(twProbe).paddingLeft : "";
  add(
    "Tailwind utilities still win",
    twPad === "32px",
    `.pl-8 resolved to padding-left: ${twPad || "(none)"} (expected 32px)`,
  );

  // 8. The legacy np-legacy layer still applies (the custom gauges live there).
  const legacy = root.querySelector<HTMLElement>("[data-check-legacy]");
  const legacyMax = legacy ? getComputedStyle(legacy).maxWidth : "";
  add(
    "Legacy gauge CSS intact",
    legacyMax === "340px",
    `.np-gauge max-width: ${legacyMax || "(none)"} (expected 340px)`,
  );

  // 9. The TextInput focus ring actually paints. Astryx draws it on the
  //    wrapper as `inset 0 0 0 2px var(--color-accent-muted)`, so a broken
  //    accent token leaves a focusable control with NO visible focus state.
  const input = root.querySelector<HTMLInputElement>(".astryx-text-input input");
  const wrapper = input?.closest<HTMLElement>(".astryx-text-input") ?? null;

  if (!input || !wrapper) {
    add("TextInput focus ring is visible", false, "TextInput did not render");
  } else if (!document.hasFocus()) {
    // :focus-within cannot match while the document itself is unfocused, so
    // any reading here would be a false negative. Say so instead of failing.
    skip(
      "TextInput focus ring is visible",
      "Not evaluated — click the page first, then Re-run checks",
    );
  } else {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    input.focus();
    const ringShadow = getComputedStyle(wrapper).boxShadow;
    // Restore focus so running the checks doesn't steal it from the user.
    if (previouslyFocused && previouslyFocused !== input) previouslyFocused.focus();
    else input.blur();

    // Assert on the ring's COLOR, not its spread: the ring animates in, so a
    // spread check would race the transition. The real failure mode is an
    // invalid token collapsing the colour to transparent.
    const ringVisible =
      ringShadow !== "" && ringShadow !== "none" && !/rgba\([^)]*,\s*0\)/.test(ringShadow);
    add("TextInput focus ring is visible", ringVisible, `focus box-shadow: ${ringShadow || "(none)"}`);
  }

  // 10. Every interactive control is keyboard reachable.
  const focusables = root.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]");
  const unreachable = Array.from(focusables).filter((el) => el.getAttribute("tabindex") === "-1");
  add(
    "All controls keyboard reachable",
    unreachable.length === 0,
    `${focusables.length} focusable controls, ${unreachable.length} removed from tab order`,
  );

  return checks;
}

export function FoundationCheck() {
  const mode = useColorMode();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [email, setEmail] = useState("");
  const [broken, setBroken] = useState("");

  // Re-run after paint, and again whenever the mode flips, so both themes are
  // asserted rather than only whichever one happened to load first.
  useEffect(() => {
    if (!root) return;
    const id = requestAnimationFrame(() => setChecks(runChecks(root)));
    return () => cancelAnimationFrame(id);
  }, [root, mode]);

  const recheck = useCallback(() => {
    if (root) setChecks(runChecks(root));
  }, [root]);

  const failed = checks.filter((c) => c.status === "fail").length;
  const skipped = checks.filter((c) => c.status === "skip").length;

  const summary =
    checks.length === 0
      ? "Running…"
      : failed > 0
        ? `${failed} of ${checks.length} checks failing`
        : skipped > 0
          ? `${checks.length - skipped} passing, ${skipped} not evaluated`
          : `All ${checks.length} checks passing`;

  return (
    <div ref={setRoot} data-foundation-check className="min-h-dvh bg-background px-4 py-10 sm:px-8">
      <Stack gap={6} maxWidth={880} className="mx-auto">
        {/* ---- Verdict ---- */}
        <Stack gap={2}>
          <Text as="h1" type="display-2">
            Astryx foundation check
          </Text>
          <Text type="supporting">
            Temporary migration surface. Every check below must pass before any production route is
            migrated — a broken cascade-layer order fails silently and identically on every page.
          </Text>
        </Stack>

        <Card
          data-check-results
          variant={
            checks.length === 0 ? "muted" : failed > 0 ? "red" : skipped > 0 ? "orange" : "green"
          }
        >
          <Stack gap={3}>
            <Stack direction="horizontal" justify="between" align="center" gap={3} wrap="wrap">
              <Text type="large" weight="semibold">
                {summary}
              </Text>
              <Stack direction="horizontal" gap={2} wrap="wrap">
                <Button
                  label={mode === "dark" ? "Switch to light" : "Switch to dark"}
                  variant="secondary"
                  size="sm"
                  onClick={() => setColorMode(mode === "dark" ? "light" : "dark")}
                />
                <Button label="Re-run checks" variant="ghost" size="sm" onClick={recheck} />
              </Stack>
            </Stack>

            <Text type="supporting">
              Active mode: <strong>{mode}</strong> — flip it and confirm every check still passes and
              nothing below becomes unreadable.
            </Text>

            <Stack gap={1.5} as="ul">
              {checks.map((c) => (
                <Stack key={c.name} direction="horizontal" gap={2} align="start" as="li">
                  <Text type="code" color={c.status === "pass" ? "primary" : "accent"}>
                    {c.status === "pass" ? "PASS" : c.status === "skip" ? "SKIP" : "FAIL"}
                  </Text>
                  <Stack gap={0.5}>
                    <Text weight="medium">{c.name}</Text>
                    <Text type="supporting">{c.detail}</Text>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </Card>

        {/* ---- Typography scale ---- */}
        <Card>
          <Stack gap={3}>
            <Text as="h2" type="display-3">
              Typography
            </Text>
            <Text type="display-1">Display 1 — Geist</Text>
            <Text type="large">Large — supporting emphasis</Text>
            <Text>Body — the default reading size for measured results and explanations.</Text>
            <Text type="label">Label — form and metric captions</Text>
            <Text type="supporting">Supporting — muted secondary copy</Text>
            <Text type="code">Code — 942.7 Mbps · 14 ms</Text>
            <Text hasTabularNumbers type="code">
              Tabular numerals 1234567890 (must align in a column)
            </Text>
          </Stack>
        </Card>

        {/* ---- Buttons: variants, sizes, states, focus ---- */}
        <Card data-check-button>
          <Stack gap={3}>
            <Text as="h2" type="display-3">
              Buttons
            </Text>
            <Text type="supporting">
              Tab through these: each must show a visible focus ring, and Enter/Space must activate.
            </Text>
            <Stack direction="horizontal" gap={2} wrap="wrap" align="center">
              <Button label="Primary action" variant="primary" />
              <Button label="Secondary" variant="secondary" />
              <Button label="Ghost" variant="ghost" />
              <Button label="Destructive" variant="destructive" />
            </Stack>
            <Stack direction="horizontal" gap={2} wrap="wrap" align="center">
              <Button label="Small" size="sm" />
              <Button label="Medium" size="md" />
              <Button label="Large" size="lg" />
            </Stack>
            <Stack direction="horizontal" gap={2} wrap="wrap" align="center">
              <Button label="Loading" isLoading />
              <Button label="Disabled" isDisabled />
              <Button label="With tooltip" tooltip="Tooltip renders above the card" />
            </Stack>
          </Stack>
        </Card>

        {/* ---- Inputs: label, description, status, keyboard ---- */}
        <Card>
          <Stack gap={3}>
            <Text as="h2" type="display-3">
              Inputs
            </Text>
            <TextInput
              label="Email"
              description="Labels, descriptions and status messages must all be visible."
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              hasClear
            />
            <TextInput
              label="Field with error"
              value={broken}
              onChange={setBroken}
              placeholder="Type to clear the error"
              status={
                broken === ""
                  ? { type: "error", message: "This field is required" }
                  : { type: "success", message: "Looks good" }
              }
            />
            <TextInput
              label="Disabled"
              value="Not editable"
              isDisabled
              disabledMessage="Disabled controls stay focusable so the reason is discoverable"
            />
          </Stack>
        </Card>

        {/* ---- Spacing + card variants ---- */}
        <Card data-check-card>
          <Stack gap={3}>
            <Text as="h2" type="display-3">
              Surfaces &amp; spacing
            </Text>
            <Stack direction="horizontal" gap={3} wrap="wrap">
              <Card variant="default" width={200}>
                <Text type="supporting">default</Text>
              </Card>
              <Card variant="muted" width={200}>
                <Text type="supporting">muted</Text>
              </Card>
              <Card variant="transparent" width={200}>
                <Text type="supporting">transparent</Text>
              </Card>
            </Stack>
            <Stack direction="horizontal" gap={2} wrap="wrap" align="center">
              {([0.5, 1, 2, 3, 4, 6, 8] as const).map((step) => (
                <Stack key={step} gap={1} align="center">
                  <div
                    className="rounded-sm bg-primary"
                    style={{ width: `var(--spacing-${step}, 8px)`, height: 24 }}
                  />
                  <Text type="code">{step}</Text>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </Card>

        {/* ---- Interop: Tailwind + legacy layer must both still work ---- */}
        <Card>
          <Stack gap={3}>
            <Text as="h2" type="display-3">
              Style interop
            </Text>
            <div
              data-check-tailwind
              className="pl-8 rounded-md border border-border bg-muted py-3 text-sm text-muted-foreground"
            >
              Tailwind utilities (<code>pl-8</code>, <code>bg-muted</code>) must still apply here —
              the utilities layer is declared last on purpose.
            </div>
            <div data-check-legacy className="np-gauge">
              <Text type="supporting">
                This element carries the legacy <code>.np-gauge</code> class from styles.css. Its
                max-width must still be 340px, proving the np-legacy layer survives.
              </Text>
            </div>
          </Stack>
        </Card>

        {/* ---- Responsive ---- */}
        <Card>
          <Stack gap={3}>
            <Text as="h2" type="display-3">
              Responsive
            </Text>
            <Text type="supporting">
              Resize to 375 / 768 / 1280 / 1440 / 1920px. Nothing may overflow horizontally, and the
              row below must wrap rather than scroll.
            </Text>
            <Stack direction="horizontal" gap={2} wrap="wrap">
              {Array.from({ length: 8 }, (_, i) => (
                <Card key={i} variant="muted" width={150}>
                  <Text type="code">cell {i + 1}</Text>
                </Card>
              ))}
            </Stack>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
