/** App views (state-routed; /#/about renders standalone in a new tab). */
export type View =
  | "speed"
  | "results"
  | "fixit"
  | "blackbox"
  | "history"
  | "details"
  | "privacy"
  | "calculator"
  | "guides"
  | "faq"
  // Designed but not yet measurable — these render honest "in development"
  // states rather than being dead links in the sidebar.
  | "areapulse"
  | "planreality"
  | "reports";
